import { Body, ConflictException, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lt, ne, type SQL } from 'drizzle-orm';
import { activityAt, DEFAULT_BELL_SCHEDULE, timetableEntrySchema, type TimetableEntryInput, type TimetableSlot } from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { classes, classSubjects, schoolProfile, subjects, terms, timetableEntries, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AccessService } from '../access/access.service';
import { CurriculumService } from '../academics/curriculum.service';

@Controller('timetable')
export class TimetableController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly curriculum: CurriculumService,
  ) {}

  private async termOrCurrent(termId?: string): Promise<string | null> {
    if (termId) return termId;
    const [row] = await this.db.select({ id: terms.id }).from(terms).where(eq(terms.isCurrent, true));
    return row?.id ?? null;
  }

  private async slots(termId: string, where: SQL | undefined): Promise<TimetableSlot[]> {
    const rows = await this.db
      .select({
        id: timetableEntries.id,
        dayOfWeek: timetableEntries.dayOfWeek,
        startsAt: timetableEntries.startsAt,
        endsAt: timetableEntries.endsAt,
        room: timetableEntries.room,
        subjectId: subjects.id,
        subjectName: subjects.name,
        classId: classes.id,
        className: classes.name,
        teacherId: classSubjects.teacherId,
        teacherName: users.fullName,
      })
      .from(timetableEntries)
      .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
      .innerJoin(classes, eq(classes.id, timetableEntries.classId))
      .leftJoin(
        classSubjects,
        and(eq(classSubjects.classId, timetableEntries.classId), eq(classSubjects.subjectId, timetableEntries.subjectId)),
      )
      .leftJoin(users, eq(users.id, classSubjects.teacherId))
      .where(and(eq(timetableEntries.termId, termId), where))
      .orderBy(asc(timetableEntries.dayOfWeek), asc(timetableEntries.startsAt), asc(subjects.name));

    // Combined lessons: the same teacher with the same subject at the same time in other classes.
    const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((t): t is string => !!t))];
    const others = teacherIds.length
      ? await this.db
          .select({
            classId: timetableEntries.classId,
            className: classes.name,
            subjectId: timetableEntries.subjectId,
            teacherId: classSubjects.teacherId,
            dayOfWeek: timetableEntries.dayOfWeek,
            startsAt: timetableEntries.startsAt,
            endsAt: timetableEntries.endsAt,
          })
          .from(timetableEntries)
          .innerJoin(classes, eq(classes.id, timetableEntries.classId))
          .innerJoin(
            classSubjects,
            and(eq(classSubjects.classId, timetableEntries.classId), eq(classSubjects.subjectId, timetableEntries.subjectId)),
          )
          .where(and(eq(timetableEntries.termId, termId), inArray(classSubjects.teacherId, teacherIds)))
      : [];

    return rows.map(({ teacherId, ...r }) => ({
      ...r,
      startsAt: r.startsAt.slice(0, 5),
      endsAt: r.endsAt.slice(0, 5),
      combinedWith: teacherId
        ? [
            ...new Set(
              others
                .filter(
                  (o) =>
                    o.teacherId === teacherId &&
                    o.subjectId === r.subjectId &&
                    o.classId !== r.classId &&
                    o.dayOfWeek === r.dayOfWeek &&
                    o.startsAt < r.endsAt &&
                    o.endsAt > r.startsAt,
                )
                .map((o) => o.className),
            ),
          ].sort()
        : [],
    }));
  }

  /**
   * The signed-in user's own week: a student's class, a parent's child
   * (?studentId), or every period a teacher takes.
   */
  @Get('mine')
  async mine(@CurrentUser() user: AuthUser, @Query('studentId') studentId?: string, @Query('termId') termId?: string) {
    const term = await this.termOrCurrent(termId);
    if (!term) return [];
    if (user.role === 'teacher') {
      // A combined lesson is one period for the teacher: "French — 1G/S 1 + 1H/E 2".
      const mine = await this.slots(term, eq(classSubjects.teacherId, user.id));
      const merged = new Map<string, TimetableSlot>();
      for (const s of mine) {
        const key = `${s.dayOfWeek}|${s.startsAt}|${s.subjectId}`;
        const seen = merged.get(key);
        if (seen) seen.className = [seen.className, s.className].sort().join(' + ');
        else merged.set(key, { ...s, combinedWith: [] });
      }
      return [...merged.values()];
    }
    const student = await this.access.resolveOwnStudent(user, studentId);
    // Elective periods for other options in the class are left out.
    const subjectIds = await this.curriculum.subjectIdsForStudent(student.id);
    if (!subjectIds.length) return [];
    return this.slots(term, and(eq(timetableEntries.classId, student.classId), inArray(timetableEntries.subjectId, subjectIds)));
  }

  @Get('class/:classId')
  async forClass(@CurrentUser() user: AuthUser, @Param('classId', ParseUUIDPipe) classId: string, @Query('termId') termId?: string) {
    await this.access.assertCanReadClass(user, classId);
    const term = await this.termOrCurrent(termId);
    if (!term) return [];
    return this.slots(term, eq(timetableEntries.classId, classId));
  }

  @RequirePermissions('timetable:manage')
  @Post()
  async create(@Body(new ZodPipe(timetableEntrySchema)) body: TimetableEntryInput) {
    const [assigned] = await this.db
      .select({ teacherId: classSubjects.teacherId })
      .from(classSubjects)
      .where(and(eq(classSubjects.classId, body.classId), eq(classSubjects.subjectId, body.subjectId)));
    if (!assigned) throw new NotFoundException('Add this subject to the class before timetabling it');

    const [profile] = await this.db.select({ b: schoolProfile.bellSchedule }).from(schoolProfile).where(eq(schoolProfile.id, 1));
    const activity = activityAt(profile?.b ?? DEFAULT_BELL_SCHEDULE, body.dayOfWeek, body.startsAt, body.endsAt);
    if (activity) throw new ConflictException(`${activity.label} takes place at this time (${activity.startsAt}–${activity.endsAt})`);

    const overlaps = and(
      eq(timetableEntries.termId, body.termId),
      eq(timetableEntries.dayOfWeek, body.dayOfWeek),
      lt(timetableEntries.startsAt, body.endsAt),
      gt(timetableEntries.endsAt, body.startsAt),
    );
    const sameTime = await this.db
      .select({ subjectId: timetableEntries.subjectId, subjectName: subjects.name })
      .from(timetableEntries)
      .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
      .where(and(overlaps, eq(timetableEntries.classId, body.classId)));
    // A split period (e.g. GEOGRAPHY / COMPUTING) is allowed for electives; warn when some option takes both.
    const warnings: string[] = [];
    for (const other of sameTime) {
      const check = await this.curriculum.splitCheck(body.classId, body.subjectId, other.subjectId);
      if (!check.allowed) throw new ConflictException(`The class already has ${other.subjectName} at this time`);
      for (const o of check.clashingOptions) warnings.push(`${o} takes both subjects in this period`);
    }

    if (assigned.teacherId) {
      const busy = await this.db
        .select({ className: classes.name, subjectId: timetableEntries.subjectId, subjectName: subjects.name })
        .from(timetableEntries)
        .innerJoin(classSubjects, and(eq(classSubjects.classId, timetableEntries.classId), eq(classSubjects.subjectId, timetableEntries.subjectId)))
        .innerJoin(classes, eq(classes.id, timetableEntries.classId))
        .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
        .where(and(overlaps, eq(classSubjects.teacherId, assigned.teacherId), ne(timetableEntries.classId, body.classId)));
      // The same subject at the same time is a combined lesson (one teacher, several classes together).
      // A different subject means the teacher really would be in two places.
      for (const b of busy) {
        if (b.subjectId !== body.subjectId) warnings.push(`The teacher is also teaching ${b.subjectName} to ${b.className} at this time`);
      }
    }

    const [row] = await this.db.insert(timetableEntries).values({ ...body, room: body.room ?? null }).returning({ id: timetableEntries.id });
    return { ...row, warnings: [...new Set(warnings)].sort() };
  }

  @RequirePermissions('timetable:manage')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.db.delete(timetableEntries).where(eq(timetableEntries.id, id));
  }
}

@Module({ controllers: [TimetableController] })
export class TimetableModule {}
