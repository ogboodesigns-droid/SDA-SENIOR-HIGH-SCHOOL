import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import {
  DEFAULT_GRADING_SCALE,
  DEFAULT_SCORE_LIMITS,
  gradeFor,
  isLeadership,
  type PublishResultsInput,
  type ResultEntryInput,
  type ResultRow,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { results, schoolProfile, students, subjects, terms, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../access/access.service';
import { NotificationsService } from '../notifications/notifications.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class ResultsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private async scale() {
    const [row] = await this.db.select({ g: schoolProfile.gradingScale }).from(schoolProfile).where(eq(schoolProfile.id, 1));
    return row?.g ?? { ...DEFAULT_SCORE_LIMITS, bands: DEFAULT_GRADING_SCALE };
  }

  private async rows(where: SQL | undefined): Promise<(ResultRow & { isCore: boolean })[]> {
    const rows = await this.db
      .select({
        r: results,
        studentName: users.fullName,
        subjectName: subjects.name,
        isCore: subjects.isCore,
        termName: terms.name,
      })
      .from(results)
      .innerJoin(students, eq(students.id, results.studentId))
      .innerJoin(users, eq(users.id, students.userId))
      .innerJoin(subjects, eq(subjects.id, results.subjectId))
      .innerJoin(terms, eq(terms.id, results.termId))
      .where(where)
      .orderBy(desc(terms.startsOn), desc(subjects.isCore), asc(subjects.name), asc(users.fullName));
    return rows.map(({ r, studentName, subjectName, isCore, termName }) => ({
      id: r.id,
      studentId: r.studentId,
      studentName,
      subjectId: r.subjectId,
      subjectName,
      termId: r.termId,
      termName,
      caScore: r.caScore,
      examScore: r.examScore,
      total: r.total,
      grade: r.grade,
      gradePoint: r.gradePoint,
      isCore,
      remark: r.remark,
      teacherComment: r.teacherComment,
      published: !!r.publishedAt,
    }));
  }

  /** Teacher of the subject (or leadership) enters or corrects marks for a class. */
  async enter(user: AuthUser, input: ResultEntryInput, ip: string | null) {
    await this.access.assertCanTeach(user, input.classId, input.subjectId);
    const scale = await this.scale();

    const ids = input.entries.map((e) => e.studentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each student can appear only once');
    const inClass = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(inArray(students.id, ids), eq(students.classId, input.classId)));
    if (inClass.length !== ids.length) throw new BadRequestException('Some students are not in this class');

    for (const e of input.entries) {
      if (e.caScore > scale.caMax) throw new BadRequestException(`Class assessment scores cannot exceed ${scale.caMax}`);
      if (e.examScore > scale.examMax) throw new BadRequestException(`Examination scores cannot exceed ${scale.examMax}`);
    }

    // Published marks are frozen for teachers; leadership may correct them (and it is audited).
    const published = await this.db
      .select({ studentId: results.studentId })
      .from(results)
      .where(
        and(
          eq(results.termId, input.termId),
          eq(results.subjectId, input.subjectId),
          inArray(results.studentId, ids),
          isNotNull(results.publishedAt),
        ),
      );
    if (published.length && !isLeadership(user.role)) {
      throw new ForbiddenException('Some of these results are already published. Ask the school administration to correct them.');
    }

    await this.db.transaction(async (tx) => {
      for (const e of input.entries) {
        const total = round2(e.caScore + e.examScore);
        const band = gradeFor(total, scale.bands);
        const values = {
          caScore: e.caScore,
          examScore: e.examScore,
          total,
          grade: band.grade,
          gradePoint: band.points,
          remark: band.remark,
          teacherComment: e.teacherComment ?? null,
          enteredBy: user.id,
          classId: input.classId,
        };
        await tx
          .insert(results)
          .values({ ...values, studentId: e.studentId, subjectId: input.subjectId, termId: input.termId })
          .onConflictDoUpdate({ target: [results.studentId, results.subjectId, results.termId], set: values });
      }
    });

    await this.audit.record({
      actorId: user.id,
      action: published.length ? 'results.corrected_after_publish' : 'results.entered',
      entityType: 'results',
      entityId: `${input.classId}:${input.subjectId}:${input.termId}`,
      metadata: { count: input.entries.length, publishedStudentIds: published.map((p) => p.studentId) },
      ip,
    });
    return this.sheet(user, input.termId, input.classId, input.subjectId);
  }

  /** Mark sheet for one class and subject, including unpublished marks. */
  async sheet(user: AuthUser, termId: string, classId: string, subjectId: string) {
    await this.access.assertCanTeach(user, classId, subjectId);
    return this.rows(and(eq(results.termId, termId), eq(results.classId, classId), eq(results.subjectId, subjectId)));
  }

  async publish(user: AuthUser, input: PublishResultsInput, ip: string | null) {
    const published = await this.db
      .update(results)
      .set({ publishedAt: new Date(), publishedBy: user.id })
      .where(
        and(
          eq(results.termId, input.termId),
          eq(results.classId, input.classId),
          input.subjectId ? eq(results.subjectId, input.subjectId) : undefined,
          isNull(results.publishedAt),
        ),
      )
      .returning({ studentId: results.studentId });
    const studentIds = [...new Set(published.map((p) => p.studentId))];
    await this.audit.record({
      actorId: user.id,
      action: 'results.published',
      entityType: 'results',
      entityId: `${input.classId}:${input.subjectId ?? '*'}:${input.termId}`,
      metadata: { rows: published.length },
      ip,
    });
    if (studentIds.length) {
      const [term] = await this.db.select({ name: terms.name }).from(terms).where(eq(terms.id, input.termId));
      await this.notifications.notify(
        await this.notifications.studentAndGuardianUserIds(studentIds),
        { type: 'result_published', title: 'New results published', body: `Results for ${term?.name ?? 'the term'} are now available.`, data: { termId: input.termId } },
        { push: true },
      );
    }
    return { published: published.length, students: studentIds.length };
  }

  /** A student's (or parent's child's) published results. */
  async mine(user: AuthUser, studentId?: string, termId?: string) {
    const student = await this.access.resolveOwnStudent(user, studentId);
    return this.withSummary(
      await this.rows(and(eq(results.studentId, student.id), isNotNull(results.publishedAt), termId ? eq(results.termId, termId) : undefined)),
    );
  }

  /** Staff view of one student's results (all, including unpublished). */
  async forStudent(user: AuthUser, studentId: string, termId?: string) {
    if (user.role === 'student' || user.role === 'parent') return this.mine(user, studentId, termId);
    await this.access.assertCanReadStudent(user, studentId);
    return this.withSummary(await this.rows(and(eq(results.studentId, studentId), termId ? eq(results.termId, termId) : undefined)));
  }

  /**
   * Per-term average, plus the WASSCE-style aggregate: the sum of grade points
   * of the best three core and best three elective subjects (6 is the best
   * possible). Null until a term has at least three of each.
   */
  private withSummary(rows: (ResultRow & { isCore: boolean })[]) {
    const byTerm = new Map<string, { termId: string; termName: string; rows: typeof rows }>();
    for (const r of rows) {
      const t = byTerm.get(r.termId) ?? { termId: r.termId, termName: r.termName, rows: [] };
      t.rows.push(r);
      byTerm.set(r.termId, t);
    }
    const best3 = (points: number[]) => (points.length < 3 ? null : [...points].sort((a, b) => a - b).slice(0, 3).reduce((a, b) => a + b, 0));
    return {
      rows: rows.map(({ isCore: _isCore, ...r }) => r),
      terms: [...byTerm.values()].map((t) => {
        const core = best3(t.rows.filter((r) => r.isCore).map((r) => r.gradePoint));
        const elective = best3(t.rows.filter((r) => !r.isCore).map((r) => r.gradePoint));
        return {
          termId: t.termId,
          termName: t.termName,
          subjects: t.rows.length,
          average: round2(t.rows.reduce((sum, r) => sum + r.total, 0) / t.rows.length),
          aggregate: core !== null && elective !== null ? core + elective : null,
        };
      }),
    };
  }
}
