import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  DEFAULT_CREDITS_PER_SUBJECT,
  DEFAULT_GRADING_SCALE,
  gpaFor,
  isLeadership,
  isPass,
  roundGpa,
  type Transcript,
  type TranscriptCourse,
  type TranscriptYear,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { academicYears, classes, programmes, results, schoolProfile, students, subjects, terms, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AccessService } from '../access/access.service';
import { ADMISSION_NO } from '../imports/admission';

/**
 * The official transcript, laid out like the school's: a record per year of
 * study with each subject's GPA and final grade for Semester 1 and 2, then the
 * cumulative GPA (the average over every subject-semester) and the credits
 * earned (a fixed number per subject passed). Only published results count.
 */
@Injectable()
export class TranscriptService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
  ) {}

  async build(user: AuthUser, studentId: string): Promise<Transcript> {
    // Students and parents may see their own; among staff, only school leadership issues transcripts.
    if (user.role === 'student' || user.role === 'parent') await this.access.resolveOwnStudent(user, studentId);
    else if (!isLeadership(user.role)) throw new ForbiddenException('Only the school administration can issue transcripts');

    const [student] = await this.db
      .select({
        id: students.id,
        fullName: users.fullName,
        surname: students.surname,
        firstName: students.firstName,
        otherNames: students.otherNames,
        admissionNo: students.studentNumber,
        dateOfBirth: students.dateOfBirth,
        admissionDate: students.admissionDate,
        assessmentRefId: students.assessmentRefId,
        studyArea: programmes.name,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .innerJoin(classes, eq(classes.id, students.classId))
      .innerJoin(programmes, eq(programmes.id, classes.programmeId))
      .where(eq(students.id, studentId));
    if (!student) throw new NotFoundException('Student not found');

    const [profile] = await this.db.select().from(schoolProfile).where(eq(schoolProfile.id, 1));
    const bands = profile?.gradingScale?.bands ?? DEFAULT_GRADING_SCALE;
    const creditsPerSubject = profile?.gradingScale?.creditsPerSubject ?? DEFAULT_CREDITS_PER_SUBJECT;

    const rows = await this.db
      .select({
        grade: results.grade,
        subjectName: subjects.name,
        semester: terms.semester,
        academicYearId: academicYears.id,
        academicYearName: academicYears.name,
        startsOn: academicYears.startsOn,
      })
      .from(results)
      .innerJoin(subjects, eq(subjects.id, results.subjectId))
      .innerJoin(terms, eq(terms.id, results.termId))
      .innerJoin(academicYears, eq(academicYears.id, terms.academicYearId))
      .where(and(eq(results.studentId, studentId), isNotNull(results.publishedAt)))
      .orderBy(asc(academicYears.startsOn), asc(subjects.name));

    const admissionYear = student.admissionDate
      ? Number(student.admissionDate.slice(0, 4))
      : ADMISSION_NO.test(student.admissionNo)
        ? 2000 + Number(ADMISSION_NO.exec(student.admissionNo)![1])
        : null;

    const years = new Map<string, TranscriptYear & { byName: Map<string, TranscriptCourse>; startYear: number }>();
    let gpaSum = 0;
    let gpaCount = 0;
    let passes = 0;
    for (const r of rows) {
      let y = years.get(r.academicYearId);
      if (!y) {
        y = { year: 0, academicYearName: r.academicYearName, courses: [], byName: new Map(), startYear: Number(r.startsOn.slice(0, 4)) };
        years.set(r.academicYearId, y);
      }
      let course = y.byName.get(r.subjectName);
      if (!course) {
        course = { subjectName: r.subjectName, semesters: [null, null] };
        y.byName.set(r.subjectName, course);
        y.courses.push(course);
      }
      const gpa = gpaFor(r.grade, bands);
      course.semesters[r.semester === 2 ? 1 : 0] = { gpa, grade: r.grade };
      gpaSum += gpa;
      gpaCount += 1;
      if (isPass(r.grade, bands)) passes += 1;
    }

    const ordered = [...years.values()].sort((a, b) => a.startYear - b.startYear);
    ordered.forEach((y, i) => {
      // Year of study counted from admission (a 2024 admission's 2025/2026 is Year 2); otherwise in order.
      y.year = admissionYear !== null && y.startYear >= admissionYear ? y.startYear - admissionYear + 1 : i + 1;
    });

    const sortedBands = [...bands].sort((a, b) => b.min - a.min);
    const name =
      student.surname && student.firstName
        ? [student.surname, student.firstName, student.otherNames].filter(Boolean).join(' ')
        : student.fullName;

    return {
      school: {
        name: profile?.name ?? '',
        address: profile?.address ?? null,
        phone: profile?.phone ?? null,
        email: profile?.email ?? null,
        gpsAddress: profile?.gpsAddress ?? null,
        logoUrl: profile?.logoUrl ?? null,
      },
      student: {
        id: student.id,
        name: name.toUpperCase(),
        admissionNo: student.admissionNo,
        studyArea: student.studyArea.toUpperCase(),
        dateOfBirth: student.dateOfBirth,
        yearOfAdmission: admissionYear,
        assessmentRefId: student.assessmentRefId,
      },
      years: ordered.map(({ year, academicYearName, courses }) => ({ year, academicYearName, courses })),
      cumulativeGpa: gpaCount ? roundGpa(gpaSum / gpaCount) : null,
      creditsEarned: passes * creditsPerSubject,
      creditsPerSubject,
      gradeInterpretation: sortedBands.map((b, i) => ({
        grade: b.grade,
        gpa: b.gpa ?? 0,
        min: b.min,
        max: i === 0 ? 100 : sortedBands[i - 1].min - 1,
        remark: b.remark,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
