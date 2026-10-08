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

  private slots(where: SQL | undefined): Promise<TimetableSlot[]> {
    return this.db
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
      .where(where)
      .orderBy(asc(timetableEntries.dayOfWeek), asc(timetableEntries.startsAt))
      .then((rows) => rows.map((r) => ({ ...r, startsAt: r.startsAt.slice(0, 5), endsAt: r.endsAt.slice(0, 5) })));
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
      return this.slots(and(eq(timetableEntries.termId, term), eq(classSubjects.teacherId, user.id)));
    }
    const student = await this.access.resolveOwnStudent(user, studentId);
    // Elective periods for other options in the class are left out.
    const subjectIds = await this.curriculum.subjectIdsForStudent(student.id);
    if (!subjectIds.length) return [];
    return this.slots(
      and(eq(timetableEntries.termId, term), eq(timetableEntries.classId, student.classId), inArray(timetableEntries.subjectId, subjectIds)),
    );
  }

  @Get('class/:classId')
  async forClass(@CurrentUser() user: AuthUser, @Param('classId', ParseUUIDPipe) classId: string, @Query('termId') termId?: string) {
    await this.access.assertCanReadClass(user, classId);
    const term = await this.termOrCurrent(termId);
    if (!term) return [];
    return this.slots(and(eq(timetableEntries.termId, term), eq(timetableEntries.classId, classId)));
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
      const [teacherClash] = await this.db
        .select({ className: classes.name })
        .from(timetableEntries)
        .innerJoin(classSubjects, and(eq(classSubjects.classId, timetableEntries.classId), eq(classSubjects.subjectId, timetableEntries.subjectId)))
        .innerJoin(classes, eq(classes.id, timetableEntries.classId))
        .where(and(overlaps, eq(classSubjects.teacherId, assigned.teacherId), ne(timetableEntries.classId, body.classId)))
        .limit(1);
      // Combined lessons (e.g. French for two classes together) are real, so this only warns.
      if (teacherClash) warnings.push(`The teacher is also timetabled with ${teacherClash.className} at this time (combined lesson?)`);
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
