import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import {
  DEFAULT_ASSESSMENT_SCHEMES,
  DEFAULT_GRADING_SCALE,
  gradeFor,
  isLeadership,
  summariseScores,
  type GradeImportReport,
  type GradeImportRow,
  type ImportIssue,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { academicYears, results, schoolProfile, students, subjects, terms, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AccessService } from '../access/access.service';
import { CurriculumService } from '../academics/curriculum.service';
import { ResultsService } from '../results/results.service';
import { normaliseAdmissionNo } from './admission';
import { beceIndex, cellNumber, cellText, headerKey } from './cells';
import { groupKey, loadGroups } from './groups';

/** Subject names as written on score sheets, normalised. */
export function subjectKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(peh\)/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}
const SUBJECT_ALIASES: Record<string, string> = {
  pehelective: 'physicaleducationandhealthelective',
  performingart: 'performingarts',
  mathematics: 'generalmathematics',
  coremathematics: 'generalmathematics',
  english: 'englishlanguage',
  literature: 'literatureinenglish',
  akuapemtwi: 'ghanaianlanguageakuapemtwi',
  twi: 'ghanaianlanguageakuapemtwi',
  managementinliving: 'managementinliving',
};

const HEADER_LABELS = ['academic year', 'semester', 'class', 'programme', 'subject', 'subject teacher'];

