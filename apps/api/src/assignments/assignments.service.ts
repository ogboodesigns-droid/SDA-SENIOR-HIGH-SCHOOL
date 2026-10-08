import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  isLeadership,
  type AssignmentInput,
  type AssignmentSummary,
  type GradeSubmissionInput,
  type SubmissionInput,
  type SubmissionSummary,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { assignments, classes, files, students, subjects, submissions, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../access/access.service';
import { FilesService } from '../files/files.controller';
import { NotificationsService } from '../notifications/notifications.service';

type AssignmentRow = Omit<AssignmentSummary, 'dueAt' | 'createdAt' | 'mySubmission'> & { dueAt: Date; createdAt: Date };

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private selectAssignments(where: SQL | undefined) {
    return this.db
      .select({
        id: assignments.id,
        title: assignments.title,
        instructions: assignments.instructions,
        dueAt: assignments.dueAt,
        maxScore: assignments.maxScore,
        allowLateSubmissions: assignments.allowLateSubmissions,
        classId: classes.id,
        className: classes.name,
        subjectId: subjects.id,
        subjectName: subjects.name,
        teacherName: users.fullName,
        createdAt: assignments.createdAt,
      })
      .from(assignments)
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .innerJoin(subjects, eq(subjects.id, assignments.subjectId))
      .innerJoin(users, eq(users.id, assignments.teacherId))
      .where(where);
  }

  private async submissionsWhere(where: SQL): Promise<SubmissionSummary[]> {
    const rows = await this.db
      .select({
        s: submissions,
        studentName: users.fullName,
        file: { id: files.id, fileName: files.fileName, mimeType: files.mimeType, sizeBytes: files.sizeBytes },
      })
      .from(submissions)
      .innerJoin(students, eq(students.id, submissions.studentId))
      .innerJoin(users, eq(users.id, students.userId))
      .leftJoin(files, eq(files.id, submissions.fileId))
      .where(where)
      .orderBy(asc(users.fullName));
    return rows.map(({ s, studentName, file }) => ({
      id: s.id,
      assignmentId: s.assignmentId,
      studentId: s.studentId,
      studentName,
      textResponse: s.textResponse,
      file: file?.id ? file : null,
      status: s.status,
      submittedAt: s.submittedAt.toISOString(),
      score: s.score,
      feedback: s.feedback,
      gradedAt: s.gradedAt?.toISOString() ?? null,
    }));
  }

  private toSummary(r: AssignmentRow, mySubmission: SubmissionSummary | null, submissionCount?: number): AssignmentSummary {
    return { ...r, dueAt: r.dueAt.toISOString(), createdAt: r.createdAt.toISOString(), mySubmission, submissionCount };
  }

  /** A student's (or a parent's child's) assignments, newest due date first, with their own submission. */
  async forStudent(user: AuthUser, studentId?: string): Promise<AssignmentSummary[]> {
    const student = await this.access.resolveOwnStudent(user, studentId);
    const rows = await this.selectAssignments(eq(assignments.classId, student.classId)).orderBy(desc(assignments.dueAt)).limit(200);
    const subs = rows.length
      ? await this.submissionsWhere(and(eq(submissions.studentId, student.id), inArray(submissions.assignmentId, rows.map((r) => r.id)))!)
      : [];
    const byAssignment = new Map(subs.map((s) => [s.assignmentId, s]));
    return rows.map((r) => this.toSummary(r, byAssignment.get(r.id) ?? null));
  }

  /** Assignments for classes a teacher teaches (all for leadership), with submission counts. */
  async forStaff(user: AuthUser, classId?: string): Promise<AssignmentSummary[]> {
    if (classId) await this.access.assertCanReadClass(user, classId);
    const scope = isLeadership(user.role) ? undefined : eq(assignments.teacherId, user.id);
    const rows = await this.selectAssignments(and(scope, classId ? eq(assignments.classId, classId) : undefined))
      .orderBy(desc(assignments.dueAt))
      .limit(200);
    const counts = rows.length
      ? await this.db
          .select({ id: submissions.assignmentId, n: count() })
          .from(submissions)
          .where(inArray(submissions.assignmentId, rows.map((r) => r.id)))
          .groupBy(submissions.assignmentId)
      : [];
    const byId = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map((r) => this.toSummary(r, null, byId.get(r.id) ?? 0));
  }

  private async load(id: string) {
    const [a] = await this.db.select().from(assignments).where(eq(assignments.id, id));
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }

  async findOne(user: AuthUser, id: string, studentId?: string): Promise<AssignmentSummary> {
    const a = await this.load(id);
    await this.access.assertCanReadClass(user, a.classId).catch(() => {
      throw new NotFoundException('Assignment not found');
    });
    const [row] = await this.selectAssignments(eq(assignments.id, id));
    let mine: SubmissionSummary | null = null;
    if (user.role === 'student' || user.role === 'parent') {
      const student = await this.access.resolveOwnStudent(user, studentId);
      if (student.classId !== a.classId) throw new NotFoundException('Assignment not found');
      [mine = null] = await this.submissionsWhere(and(eq(submissions.assignmentId, id), eq(submissions.studentId, student.id))!);
    }
    return this.toSummary(row, mine);
  }

  async create(user: AuthUser, input: AssignmentInput, ip: string | null) {
    await this.access.assertCanTeach(user, input.classId, input.subjectId);
    if (new Date(input.dueAt) <= new Date()) throw new BadRequestException('The due date must be in the future');
    const [row] = await this.db
      .insert(assignments)
      .values({ ...input, dueAt: new Date(input.dueAt), teacherId: user.id })
      .returning({ id: assignments.id });
    await this.audit.record({ actorId: user.id, action: 'assignment.created', entityType: 'assignment', entityId: row.id, ip });

    const [subject] = await this.db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, input.subjectId));
    const recipients = await this.notifications.classAudienceUserIds([input.classId], { includeTeachers: false });
    await this.notifications.notify(
      recipients,
      {
        type: 'assignment',
        title: `New ${subject?.name ?? ''} assignment`.replace('  ', ' '),
        body: `${input.title} — due ${new Date(input.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Africa/Accra' })}`,
        data: { assignmentId: row.id },
      },
      { push: true },
    );
    return row;
  }

  private async assertAuthorOrLeader(user: AuthUser, id: string) {
    const a = await this.load(id);
    if (a.teacherId !== user.id && !isLeadership(user.role)) throw new ForbiddenException('Only the teacher who set this assignment can change it');
    return a;
  }

  async update(user: AuthUser, id: string, input: Partial<AssignmentInput>, ip: string | null) {
    await this.assertAuthorOrLeader(user, id);
    const { classId: _c, subjectId: _s, ...rest } = input;
    await this.db
      .update(assignments)
      .set({ ...rest, dueAt: rest.dueAt ? new Date(rest.dueAt) : undefined })
      .where(eq(assignments.id, id));
    await this.audit.record({ actorId: user.id, action: 'assignment.updated', entityType: 'assignment', entityId: id, ip });
  }

  async remove(user: AuthUser, id: string, ip: string | null) {
    await this.assertAuthorOrLeader(user, id);
    await this.db.delete(assignments).where(eq(assignments.id, id));
    await this.audit.record({ actorId: user.id, action: 'assignment.deleted', entityType: 'assignment', entityId: id, ip });
  }

  async submit(user: AuthUser, id: string, input: SubmissionInput): Promise<SubmissionSummary> {
    if (user.role !== 'student') throw new ForbiddenException('Only students can submit assignments');
    const student = await this.access.resolveOwnStudent(user);
    const a = await this.load(id);
    if (a.classId !== student.classId) throw new NotFoundException('Assignment not found');
    if (input.fileId) await this.files.assertOwned(user, input.fileId);

    const late = new Date() > a.dueAt;
    if (late && !a.allowLateSubmissions) throw new BadRequestException('The deadline for this assignment has passed');

    const [existing] = await this.db
      .select({ status: submissions.status })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, id), eq(submissions.studentId, student.id)));
    if (existing?.status === 'graded') throw new BadRequestException('This assignment has already been marked');

    const values = {
      textResponse: input.textResponse ?? null,
      fileId: input.fileId ?? null,
      status: late ? ('late' as const) : ('submitted' as const),
      submittedAt: new Date(),
    };
    await this.db
      .insert(submissions)
      .values({ assignmentId: id, studentId: student.id, ...values })
      .onConflictDoUpdate({ target: [submissions.assignmentId, submissions.studentId], set: values });
    const [mine] = await this.submissionsWhere(and(eq(submissions.assignmentId, id), eq(submissions.studentId, student.id))!);
    return mine;
  }

  async listSubmissions(user: AuthUser, id: string) {
    const a = await this.load(id);
    await this.access.assertCanTeach(user, a.classId, a.subjectId);
    return this.submissionsWhere(eq(submissions.assignmentId, id));
  }

  async grade(user: AuthUser, submissionId: string, input: GradeSubmissionInput, ip: string | null) {
    const [row] = await this.db
      .select({ sub: submissions, a: assignments })
      .from(submissions)
      .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
      .where(eq(submissions.id, submissionId));
    if (!row) throw new NotFoundException('Submission not found');
    await this.access.assertCanTeach(user, row.a.classId, row.a.subjectId);
    if (input.score > row.a.maxScore) throw new BadRequestException(`The score cannot be more than ${row.a.maxScore}`);

    await this.db
      .update(submissions)
      .set({ score: input.score, feedback: input.feedback ?? null, status: 'graded', gradedAt: new Date(), gradedBy: user.id })
      .where(eq(submissions.id, submissionId));
    await this.audit.record({ actorId: user.id, action: 'submission.graded', entityType: 'submission', entityId: submissionId, ip });

    const recipients = await this.notifications.studentAndGuardianUserIds([row.sub.studentId]);
    await this.notifications.notify(
      recipients,
      { type: 'assignment_graded', title: 'Assignment marked', body: `${row.a.title}: ${input.score}/${row.a.maxScore}`, data: { assignmentId: row.a.id } },
      { push: true },
    );
  }
}
