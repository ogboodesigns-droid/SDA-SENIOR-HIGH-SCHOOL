import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  isLeadership,
  academicYearSchema,
  bulkClassesSchema,
  className,
  type BulkClassesInput,
  classSchema,
  classSubjectSchema,
  combinationSchema,
  coreExclusionsSchema,
  type CombinationInput,
  type SubjectCombination,
  programmeSchema,
  subjectSchema,
  termSchema,
  type SubjectWithTeacher,
  type TermSummary,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import {
  academicYears,
  classes,
  classSubjects,
  combinationSubjects,
  programmeCoreExclusions,
  programmes,
  students,
  subjectCombinations,
  subjects,
  terms,
  users,
} from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AccessService } from '../access/access.service';
import { MeService } from '../auth/me.service';
import { CurriculumService } from './curriculum.service';

type Infer<T extends z.ZodType> = z.infer<T>;

/** "2BUS 3" → 3; null when the name doesn't end in a number. */
function streamFromName(name: string): number | null {
  const m = /\s(\d{1,2})$/.exec(name.trim());
  return m ? Number(m[1]) : null;
}

@Controller()
export class AcademicsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly me: MeService,
    private readonly curriculum: CurriculumService,
  ) {}

  // ── Years & terms ─────────────────────────────────────────────────────────

  @Get('terms')
  async listTerms(): Promise<TermSummary[]> {
    const rows = await this.db
      .select({
        id: terms.id,
        name: terms.name,
        academicYearName: academicYears.name,
        startsOn: terms.startsOn,
        endsOn: terms.endsOn,
        semester: terms.semester,
        isCurrent: terms.isCurrent,
      })
      .from(terms)
      .innerJoin(academicYears, eq(academicYears.id, terms.academicYearId))
      .orderBy(desc(terms.startsOn));
    return rows.map((r) => ({ ...r, semester: r.semester === 2 ? 2 : 1 }));
  }

  @Get('academic-years')
  listYears() {
    return this.db.select().from(academicYears).orderBy(desc(academicYears.startsOn));
  }

  @RequirePermissions('academics:manage')
  @Post('academic-years')
  async createYear(@Body(new ZodPipe(academicYearSchema)) body: Infer<typeof academicYearSchema>) {
    const [row] = await this.db.insert(academicYears).values(body).returning();
    return row;
  }

  @RequirePermissions('academics:manage')
  @Post('terms')
  async createTerm(@Body(new ZodPipe(termSchema)) body: Infer<typeof termSchema>) {
    return this.db.transaction(async (tx) => {
      if (body.isCurrent) await tx.update(terms).set({ isCurrent: false }).where(eq(terms.isCurrent, true));
      const [row] = await tx.insert(terms).values(body).returning();
      return row;
    });
  }

  @RequirePermissions('academics:manage')
  @Post('terms/:id/make-current')
  @HttpCode(204)
  async makeCurrent(@Param('id', ParseUUIDPipe) id: string) {
    await this.db.transaction(async (tx) => {
      await tx.update(terms).set({ isCurrent: false }).where(and(eq(terms.isCurrent, true), ne(terms.id, id)));
      const updated = await tx.update(terms).set({ isCurrent: true }).where(eq(terms.id, id)).returning({ id: terms.id });
      if (!updated.length) throw new NotFoundException('Term not found');
    });
  }

  // ── Programmes ────────────────────────────────────────────────────────────

  @Get('programmes')
  listProgrammes() {
    return this.db.select().from(programmes).orderBy(asc(programmes.name));
  }

  @RequirePermissions('academics:manage')
  @Post('programmes')
  async createProgramme(@Body(new ZodPipe(programmeSchema)) body: Infer<typeof programmeSchema>) {
    const [row] = await this.db.insert(programmes).values(body).returning();
    return row;
  }

  @RequirePermissions('academics:manage')
  @Patch('programmes/:id')
  async updateProgramme(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(programmeSchema.partial())) body: Partial<Infer<typeof programmeSchema>>) {
    const [row] = await this.db.update(programmes).set(body).where(eq(programmes.id, id)).returning();
    if (!row) throw new NotFoundException('Programme not found');
    return row;
  }

  // ── Classes ───────────────────────────────────────────────────────────────

  /** Classes the user may see: the whole school for leadership, otherwise their own. */
  @Get('classes')
  async listClasses(@CurrentUser() user: AuthUser) {
    const readable = await this.access.readableClassIds(user);
    if (readable !== 'all' && !readable.length) return [];
    return this.db
      .select({
        id: classes.id,
        name: classes.name,
        form: classes.form,
        stream: classes.stream,
        programmeId: classes.programmeId,
        programmeName: programmes.name,
        programmeCode: programmes.code,
        formMasterId: classes.formMasterId,
        formMasterName: users.fullName,
      })
      .from(classes)
      .innerJoin(programmes, eq(programmes.id, classes.programmeId))
      .leftJoin(users, eq(users.id, classes.formMasterId))
      .where(readable === 'all' ? undefined : inArray(classes.id, readable))
      .orderBy(asc(classes.form), asc(programmes.name), asc(classes.stream), asc(classes.name));
  }

  @RequirePermissions('academics:manage')
  @Post('classes')
  async createClass(@Body(new ZodPipe(classSchema)) body: Infer<typeof classSchema>) {
    await this.assertTeacher(body.formMasterId);
    const [row] = await this.db
      .insert(classes)
      .values({ ...body, stream: body.stream ?? streamFromName(body.name) })
      .returning();
    return row;
  }

  /**
   * Creates "<form> <CODE> <stream>" classes for a programme — e.g. 1 GA 1 … 3 GA 6
   * for six General Arts streams — skipping any that already exist.
   */
  @RequirePermissions('academics:manage')
  @Post('classes/bulk')
  async createClassSet(@Body(new ZodPipe(bulkClassesSchema)) body: BulkClassesInput) {
    const [programme] = await this.db.select().from(programmes).where(eq(programmes.id, body.programmeId));
    if (!programme) throw new NotFoundException('Programme not found');
    if (!programme.code) throw new BadRequestException('Give this programme a code (e.g. BUS) first');
    const values = body.forms.flatMap((form) =>
      Array.from({ length: body.streams }, (_, i) => ({
        name: className(form, programme.code!, i + 1, programme.spacedName),
        form,
        stream: i + 1,
        programmeId: programme.id,
      })),
    );
    const created = await this.db
      .insert(classes)
      .values(values)
      .onConflictDoNothing({ target: classes.name })
      .returning({ id: classes.id, name: classes.name });
    // Give each new class the subjects its options need, ready for teachers to be assigned.
    for (const c of created) await this.curriculum.syncClassSubjects(c.id);
    return { created: created.map((c) => c.name), skipped: values.length - created.length };
  }

  /** Adds the core subjects and option electives a class needs (keeps existing teachers). */
  @RequirePermissions('academics:manage')
  @Post('classes/:id/sync-subjects')
  async syncSubjects(@Param('id', ParseUUIDPipe) id: string) {
    return { added: await this.curriculum.syncClassSubjects(id) };
  }

  // ── Dropped subjects ─────────────────────────────────────────────────────

  /** Students who still need to choose between two electives (or drop one before SHS 3). */
  @RequirePermissions('users:read')
  @Get('subject-choices/pending')
  pendingChoices() {
    return this.curriculum.pendingChoices();
  }

  @RequirePermissions('users:read')
  @Get('students/:id/subject-choice')
  subjectChoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.curriculum.subjectChoice(id);
  }

  // ── Options (subject combinations) ────────────────────────────────────────

  @Get('combinations')
  async listCombinations(@Query('programmeId') programmeId?: string): Promise<SubjectCombination[]> {
    const valid = programmeId && z.uuid().safeParse(programmeId).success ? programmeId : undefined;
    const rows = await this.db
      .select({ c: subjectCombinations, subjectId: subjects.id, subjectName: subjects.name })
      .from(subjectCombinations)
      .leftJoin(combinationSubjects, eq(combinationSubjects.combinationId, subjectCombinations.id))
      .leftJoin(subjects, eq(subjects.id, combinationSubjects.subjectId))
      .where(valid ? eq(subjectCombinations.programmeId, valid) : undefined)
      .orderBy(asc(subjectCombinations.programmeId), asc(subjectCombinations.option), asc(subjects.name));
    const byId = new Map<string, SubjectCombination>();
    for (const r of rows) {
      const c =
        byId.get(r.c.id) ??
        byId
          .set(r.c.id, {
            id: r.c.id,
            programmeId: r.c.programmeId,
            option: r.c.option,
            stream: r.c.stream,
            letter: r.c.letter,
            mustDropOne: r.c.mustDropOne,
            electives: [],
          })
          .get(r.c.id)!;
      if (r.subjectId && r.subjectName) c.electives.push({ id: r.subjectId, name: r.subjectName });
    }
    return [...byId.values()];
  }

  @RequirePermissions('academics:manage')
  @Post('combinations')
  async createCombination(@Body(new ZodPipe(combinationSchema)) body: CombinationInput) {
    return this.db.transaction(async (tx) => {
      const { electiveSubjectIds, ...values } = body;
      const [row] = await tx.insert(subjectCombinations).values(values).returning();
      await tx.insert(combinationSubjects).values([...new Set(electiveSubjectIds)].map((subjectId) => ({ combinationId: row.id, subjectId })));
      return row;
    });
  }

  @RequirePermissions('academics:manage')
  @Delete('combinations/:id')
  @HttpCode(204)
  async deleteCombination(@Param('id', ParseUUIDPipe) id: string) {
    // Students on this option keep their class and fall back to the class's subjects.
    await this.db.delete(subjectCombinations).where(eq(subjectCombinations.id, id));
  }

  @Get('programmes/:id/core-exclusions')
  async coreExclusions(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.db
      .select({ id: programmeCoreExclusions.subjectId })
      .from(programmeCoreExclusions)
      .where(eq(programmeCoreExclusions.programmeId, id));
    return { subjectIds: rows.map((r) => r.id) };
  }

  @RequirePermissions('academics:manage')
  @Put('programmes/:id/core-exclusions')
  async setCoreExclusions(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(coreExclusionsSchema)) body: { subjectIds: string[] }) {
    await this.db.transaction(async (tx) => {
      await tx.delete(programmeCoreExclusions).where(eq(programmeCoreExclusions.programmeId, id));
      if (body.subjectIds.length) {
        await tx.insert(programmeCoreExclusions).values(body.subjectIds.map((subjectId) => ({ programmeId: id, subjectId })));
      }
    });
    return this.coreExclusions(id);
  }

  @RequirePermissions('academics:manage')
  @Patch('classes/:id')
  async updateClass(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(classSchema.partial())) body: Partial<Infer<typeof classSchema>>) {
    await this.assertTeacher(body.formMasterId);
    const [row] = await this.db
      .update(classes)
      .set({ ...body, stream: body.stream ?? (body.name ? streamFromName(body.name) : undefined) }).where(eq(classes.id, id)).returning();
    if (!row) throw new NotFoundException('Class not found');
    return row;
  }

  /** Class list for teachers of the class and school leadership. Students and parents cannot list classmates. */
  @Get('classes/:id/students')
  async classStudents(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('subjectId') subjectId?: string) {
    if (user.role !== 'teacher' && !isLeadership(user.role)) throw new NotFoundException('Class not found');
    await this.access.assertCanReadClass(user, id);
    // With ?subjectId, only students whose option includes that subject (e.g. for a mark sheet).
    const ids =
      subjectId && z.uuid().safeParse(subjectId).success
        ? await this.curriculum.studentIdsTakingSubject(id, subjectId)
        : (await this.db.select({ id: students.id }).from(students).where(eq(students.classId, id))).map((r) => r.id);
    return this.me.studentSummaries({ studentIds: ids });
  }

  @Get('classes/:id/subjects')
  async classSubjectList(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SubjectWithTeacher[]> {
    await this.access.assertCanReadClass(user, id);
    return this.subjectsFor(eq(classSubjects.classId, id));
  }

  /** Subjects for the signed-in student, or for one of a parent's children via ?studentId. */
  @Get('me/subjects')
  async mySubjects(@CurrentUser() user: AuthUser, @Query('studentId') studentId?: string): Promise<SubjectWithTeacher[]> {
    const student = await this.access.resolveOwnStudent(user, studentId);
    const ids = await this.curriculum.subjectIdsForStudent(student.id);
    if (!ids.length) return [];
    return this.db
      .select({
        classSubjectId: classSubjects.id,
        subjectId: subjects.id,
        code: subjects.code,
        name: subjects.name,
        isCore: subjects.isCore,
        teacherId: classSubjects.teacherId,
        teacherName: users.fullName,
      })
      .from(subjects)
      .leftJoin(classSubjects, and(eq(classSubjects.subjectId, subjects.id), eq(classSubjects.classId, student.classId)))
      .leftJoin(users, eq(users.id, classSubjects.teacherId))
      .where(inArray(subjects.id, ids))
      .orderBy(desc(subjects.isCore), asc(subjects.name));
  }

  /** Every class-subject the signed-in teacher is assigned to. */
  @Get('me/teaching')
  async myTeaching(@CurrentUser() user: AuthUser) {
    return this.db
      .select({
        classSubjectId: classSubjects.id,
        classId: classes.id,
        className: classes.name,
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(classSubjects)
      .innerJoin(classes, eq(classes.id, classSubjects.classId))
      .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
      .where(eq(classSubjects.teacherId, user.id))
      .orderBy(asc(classes.name), asc(subjects.name));
  }

  private subjectsFor(where: ReturnType<typeof eq>) {
    return this.db
      .select({
        classSubjectId: classSubjects.id,
        subjectId: subjects.id,
        code: subjects.code,
        name: subjects.name,
        isCore: subjects.isCore,
        teacherId: classSubjects.teacherId,
        teacherName: users.fullName,
      })
      .from(classSubjects)
      .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
      .leftJoin(users, eq(users.id, classSubjects.teacherId))
      .where(where)
      .orderBy(desc(subjects.isCore), asc(subjects.name));
  }

  // ── Subjects ──────────────────────────────────────────────────────────────

  @Get('subjects')
  listSubjects() {
    return this.db.select().from(subjects).orderBy(desc(subjects.isCore), asc(subjects.name));
  }

  @RequirePermissions('academics:manage')
  @Post('subjects')
  async createSubject(@Body(new ZodPipe(subjectSchema)) body: Infer<typeof subjectSchema>) {
    const [row] = await this.db.insert(subjects).values({ ...body, code: body.code.toUpperCase() }).returning();
    return row;
  }

  @RequirePermissions('academics:manage')
  @Patch('subjects/:id')
  async updateSubject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(subjectSchema.partial())) body: Partial<Infer<typeof subjectSchema>>) {
    const [row] = await this.db
      .update(subjects)
      .set({ ...body, code: body.code?.toUpperCase() })
      .where(eq(subjects.id, id))
      .returning();
    if (!row) throw new NotFoundException('Subject not found');
    return row;
  }

  /** Add a subject to a class, or change who teaches it. */
  @RequirePermissions('academics:manage')
  @Put('class-subjects')
  async assignSubject(@Body(new ZodPipe(classSubjectSchema)) body: Infer<typeof classSubjectSchema>) {
    await this.assertTeacher(body.teacherId);
    const [row] = await this.db
      .insert(classSubjects)
      .values({ ...body, teacherId: body.teacherId ?? null })
      .onConflictDoUpdate({ target: [classSubjects.classId, classSubjects.subjectId], set: { teacherId: body.teacherId ?? null } })
      .returning();
    return row;
  }

  @RequirePermissions('academics:manage')
  @Delete('class-subjects/:id')
  @HttpCode(204)
  async removeSubject(@Param('id', ParseUUIDPipe) id: string) {
    await this.db.delete(classSubjects).where(eq(classSubjects.id, id));
  }

  private async assertTeacher(userId: string | null | undefined) {
    if (!userId) return;
    const [row] = await this.db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (!row || !['teacher', 'head', 'assistant_head'].includes(row.role)) {
      throw new NotFoundException('Choose a teacher account');
    }
  }
}
