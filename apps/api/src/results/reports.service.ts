import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  DEFAULT_ASSESSMENT_SCHEMES,
  DEFAULT_GRADING_SCALE,
  gpaFor,
  isLeadership,
  roundGpa,
  type ReportCard,
  type ReportRemarks,
  type ReportRemarksInput,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import {
  academicYears,
  classes,
  houses,
  programmes,
  reportRemarks,
  results,
  schoolProfile,
  students,
  subjectCombinations,
  subjects,
  terms,
  users,
} from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../access/access.service';
import { AttendanceService, attendanceCounts } from '../attendance/attendance.service';

const round2 = (n: number) => Math.round(n * 100) / 100;
const NO_REMARKS: ReportRemarks = { conduct: null, attitude: null, interest: null, formMasterRemark: null, headRemark: null };

/**
 * Terminal report cards. Students and parents see published marks only;
 * leadership and the class's form master can also preview marks still being
 * entered (the card is then marked as a draft) and write the remarks.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
  ) {}

  /** May this user see drafts of, and write remarks on, this class's reports? */
  private async staffScope(user: AuthUser, classId: string): Promise<'leadership' | 'form_master' | null> {
    if (isLeadership(user.role)) return 'leadership';
    if (user.role === 'teacher' && (await this.access.isFormMaster(user.id, classId))) return 'form_master';
    return null;
  }

  async forStudent(user: AuthUser, termId: string, studentId?: string): Promise<ReportCard> {
    if (user.role === 'student' || user.role === 'parent') {
      const own = await this.access.resolveOwnStudent(user, studentId);
      const [card] = await this.build(termId, [own.id], false);
      if (!card) throw new NotFoundException('No report for this semester yet');
      return card;
    }
    if (!studentId) throw new BadRequestException('Choose a student');
    const [row] = await this.db.select({ classId: students.classId }).from(students).where(eq(students.id, studentId));
    if (!row || !(await this.staffScope(user, row.classId))) throw new NotFoundException('Student not found');
    const [card] = await this.build(termId, [studentId], true);
    if (!card) throw new NotFoundException('Student not found');
    return card;
  }

  /** Every student in a class, for printing the whole set. */
  async forClass(user: AuthUser, termId: string, classId: string): Promise<ReportCard[]> {
    if (!(await this.staffScope(user, classId))) throw new NotFoundException('Class not found');
    const roster = await this.db.select({ id: students.id }).from(students).where(eq(students.classId, classId));
    return this.build(termId, roster.map((r) => r.id), true);
  }

  async saveRemarks(user: AuthUser, input: ReportRemarksInput, ip: string | null): Promise<ReportRemarks> {
    const [student] = await this.db.select({ classId: students.classId }).from(students).where(eq(students.id, input.studentId));
    if (!student) throw new NotFoundException('Student not found');
    const scope = await this.staffScope(user, student.classId);
    if (!scope) throw new ForbiddenException("Only the class's form master or the school administration can write report remarks");
    if (input.headRemark !== undefined && scope !== 'leadership') {
      throw new ForbiddenException("Only the school administration can write the head's remark");
    }
    const [term] = await this.db.select({ id: terms.id }).from(terms).where(eq(terms.id, input.termId));
    if (!term) throw new BadRequestException('Semester not found');

    const { termId, studentId, ...fields } = input;
    const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const [row] = await this.db
      .insert(reportRemarks)
      .values({ termId, studentId, ...changes, updatedBy: user.id })
      .onConflictDoUpdate({ target: [reportRemarks.studentId, reportRemarks.termId], set: { ...changes, updatedBy: user.id, updatedAt: new Date() } })
      .returning();
    await this.audit.record({
      actorId: user.id,
      action: 'report.remarks_saved',
      entityType: 'student',
      entityId: studentId,
      metadata: { termId, fields: Object.keys(changes) },
      ip,
    });
    return { conduct: row.conduct, attitude: row.attitude, interest: row.interest, formMasterRemark: row.formMasterRemark, headRemark: row.headRemark };
  }

  private async build(termId: string, studentIds: string[], includeUnpublished: boolean): Promise<ReportCard[]> {
    if (!studentIds.length) return [];
    const [term] = await this.db
      .select({ id: terms.id, name: terms.name, semester: terms.semester, startsOn: terms.startsOn, endsOn: terms.endsOn, academicYearName: academicYears.name })
      .from(terms)
      .innerJoin(academicYears, eq(academicYears.id, terms.academicYearId))
      .where(eq(terms.id, termId));
    if (!term) throw new NotFoundException('Semester not found');
    const [next] = await this.db.select({ startsOn: terms.startsOn }).from(terms).where(gt(terms.startsOn, term.endsOn)).orderBy(asc(terms.startsOn)).limit(1);

    const [profile] = await this.db.select().from(schoolProfile).where(eq(schoolProfile.id, 1));
    const bands = profile?.gradingScale?.bands ?? DEFAULT_GRADING_SCALE;
    const components = (profile?.assessmentSchemes ?? DEFAULT_ASSESSMENT_SCHEMES)[term.semester === 2 ? '2' : '1'];

    const formMaster = alias(users, 'form_master');
    const people = await this.db
      .select({
        id: students.id,
        fullName: users.fullName,
        admissionNo: students.studentNumber,
        gender: students.gender,
        classId: classes.id,
        className: classes.name,
        form: classes.form,
        letter: subjectCombinations.letter,
        programmeName: programmes.name,
        houseName: houses.name,
        formMasterName: formMaster.fullName,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .innerJoin(classes, eq(classes.id, students.classId))
      .innerJoin(programmes, eq(programmes.id, classes.programmeId))
      .leftJoin(subjectCombinations, eq(subjectCombinations.id, students.combinationId))
      .leftJoin(houses, eq(houses.id, students.houseId))
      .leftJoin(formMaster, eq(formMaster.id, classes.formMasterId))
      .where(inArray(students.id, studentIds))
      .orderBy(asc(users.fullName));

    const classIds = [...new Set(people.map((p) => p.classId))];
    const sizes = new Map<string, number>();
    for (const s of await this.db.select({ classId: students.classId }).from(students).where(inArray(students.classId, classIds))) {
      sizes.set(s.classId, (sizes.get(s.classId) ?? 0) + 1);
    }

    const rows = await this.db
      .select({ r: results, subjectName: subjects.name, isCore: subjects.isCore })
      .from(results)
      .innerJoin(subjects, eq(subjects.id, results.subjectId))
      .where(
        and(eq(results.termId, termId), inArray(results.studentId, studentIds), includeUnpublished ? undefined : isNotNull(results.publishedAt)),
      )
      .orderBy(asc(subjects.name));
    const remarkRows = await this.db
      .select()
      .from(reportRemarks)
      .where(and(eq(reportRemarks.termId, termId), inArray(reportRemarks.studentId, studentIds)));
    const remarksBy = new Map(remarkRows.map((r) => [r.studentId, r]));

    const attendanceBy = await this.attendance.statusesFor(studentIds, term);

    const best3 = (points: number[]) => (points.length < 3 ? null : [...points].sort((a, b) => a - b).slice(0, 3).reduce((a, b) => a + b, 0));

    return people.flatMap((p) => {
      const mine = rows.filter((x) => x.r.studentId === p.id);
      // Students and parents get no card until something is published.
      if (!includeUnpublished && !mine.length) return [];
      const subjectRows = mine
        .map(({ r, subjectName, isCore }) => ({
          subjectName,
          isCore,
          scores: components.map((c) => r.scores[c.key] ?? null),
          total: r.total,
          grade: r.grade,
          gpa: gpaFor(r.grade, bands),
          remark: r.remark,
          teacherComment: r.teacherComment,
          published: !!r.publishedAt,
          gradePoint: r.gradePoint,
        }))
        .sort((a, b) => Number(b.isCore) - Number(a.isCore) || a.subjectName.localeCompare(b.subjectName));
      const n = subjectRows.length;
      const core = best3(subjectRows.filter((s) => s.isCore).map((s) => s.gradePoint));
      const elective = best3(subjectRows.filter((s) => !s.isCore).map((s) => s.gradePoint));
      const totalMarks = round2(subjectRows.reduce((sum, s) => sum + s.total, 0));
      const rm = remarksBy.get(p.id);
      const att = attendanceCounts(attendanceBy.get(p.id) ?? []);
      return [
        {
          school: {
            name: profile?.name ?? '',
            motto: profile?.motto ?? null,
            address: profile?.address ?? null,
            phone: profile?.phone ?? null,
            email: profile?.email ?? null,
            logoUrl: profile?.logoUrl ?? null,
          },
          term: {
            id: term.id,
            name: term.name,
            semester: term.semester === 2 ? 2 : 1,
            academicYearName: term.academicYearName,
            endsOn: term.endsOn,
            nextTermBegins: next?.startsOn ?? null,
          },
          student: {
            id: p.id,
            name: p.fullName,
            admissionNo: p.admissionNo,
            className: p.className,
            groupName: `${p.className}${p.letter ?? ''}`,
            programmeName: p.programmeName,
            form: p.form,
            houseName: p.houseName,
            gender: p.gender,
          },
          formMasterName: p.formMasterName,
          classSize: sizes.get(p.classId) ?? 0,
          components: components.map((c) => ({ key: c.key, label: c.label, weight: c.weight })),
          subjects: subjectRows.map(({ gradePoint: _g, ...s }) => s),
          summary: {
            subjects: n,
            average: n ? round2(totalMarks / n) : null,
            gpa: n ? roundGpa(subjectRows.reduce((sum, s) => sum + s.gpa, 0) / n) : null,
            aggregate: core !== null && elective !== null ? core + elective : null,
            totalMarks,
          },
          attendance: att.days ? { attended: att.present + att.late, days: att.days } : null,
          remarks: rm
            ? { conduct: rm.conduct, attitude: rm.attitude, interest: rm.interest, formMasterRemark: rm.formMasterRemark, headRemark: rm.headRemark }
            : NO_REMARKS,
          draft: subjectRows.some((s) => !s.published),
        } satisfies ReportCard,
      ];
    });
  }
}
