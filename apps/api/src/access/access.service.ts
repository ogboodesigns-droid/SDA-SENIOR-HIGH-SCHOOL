import { BadRequestException, ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { isLeadership, type AudienceType } from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { classes, classSubjects, guardianStudents, students } from '../database/schema';
import type { AuthUser } from '../common/auth-user';

/** What an announcement or event must match for a user to see it. */
export interface AudienceContext {
  role: AuthUser['role'];
  classIds: string[];
  forms: number[];
  programmeIds: string[];
  /** Leadership see everything that was ever targeted. */
  seesAll: boolean;
}

/**
 * Record-level access rules. Route permissions say *what kind* of action a
 * role may take; this service decides *which records* a particular user may
 * touch:
 *   - students: only themselves
 *   - parents/guardians: only students they are linked to
 *   - teachers: classes where they teach a subject or are form master
 *   - head / assistant head / super admin: whole school
 *   - other staff roles: no student academic records in V1
 */
@Injectable()
export class AccessService {
  constructor(@InjectDb() private readonly db: Database) {}

  async studentIdForUser(userId: string): Promise<string | null> {
    const [row] = await this.db.select({ id: students.id }).from(students).where(eq(students.userId, userId)).limit(1);
    return row?.id ?? null;
  }

  /**
   * The student a student/parent is asking about. Students always get
   * themselves; parents must name a linked child (or have exactly one).
   */
  async resolveOwnStudent(user: AuthUser, requestedStudentId?: string): Promise<{ id: string; classId: string }> {
    let studentId: string | null = null;
    if (user.role === 'student') {
      studentId = await this.studentIdForUser(user.id);
      if (requestedStudentId && requestedStudentId !== studentId) studentId = null;
    } else if (user.role === 'parent') {
      const children = await this.childStudentIds(user.id);
      if (requestedStudentId) studentId = children.includes(requestedStudentId) ? requestedStudentId : null;
      else if (children.length === 1) studentId = children[0];
      else if (children.length > 1) throw new BadRequestException('Choose which child to view');
    }
    if (!studentId) throw new NotFoundException('Student not found');
    const [row] = await this.db.select({ id: students.id, classId: students.classId }).from(students).where(eq(students.id, studentId));
    if (!row) throw new NotFoundException('Student not found');
    return row;
  }

  async childStudentIds(guardianUserId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: guardianStudents.studentId })
      .from(guardianStudents)
      .where(eq(guardianStudents.guardianUserId, guardianUserId));
    return rows.map((r) => r.id);
  }

  /** Classes a teacher teaches in or is form master of. */
  async teacherClassIds(teacherId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ id: classes.id })
      .from(classes)
      .leftJoin(classSubjects, eq(classSubjects.classId, classes.id))
      .where(or(eq(classes.formMasterId, teacherId), eq(classSubjects.teacherId, teacherId)));
    return rows.map((r) => r.id);
  }

  async isFormMaster(teacherId: string, classId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.formMasterId, teacherId)))
      .limit(1);
    return !!row;
  }

  async teachesSubject(teacherId: string, classId: string, subjectId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: classSubjects.id })
      .from(classSubjects)
      .where(and(eq(classSubjects.classId, classId), eq(classSubjects.subjectId, subjectId), eq(classSubjects.teacherId, teacherId)))
      .limit(1);
    return !!row;
  }

  /** Leadership, or the teacher assigned to this subject in this class. */
  async assertCanTeach(user: AuthUser, classId: string, subjectId: string): Promise<void> {
    if (isLeadership(user.role)) return;
    if (user.role === 'teacher' && (await this.teachesSubject(user.id, classId, subjectId))) return;
    throw new ForbiddenException('You are not assigned to teach this subject in this class');
  }

  /**
   * Student ids whose records the user may read, or 'all' for leadership.
   * The empty array means none.
   */
  async readableStudentIds(user: AuthUser): Promise<string[] | 'all'> {
    if (isLeadership(user.role)) return 'all';
    switch (user.role) {
      case 'student': {
        const id = await this.studentIdForUser(user.id);
        return id ? [id] : [];
      }
      case 'parent':
        return this.childStudentIds(user.id);
      case 'teacher': {
        const classIds = await this.teacherClassIds(user.id);
        if (!classIds.length) return [];
        const rows = await this.db.select({ id: students.id }).from(students).where(inArray(students.classId, classIds));
        return rows.map((r) => r.id);
      }
      default:
        return [];
    }
  }

  async assertCanReadStudent(user: AuthUser, studentId: string): Promise<void> {
    const readable = await this.readableStudentIds(user);
    if (readable === 'all' || readable.includes(studentId)) return;
    // Same response whether the student exists or not, so ids can't be probed.
    throw new NotFoundException('Student not found');
  }

  /** Class ids the user may read class-level information (timetable, assignments) for. */
  async readableClassIds(user: AuthUser): Promise<string[] | 'all'> {
    if (isLeadership(user.role)) return 'all';
    switch (user.role) {
      case 'teacher':
        return this.teacherClassIds(user.id);
      case 'student':
      case 'parent': {
        const studentIds = await (user.role === 'student'
          ? this.studentIdForUser(user.id).then((id) => (id ? [id] : []))
          : this.childStudentIds(user.id));
        if (!studentIds.length) return [];
        const rows = await this.db
          .selectDistinct({ classId: students.classId })
          .from(students)
          .where(inArray(students.id, studentIds));
        return rows.map((r) => r.classId);
      }
      default:
        return [];
    }
  }

  async assertCanReadClass(user: AuthUser, classId: string): Promise<void> {
    const readable = await this.readableClassIds(user);
    if (readable === 'all' || readable.includes(classId)) return;
    throw new NotFoundException('Class not found');
  }

  async audienceContext(user: AuthUser): Promise<AudienceContext> {
    const readable = await this.readableClassIds(user);
    if (readable === 'all') return { role: user.role, classIds: [], forms: [], programmeIds: [], seesAll: true };
    const rows = readable.length
      ? await this.db
          .select({ id: classes.id, form: classes.form, programmeId: classes.programmeId })
          .from(classes)
          .where(inArray(classes.id, readable))
      : [];
    return {
      role: user.role,
      classIds: rows.map((r) => r.id),
      forms: [...new Set(rows.map((r) => r.form))],
      programmeIds: [...new Set(rows.map((r) => r.programmeId))],
      seesAll: false,
    };
  }

  /**
   * SQL condition restricting rows with audience_type/audience_ref columns to
   * those addressed to the user.
   */
  audienceFilter(
    ctx: AudienceContext,
    cols: { audienceType: PgColumn; audienceRef: PgColumn },
  ): SQL | undefined {
    if (ctx.seesAll) return undefined;
    const t = cols.audienceType;
    const r = cols.audienceRef;
    const match = (type: AudienceType, refs: string[]) =>
      refs.length ? and(eq(t, type), inArray(r, refs)) : sql`false`;
    return or(
      eq(t, 'school'),
      and(eq(t, 'role'), eq(r, ctx.role)),
      match('form', ctx.forms.map(String)),
      match('programme', ctx.programmeIds),
      match('class', ctx.classIds),
    );
  }
}

@Global()
@Module({ providers: [AccessService], exports: [AccessService] })
export class AccessModule {}
