import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  isLeadership,
  type AttendanceCounts,
  type AttendanceOverviewRow,
  type AttendanceRegister,
  type AttendanceRegisterInput,
  type AttendanceStatus,
  type AttendanceSummaryRow,
  type MyAttendance,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { attendanceRecords, classes, students, subjectCombinations, terms, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../access/access.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Today's date in Ghana (GMT, no daylight saving). */
export const todayInGhana = () => new Date().toISOString().slice(0, 10);

/** Counts for a set of register marks. Late counts as present. */
export function attendanceCounts(statuses: AttendanceStatus[]): AttendanceCounts {
  const c = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const s of statuses) c[s] += 1;
  const days = statuses.length;
  return { ...c, days, percentage: days ? Math.round(((c.present + c.late) / days) * 1000) / 10 : null };
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Leadership, the class's form master, or a teacher who teaches the class. */
  private async assertCanMark(user: AuthUser, classId: string) {
    if (isLeadership(user.role)) return;
    if (user.role === 'teacher' && (await this.access.teacherClassIds(user.id)).includes(classId)) return;
    throw new ForbiddenException("Only the class's teachers or the school administration can take this register");
  }

  /** Classes whose register this user can take: all for leadership, a teacher's own classes otherwise. */
  async markableClasses(user: AuthUser): Promise<{ id: string; name: string; isFormClass: boolean }[]> {
    const ids = isLeadership(user.role) ? null : user.role === 'teacher' ? await this.access.teacherClassIds(user.id) : [];
    if (ids && !ids.length) return [];
    const rows = await this.db
      .select({ id: classes.id, name: classes.name, formMasterId: classes.formMasterId })
      .from(classes)
      .where(ids ? inArray(classes.id, ids) : undefined)
      .orderBy(asc(classes.form), asc(classes.programmeId), asc(classes.stream));
    return rows.map((r) => ({ id: r.id, name: r.name, isFormClass: r.formMasterId === user.id }));
  }

  private async className(classId: string) {
    const [cls] = await this.db.select({ name: classes.name }).from(classes).where(eq(classes.id, classId));
    if (!cls) throw new NotFoundException('Class not found');
    return cls.name;
  }

  private async termFor(date: string) {
    const [term] = await this.db
      .select({ id: terms.id, name: terms.name })
      .from(terms)
      .where(and(lte(terms.startsOn, date), gte(terms.endsOn, date)))
      .limit(1);
    return term ?? null;
  }

  async register(user: AuthUser, classId: string, date: string): Promise<AttendanceRegister> {
    await this.assertCanMark(user, classId);
    const className = await this.className(classId);
    const roster = await this.db
      .select({
        studentId: students.id,
        fullName: users.fullName,
        studentNumber: students.studentNumber,
        letter: subjectCombinations.letter,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .leftJoin(subjectCombinations, eq(subjectCombinations.id, students.combinationId))
      .where(and(eq(students.classId, classId), eq(users.status, 'active')))
      .orderBy(asc(users.fullName));
    const marks = await this.db
      .select({ studentId: attendanceRecords.studentId, status: attendanceRecords.status, note: attendanceRecords.note, by: users.fullName })
      .from(attendanceRecords)
      .innerJoin(users, eq(users.id, attendanceRecords.recordedBy))
      .where(and(eq(attendanceRecords.classId, classId), eq(attendanceRecords.date, date)));
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    return {
      classId,
      className,
      date,
      taken: marks.length > 0,
      takenBy: marks[0]?.by ?? null,
      students: roster.map((r) => ({
        studentId: r.studentId,
        fullName: r.fullName,
        studentNumber: r.studentNumber,
        groupName: `${className}${r.letter ?? ''}`,
        status: byStudent.get(r.studentId)?.status ?? null,
        note: byStudent.get(r.studentId)?.note ?? null,
      })),
    };
  }

  async save(user: AuthUser, input: AttendanceRegisterInput, ip: string | null): Promise<AttendanceRegister> {
    await this.assertCanMark(user, input.classId);
    const today = todayInGhana();
    if (input.date > today) throw new BadRequestException("A register can't be taken for a future date");
    if (!(await this.termFor(input.date))) throw new BadRequestException('That date is not in any semester. Check the date, or set up the semester first.');

    const ids = input.entries.map((e) => e.studentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A student appears twice in the register');
    const inClass = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(inArray(students.id, ids), eq(students.classId, input.classId)));
    if (inClass.length !== ids.length) throw new BadRequestException('Some of these students are not in this class');

    const before = new Map(
      (
        await this.db
          .select({ studentId: attendanceRecords.studentId, status: attendanceRecords.status })
          .from(attendanceRecords)
          .where(and(eq(attendanceRecords.date, input.date), inArray(attendanceRecords.studentId, ids)))
      ).map((r) => [r.studentId, r.status]),
    );

    await this.db
      .insert(attendanceRecords)
      .values(input.entries.map((e) => ({ studentId: e.studentId, classId: input.classId, date: input.date, status: e.status, note: e.note || null, recordedBy: user.id })))
      .onConflictDoUpdate({
        target: [attendanceRecords.studentId, attendanceRecords.date],
        set: {
          status: sql`excluded.status`,
          note: sql`excluded.note`,
          classId: sql`excluded.class_id`,
          recordedBy: sql`excluded.recorded_by`,
          updatedAt: new Date(),
        },
      });

    await this.audit.record({
      actorId: user.id,
      action: 'attendance.recorded',
      entityType: 'class',
      entityId: input.classId,
      metadata: { date: input.date, students: ids.length, absent: input.entries.filter((e) => e.status === 'absent').length },
      ip,
    });

    // Guardians hear the same day when a child is newly marked absent.
    if (input.date === today) {
      const newlyAbsent = input.entries.filter((e) => e.status === 'absent' && before.get(e.studentId) !== 'absent').map((e) => e.studentId);
      if (newlyAbsent.length) {
        const className = await this.className(input.classId);
        const names = await this.db
          .select({ id: students.id, fullName: users.fullName })
          .from(students)
          .innerJoin(users, eq(users.id, students.userId))
          .where(inArray(students.id, newlyAbsent));
        for (const s of names) {
          await this.notifications.notify(
            await this.notifications.guardianUserIds([s.id]),
            {
              type: 'attendance',
              title: 'Absent from school today',
              body: `${s.fullName} was marked absent in the ${className} register today. If this is unexpected, please contact the school.`,
              data: { studentId: s.id, date: input.date },
            },
            { push: true },
          );
        }
      }
    }
    return this.register(user, input.classId, input.date);
  }

  /** Each student's attendance in a class over a semester. */
  async classSummary(user: AuthUser, classId: string, termId: string): Promise<AttendanceSummaryRow[]> {
    await this.assertCanMark(user, classId);
    const term = await this.term(termId);
    const roster = await this.db
      .select({ studentId: students.id, fullName: users.fullName, studentNumber: students.studentNumber })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .where(eq(students.classId, classId))
      .orderBy(asc(users.fullName));
    const byStudent = await this.statusesFor(roster.map((r) => r.studentId), term);
    return roster.map((r) => ({ ...r, ...attendanceCounts(byStudent.get(r.studentId) ?? []) }));
  }

  /** A student's own semester (or a parent's child's): counts and the days missed or late. */
  async mine(user: AuthUser, termId: string, studentId?: string): Promise<MyAttendance> {
    const student = await this.access.resolveOwnStudent(user, studentId);
    const term = await this.term(termId);
    const rows = await this.db
      .select({ date: attendanceRecords.date, status: attendanceRecords.status, note: attendanceRecords.note })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.studentId, student.id), gte(attendanceRecords.date, term.startsOn), lte(attendanceRecords.date, term.endsOn)))
      .orderBy(desc(attendanceRecords.date));
    return {
      termId: term.id,
      termName: term.name,
      counts: attendanceCounts(rows.map((r) => r.status)),
      exceptions: rows.filter((r) => r.status !== 'present'),
    };
  }

  /** Every class: how much of the day's register has been marked. */
  async overview(user: AuthUser, date: string): Promise<AttendanceOverviewRow[]> {
    if (!isLeadership(user.role)) throw new ForbiddenException('Only the school administration can see every register');
    const sizes = await this.db
      .select({ classId: classes.id, className: classes.name, n: count(students.id) })
      .from(classes)
      .leftJoin(students, eq(students.classId, classes.id))
      .groupBy(classes.id)
      .orderBy(asc(classes.form), asc(classes.programmeId), asc(classes.stream));
    const marks = await this.db
      .select({ classId: attendanceRecords.classId, status: attendanceRecords.status, n: count() })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.date, date))
      .groupBy(attendanceRecords.classId, attendanceRecords.status);
    return sizes
      .filter((c) => c.n > 0)
      .map((c) => {
        const mine = marks.filter((m) => m.classId === c.classId);
        const of = (s: AttendanceStatus) => mine.find((m) => m.status === s)?.n ?? 0;
        return { classId: c.classId, className: c.className, students: c.n, marked: mine.reduce((a, m) => a + m.n, 0), absent: of('absent'), late: of('late') };
      });
  }

  /** Register marks per student within a semester's dates. */
  async statusesFor(studentIds: string[], term: { startsOn: string; endsOn: string }): Promise<Map<string, AttendanceStatus[]>> {
    const map = new Map<string, AttendanceStatus[]>();
    if (!studentIds.length) return map;
    const rows = await this.db
      .select({ studentId: attendanceRecords.studentId, status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(and(inArray(attendanceRecords.studentId, studentIds), gte(attendanceRecords.date, term.startsOn), lte(attendanceRecords.date, term.endsOn)));
    for (const r of rows) map.set(r.studentId, [...(map.get(r.studentId) ?? []), r.status]);
    return map;
  }

  private async term(termId: string) {
    const [term] = await this.db
      .select({ id: terms.id, name: terms.name, startsOn: terms.startsOn, endsOn: terms.endsOn })
      .from(terms)
      .where(eq(terms.id, termId));
    if (!term) throw new NotFoundException('Semester not found');
    return term;
  }
}