@Injectable()
export class GradeImportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly curriculum: CurriculumService,
    private readonly resultsService: ResultsService,
  ) {}

  async run(user: AuthUser, buffer: Buffer, opts: { dryRun: boolean; overwrite: boolean }, ip: string | null): Promise<GradeImportReport> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('This file could not be read. Upload the .xlsx score sheet saved from Excel.');
    }
    const ws = wb.getWorksheet('Grade Import') ?? wb.worksheets.find((w) => this.findHeaderRow(w) !== null);
    if (!ws) throw new BadRequestException("No 'Grade Import' sheet was found.");
    const headerRow = this.findHeaderRow(ws);
    if (headerRow === null) throw new BadRequestException("The score sheet has no 'Student ID' column heading.");

    // Header cells: "Academic Year" → value to its right, and so on.
    const header: Record<string, string> = {};
    for (let r = 1; r < headerRow; r++) {
      const row = ws.getRow(r);
      const cells: { col: number; text: string | null }[] = [];
      row.eachCell({ includeEmpty: false }, (cell, col) => cells.push({ col, text: cellText(cell.value) }));
      cells.forEach((c, i) => {
        const label = (c.text ?? '').toLowerCase().replace(/:$/, '');
        if (!HEADER_LABELS.includes(label)) return;
        const value = cells.slice(i + 1).find((n) => n.text && !HEADER_LABELS.includes(n.text.toLowerCase().replace(/:$/, '')));
        if (value?.text) header[label] = value.text;
      });
    }

    const errors: ImportIssue[] = [];
    const fatal = (message: string) => {
      throw new BadRequestException(message);
    };
    // Semester: "Semester 1" in the given academic year.
    const semester = /([12])/.exec(header['semester'] ?? '')?.[1];
    if (!header['academic year'] || !semester) fatal('Fill in the Academic Year and Semester at the top of the sheet.');
    const [term] = await this.db
      .select({ id: terms.id, semester: terms.semester })
      .from(terms)
      .innerJoin(academicYears, eq(academicYears.id, terms.academicYearId))
      .where(and(eq(academicYears.name, header['academic year'].trim()), eq(terms.semester, Number(semester))));
    if (!term) fatal(`${header['academic year']} Semester ${semester} has not been set up. Add it under Classes & subjects.`);

    // Class: a class ("2BUS 1") or an option group ("2BUS 1A").
    const { byCode, byClass } = await loadGroups(this.db);
    const classCode = header['class'] ?? '';
    const target = byCode.get(groupKey(classCode)) ?? byClass.get(groupKey(classCode));
    if (!target) fatal(`"${classCode || '(blank)'}" is not a class in the system.`);

    // Subject.
    const subjectRows = await this.db.select().from(subjects);
    const want = subjectKey(header['subject'] ?? '');
    const subject = subjectRows.find((s) => {
      const k = subjectKey(s.name);
      return k === want || k === SUBJECT_ALIASES[want] || s.code.toLowerCase() === (header['subject'] ?? '').toLowerCase();
    });
    if (!subject) fatal(`"${header['subject'] ?? '(blank)'}" is not a subject in the system.`);
    await this.access.assertCanTeach(user, target!.classId, subject!.id);

    // Columns.
    const cols = new Map<string, number>();
    ws.getRow(headerRow).eachCell((cell, c) => cols.set(headerKey(cell.value), c));
    const [profile] = await this.db.select({ a: schoolProfile.assessmentSchemes, g: schoolProfile.gradingScale }).from(schoolProfile).where(eq(schoolProfile.id, 1));
    const components = (profile?.a ?? DEFAULT_ASSESSMENT_SCHEMES)[term!.semester === 2 ? '2' : '1'];
    const bands = profile?.g?.bands ?? DEFAULT_GRADING_SCALE;
    const firstMark = (cols.get('gender') ?? cols.get('other names') ?? 0) + 1;
    const totalCol = [...cols].find(([k]) => k.startsWith('total'))?.[1] ?? firstMark + components.length;
    const markCols = Array.from({ length: totalCol - firstMark }, (_, i) => firstMark + i);
    if (markCols.length !== components.length) {
      fatal(`The sheet has ${markCols.length} mark columns but the semester has ${components.length} assessment components (${components.map((c) => `${c.label} /${c.weight}`).join(', ')}).`);
    }
    const idCol = cols.get('student id');
    const beceCol = cols.get('bece index no.');

    // Students who take this subject in this class.
    const takers = new Set(await this.curriculum.studentIdsTakingSubject(target!.classId, subject!.id));
    const classStudents = await this.db
      .select({ id: students.id, number: students.studentNumber, bece: students.beceIndexNo, classId: students.classId, fullName: users.fullName })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId));
    const byNumber = new Map(classStudents.map((s) => [s.number, s]));
    const byBece = new Map(classStudents.filter((s) => s.bece).map((s) => [s.bece!, s]));

    const rows: GradeImportRow[] = [];
    const seen = new Map<string, number>();
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const idText = idCol ? cellText(row.getCell(idCol).value) : null;
      const bece = beceCol ? beceIndex(row.getCell(beceCol).value) : null;
      const anyMark = markCols.some((c) => cellText(row.getCell(c).value) !== null);
      if (!idText && (!bece || bece === 'invalid') && !anyMark) continue;
      if (!idText && !bece) continue; // summary lines under the table ("Students", "Class average"…)

      const rowErrors: ImportIssue[] = [];
      const fail = (column: string | null, message: string) => rowErrors.push({ row: r, column, message });
      const student = (idText ? byNumber.get(normaliseAdmissionNo(idText)) : undefined) ?? (bece && bece !== 'invalid' ? byBece.get(bece) : undefined);
      if (!student) fail('Student ID', `${idText ?? bece} is not a registered student`);
      else if (student.classId !== target!.classId) fail('Student ID', `${student.fullName} is not in ${target!.className}`);
      else if (!takers.has(student.id)) fail('Student ID', `${student.fullName} does not take ${subject!.name}`);
      else if (seen.has(student.id)) fail('Student ID', `Repeated: also on row ${seen.get(student.id)}`);
      if (student) seen.set(student.id, r);

      const scores: Record<string, number | null> = {};
      components.forEach((c, i) => {
        const v = cellNumber(row.getCell(markCols[i]).value);
        if (v === 'invalid') fail(c.label, 'Must be a number. Enter 0 if the student has no mark.');
        else if (v !== null && (v < 0 || v > c.weight)) fail(c.label, `Must be between 0 and ${c.weight}`);
        else scores[c.key] = v === null ? null : Math.round(v * 100) / 100;
      });
      const summary = summariseScores(components, scores);
      const anyEntered = Object.values(scores).some((v) => v !== null);
      rows.push({
        row: r,
        admissionNo: student?.number ?? idText ?? '',
        fullName: student?.fullName ?? '',
        scores,
        total: anyEntered ? summary.total : null,
        grade: summary.complete ? gradeFor(summary.total, bands).grade : null,
        complete: summary.complete,
        hasExisting: false,
        ok: rowErrors.length === 0,
      });
      errors.push(...rowErrors);
    }
    if (!rows.length) throw new BadRequestException('The score sheet has no student rows.');

    // Existing marks need an explicit overwrite; published marks are frozen for teachers.
    const ids = rows.filter((r) => r.ok).map((r) => byNumber.get(r.admissionNo)!.id);
    if (ids.length) {
      const existing = await this.db
        .select({ studentId: results.studentId, published: results.publishedAt })
        .from(results)
        .where(and(eq(results.termId, term!.id), eq(results.subjectId, subject!.id), inArray(results.studentId, ids)));
      const ex = new Map(existing.map((e) => [e.studentId, e]));
      for (const row of rows.filter((x) => x.ok)) {
        const e = ex.get(byNumber.get(row.admissionNo)!.id);
        if (!e) continue;
        row.hasExisting = true;
        if (e.published && !isLeadership(user.role)) {
          row.ok = false;
          errors.push({ row: row.row, column: null, message: 'Already published; ask the school administration to correct it' });
        } else if (!opts.overwrite) {
          row.ok = false;
          errors.push({ row: row.row, column: null, message: 'Already has marks for this semester. Tick "Replace existing marks" to overwrite them.' });
        }
      }
    }

    const ok = rows.filter((r) => r.ok);
    const report: GradeImportReport = {
      dryRun: opts.dryRun,
      academicYear: header['academic year'] ?? null,
      semester: `Semester ${semester}`,
      className: target!.className,
      subjectName: subject!.name,
      total: rows.length,
      valid: ok.length,
      rows,
      errors: errors.sort((a, b) => a.row - b.row),
      saved: 0,
    };
    if (opts.dryRun || !ok.length) return report;

    // Blank marks mean "not ready yet", so they don't clear marks already entered.
    await this.resultsService.enter(
      user,
      {
        termId: term!.id,
        classId: target!.classId,
        subjectId: subject!.id,
        entries: ok.map((r) => ({
          studentId: byNumber.get(r.admissionNo)!.id,
          scores: Object.fromEntries(Object.entries(r.scores).filter(([, v]) => v !== null)),
        })),
      },
      ip,
    );
    report.saved = ok.length;
    return report;
  }

  private findHeaderRow(ws: ExcelJS.Worksheet): number | null {
    for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
      let found = false;
      ws.getRow(r).eachCell((cell) => {
        if (headerKey(cell.value) === 'student id') found = true;
      });
      if (found) return r;
    }
    return null;
  }
}

