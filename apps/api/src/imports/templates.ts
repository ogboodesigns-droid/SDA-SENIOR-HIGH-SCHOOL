import { and, asc, eq, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import {
  DEFAULT_ASSESSMENT_SCHEMES,
  DEFAULT_GRADING_SCALE,
  type AssessmentComponent,
} from '@sda-shs/shared';
import type { Database } from '../database/database.module';
import {
  academicYears,
  classes,
  classSubjects,
  combinationSubjects,
  houses,
  programmes,
  results,
  schoolProfile,
  students,
  subjectCombinations,
  subjects,
  terms,
  users,
} from '../database/schema';
import { REQUIRED_STUDENT_COLUMNS, STUDENT_COLUMNS } from './student-import.service';

const DARK = 'FF1F3864';
const LIGHT = 'FFBDD7EE';
const YELLOW = 'FFFFF2CC';
const GREY = 'FFE7E6E6';
const BRAND = 'FFA00561';

const REGIONS = [
  'Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East',
  'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North',
];
const RELATIONSHIPS = ['Father', 'Mother', 'Guardian', 'Uncle', 'Aunt', 'Brother', 'Sister', 'Grandparent', 'Other'];

/** Field guide rows: column, section, rule, example. */
const GUIDE: [string, string, string, string][] = [
  ['BECE Index No.', 'Student', '10 digits, text. Unique per student. Used to detect duplicates.', '0050401012'],
  ['Admission No.', 'Student', 'Format SDA/YY/NNNN (year of admission, 4-digit serial). Leave blank to let the system give the next number for the admission year.', 'SDA/25/0101'],
  ['Surname', 'Student', 'Capital letters.', 'ACHEAMPONG'],
  ['First Name', 'Student', '', 'Kwabena'],
  ['Other Names', 'Student', '', 'Yeboah'],
  ['Gender', 'Student', 'M or F', 'M'],
  ['Date of Birth', 'Student', 'Date, DD/MM/YYYY', '14/03/2010'],
  ['Nationality', 'Student', 'Default: Ghanaian', 'Ghanaian'],
  ['Ghana Card No.', 'Student', 'GHA-XXXXXXXXX-X (if the student has one)', 'GHA-725104381-6'],
  ['Hometown', 'Student', '', 'Akropong'],
  ['Home Region', 'Student', 'Pick from list (16 regions)', 'Eastern'],
  ['Religion / Denomination', 'Student', '', 'Seventh-day Adventist'],
  ['JHS Attended', 'Academic', 'Name of basic school', 'Koforidua SDA JHS'],
  ['Programme', 'Academic', 'Learning area — pick from list', 'Business'],
  ['Form', 'Academic', '1, 2 or 3', '1'],
  ['Class', 'Academic', 'Class and option letter as on the Subject Combinations sheet — pick from list', '1BUS 1A'],
  ['House', 'Academic', 'Pick from list', 'Gye Nyame'],
  ['Residential Status', 'Academic', 'Boarder or Day', 'Boarder'],
  ['Admission Date', 'Academic', 'Date, DD/MM/YYYY', '06/10/2025'],
  ['Guardian Name', 'Guardian', 'Full name of parent/guardian', 'Mr. Yaw Acheampong'],
  ['Relationship', 'Guardian', 'Pick from list', 'Father'],
  ['Guardian Phone', 'Guardian', '10 digits starting with 0, text. Brothers and sisters with the same guardian phone share one parent account.', '0244000101'],
  ['Alt. Phone', 'Guardian', '10 digits starting with 0, text', ''],
  ['Guardian Occupation', 'Guardian', '', 'Trader'],
  ['Guardian Email', 'Guardian', '', ''],
  ['Residential Address', 'Guardian', 'Town / area', 'Adweso, Koforidua'],
  ['GhanaPost GPS', 'Guardian', 'e.g. EN-012-3456', 'EN-012-3456'],
  ['Emergency Contact', 'Guardian', 'Name and phone if different from guardian', ''],
  ['Medical / Special Needs', 'Other', 'Optional, confidential (seen by school leadership only). Leave blank if none.', ''],
];

/** Range-wide data validation: supported by exceljs at runtime but missing from its type definitions. */
function validate(ws: ExcelJS.Worksheet, range: string, rule: ExcelJS.DataValidation) {
  (ws as unknown as { dataValidations: { add(range: string, rule: ExcelJS.DataValidation): void } }).dataValidations.add(range, rule);
}

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** Option groups as on the combination list, for every form: 1G/S 1A … 3VIS 2B. */
async function groupCodes(db: Database) {
  const rows = await db
    .select({ name: classes.name, form: classes.form, stream: classes.stream, programmeId: classes.programmeId, programmeName: programmes.name })
    .from(classes)
    .innerJoin(programmes, eq(programmes.id, classes.programmeId))
    .orderBy(asc(classes.form), asc(programmes.name), asc(classes.stream));
  const options = await db.select().from(subjectCombinations).orderBy(asc(subjectCombinations.option));
  return rows.flatMap((c) => {
    const mine = options.filter((o) => o.programmeId === c.programmeId && o.stream === c.stream);
    return mine.length ? mine.map((o) => `${c.name}${o.letter}`) : [c.name];
  });
}

export async function buildStudentTemplate(db: Database): Promise<Buffer> {
  const [profile] = await db.select({ name: schoolProfile.name }).from(schoolProfile).where(eq(schoolProfile.id, 1));
  const programmeRows = await db.select({ name: programmes.name }).from(programmes).orderBy(asc(programmes.name));
  const houseRows = await db.select({ name: houses.name }).from(houses).orderBy(asc(houses.name));
  const groups = await groupCodes(db);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SDA SHS';

  // Field guide
  const guide = wb.addWorksheet('Field Guide');
  guide.columns = [{ width: 26 }, { width: 12 }, { width: 10 }, { width: 70 }, { width: 22 }];
  guide.addRow([`${profile?.name ?? 'SDA SHS'} — STUDENT REGISTRATION BULK IMPORT`]).font = { bold: true, size: 14, color: { argb: BRAND } };
  [
    "1. Fill one row per student on the 'Student Import' sheet. Do not rename the sheet, change, reorder or delete column headings.",
    '2. Headings with * are required. Light blue headings are optional.',
    '3. Each BECE Index No. must appear only once; students already registered are skipped.',
    '4. Type phone numbers and BECE index numbers as text so Excel keeps the leading 0 (the columns are already formatted as text).',
    '5. Admission numbers use the format SDA/YY/NNNN. Leave Admission No. blank and the system gives the next number for the year of admission.',
    '6. Import: Admin portal → People → Bulk import → choose file. You see a check of every row first; valid rows are saved, rejected rows are listed with the reason.',
    '7. After importing, print the sign-in slips: each student and parent gets a temporary password to change at first sign-in.',
  ].forEach((t) => guide.addRow([t]));
  guide.addRow([]);
  const head = guide.addRow(['Column', 'Section', 'Required', 'Format / Rule', 'Example']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = fill(DARK)));
  for (const [col, section, rule, example] of GUIDE) {
    guide.addRow([col, section, REQUIRED_STUDENT_COLUMNS.has(col) ? 'Yes' : 'No', rule, example]).alignment = { wrapText: true, vertical: 'top' };
  }

  // Import sheet
  const sheet = wb.addWorksheet('Student Import', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = STUDENT_COLUMNS.map((c) => ({
    header: REQUIRED_STUDENT_COLUMNS.has(c) ? `${c} *` : c,
    width: Math.max(14, c.length + 4),
  }));
  sheet.getRow(1).eachCell((cell, n) => {
    const required = REQUIRED_STUDENT_COLUMNS.has(STUDENT_COLUMNS[n - 1]);
    cell.fill = fill(required ? DARK : LIGHT);
    cell.font = { bold: true, color: { argb: required ? 'FFFFFFFF' : 'FF1F3864' } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  sheet.getRow(1).height = 32;
  const col = (name: string) => STUDENT_COLUMNS.indexOf(name as (typeof STUDENT_COLUMNS)[number]) + 1;
  const letter = (name: string) => sheet.getColumn(col(name)).letter;
  for (const name of ['BECE Index No.', 'Admission No.', 'Guardian Phone', 'Alt. Phone', 'Form']) sheet.getColumn(col(name)).numFmt = '@';
  for (const name of ['Date of Birth', 'Admission Date']) sheet.getColumn(col(name)).numFmt = 'dd/mm/yyyy';

  // Lists
  const lists = wb.addWorksheet('Lists');
  const listCols: [string, string[]][] = [
    ['Gender', ['M', 'F']],
    ['Programme', programmeRows.map((p) => p.name)],
    ['Form', ['1', '2', '3']],
    ['Class', groups],
    ['House', houseRows.map((h) => h.name)],
    ['Residential Status', ['Boarder', 'Day']],
    ['Relationship', RELATIONSHIPS],
    ['Region', REGIONS],
  ];
  listCols.forEach(([title, values], i) => {
    const c = lists.getColumn(i + 1);
    c.width = 18;
    lists.getCell(1, i + 1).value = title;
    lists.getCell(1, i + 1).font = { bold: true };
    values.forEach((v, j) => (lists.getCell(j + 2, i + 1).value = v));
  });
  const range = (title: string) => {
    const i = listCols.findIndex(([t]) => t === title);
    const l = lists.getColumn(i + 1).letter;
    return `Lists!$${l}$2:$${l}$${listCols[i][1].length + 1}`;
  };
  const rows = 'MAXROW';
  const add = (name: string, v: ExcelJS.DataValidation) => {
    const l = letter(name);
    validate(sheet, `${l}2:${l}${rows}`.replace('MAXROW', '2001'), v);
  };
  const listOf = (name: string, title: string) =>
    add(name, { type: 'list', allowBlank: true, formulae: [range(title)], showErrorMessage: true, errorTitle: name, error: `Pick ${name} from the list` });
  listOf('Gender', 'Gender');
  listOf('Programme', 'Programme');
  listOf('Form', 'Form');
  listOf('Class', 'Class');
  listOf('House', 'House');
  listOf('Residential Status', 'Residential Status');
  listOf('Relationship', 'Relationship');
  listOf('Home Region', 'Region');
  for (const name of ['Date of Birth', 'Admission Date']) {
    add(name, { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(1990, 0, 1))], showErrorMessage: true, error: 'Enter a date, DD/MM/YYYY' });
  }

  // Subject combinations, for reference
  const combos = wb.addWorksheet('Subject Combinations');
  combos.columns = [{ width: 18 }, { width: 11 }, { width: 14 }, ...Array.from({ length: 6 }, () => ({ width: 28 }))];
  combos.addRow(['Learning Area', 'Option', 'Class (Form 1)', 'Elective 1', 'Elective 2', 'Elective 3', 'Elective 4', 'Elective 5', 'Elective 6']).font = { bold: true };
  const opts = await db
    .select({ o: subjectCombinations, programme: programmes.name, code: programmes.code, spaced: programmes.spacedName })
    .from(subjectCombinations)
    .innerJoin(programmes, eq(programmes.id, subjectCombinations.programmeId))
    .orderBy(asc(programmes.name), asc(subjectCombinations.option));
  const electives = await db
    .select({ combinationId: combinationSubjects.combinationId, name: subjects.name })
    .from(combinationSubjects)
    .innerJoin(subjects, eq(subjects.id, combinationSubjects.subjectId));
  for (const { o, programme, code, spaced } of opts) {
    combos.addRow([
      programme,
      `Option ${o.option}${o.mustDropOne ? '*' : ''}`,
      `1${spaced ? ' ' : ''}${code} ${o.stream}${o.letter}`,
      ...electives.filter((e) => e.combinationId === o.id).map((e) => e.name),
    ]);
  }
  combos.addRow([]);
  combos.addRow(['* Students on this option must drop one subject before SHS 3.']);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Column headings for the score sheet, as on the school's template. */
function componentHeading(c: AssessmentComponent): string {
  const names: Record<string, string> = {
    class: 'Class Assessment',
    midsem: 'Mid Sem',
    practical: 'Practical / Portfolio',
    project: 'Project Work',
    exam: 'Semester Exam',
  };
  return `${names[c.key] ?? c.label} (${c.weight})`;
}

/**
 * The semester score sheet for one class and subject, laid out like the
 * school's "Semester Assessment Score Sheet", listing the students who take
 * the subject and any marks already entered.
 */
export async function buildScoreSheet(db: Database, termId: string, classId: string, subjectId: string, studentIds: string[]) {
  const [profile] = await db
    .select({ name: schoolProfile.name, a: schoolProfile.assessmentSchemes, g: schoolProfile.gradingScale })
    .from(schoolProfile)
    .where(eq(schoolProfile.id, 1));
  const [term] = await db
    .select({ semester: terms.semester, year: academicYears.name })
    .from(terms)
    .innerJoin(academicYears, eq(academicYears.id, terms.academicYearId))
    .where(eq(terms.id, termId));
  const [cls] = await db
    .select({ name: classes.name, programme: programmes.name })
    .from(classes)
    .innerJoin(programmes, eq(programmes.id, classes.programmeId))
    .where(eq(classes.id, classId));
  const [subject] = await db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, subjectId));
  const [teacher] = await db
    .select({ name: users.fullName })
    .from(classSubjects)
    .innerJoin(users, eq(users.id, classSubjects.teacherId))
    .where(and(eq(classSubjects.classId, classId), eq(classSubjects.subjectId, subjectId)));
  const components = (profile?.a ?? DEFAULT_ASSESSMENT_SCHEMES)[term.semester === 2 ? '2' : '1'];
  const bands = [...(profile?.g?.bands ?? DEFAULT_GRADING_SCALE)].sort((a, b) => a.min - b.min);

  const register = studentIds.length
    ? await db
        .select({
          id: students.id,
          number: students.studentNumber,
          bece: students.beceIndexNo,
          surname: students.surname,
          firstName: students.firstName,
          otherNames: students.otherNames,
          gender: students.gender,
          fullName: users.fullName,
        })
        .from(students)
        .innerJoin(users, eq(users.id, students.userId))
        .where(inArray(students.id, studentIds))
    : [];
  const people = register
    .map((s) => {
      const parts = s.fullName.split(' ');
      return {
        ...s,
        surname: s.surname ?? parts[parts.length - 1].toUpperCase(),
        otherNames: s.firstName ? [s.firstName, s.otherNames].filter(Boolean).join(' ') : parts.slice(0, -1).join(' '),
      };
    })
    .sort((a, b) => a.surname.localeCompare(b.surname) || a.otherNames.localeCompare(b.otherNames));
  const marks = new Map(
    (studentIds.length
      ? await db
          .select({ studentId: results.studentId, scores: results.scores })
          .from(results)
          .where(and(eq(results.termId, termId), eq(results.subjectId, subjectId), inArray(results.studentId, studentIds)))
      : []
    ).map((r) => [r.studentId, r.scores]),
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Grade Import', { views: [{ state: 'frozen', ySplit: 9 }] });
  const lastCol = 6 + components.length + 3;
  ws.columns = [{ width: 5 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 22 }, { width: 8 }, ...components.map(() => ({ width: 13 })), { width: 10 }, { width: 8 }, { width: 12 }];
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `${(profile?.name ?? 'SDA SHS').toUpperCase()} — SEMESTER ASSESSMENT SCORE SHEET`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: BRAND } };
  const label = (r: number, c: number, text: string, value: string | null) => {
    ws.getCell(r, c).value = text;
    ws.getCell(r, c).font = { bold: true };
    const v = ws.getCell(r, c + (c === 1 ? 3 : 2));
    v.value = value ?? '';
    v.fill = fill(YELLOW);
  };
  label(2, 1, 'Academic Year', term.year);
  label(2, 8, 'Programme', cls.programme);
  label(3, 1, 'Semester', `Semester ${term.semester}`);
  label(3, 8, 'Subject', subject.name);
  label(4, 1, 'Class', cls.name);
  label(4, 8, 'Subject Teacher', teacher?.name ?? null);
  ws.getCell(5, 1).value = 'Project type this semester:';
  ws.getCell(5, 4).value = term.semester === 1 ? 'GROUP project / research (out of class)' : 'INDIVIDUAL project / research (out of class)';
  ws.getCell(6, 1).value =
    'Yellow = enter marks already scaled to the weight shown (e.g. Mid Sem out of 15)  ·  Grey = calculated for checking, not imported  ·  Enter 0 if a student has no mark; leave blank if the mark is not ready yet.';
  ws.getCell(6, 1).font = { italic: true, size: 9 };

  const headerRow = 9;
  const headings = ['S/N', 'Student ID', 'BECE Index No.', 'Surname', 'Other Names', 'Gender', ...components.map(componentHeading), 'Total (100)', 'Grade', 'Remarks'];
  headings.forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(DARK);
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  });
  ws.getRow(headerRow).height = 30;

  const markCol = (i: number) => ws.getColumn(7 + i).letter;
  const totalL = ws.getColumn(7 + components.length).letter;
  people.forEach((p, i) => {
    const r = headerRow + 1 + i;
    const existing = marks.get(p.id) ?? {};
    const values: (string | number | null)[] = [i + 1, p.number, p.bece ?? '', p.surname, p.otherNames, p.gender ?? '', ...components.map((c) => existing[c.key] ?? null)];
    values.forEach((v, c) => (ws.getCell(r, c + 1).value = v));
    components.forEach((_, c) => (ws.getCell(r, 7 + c).fill = fill(YELLOW)));
    const first = markCol(0);
    const lastMark = markCol(components.length - 1);
    ws.getCell(r, 7 + components.length).value = { formula: `IF(COUNTBLANK(${first}${r}:${lastMark}${r})>0,"",SUM(${first}${r}:${lastMark}${r}))` };
    ws.getCell(r, 8 + components.length).value = { formula: `IF(${totalL}${r}="","",VLOOKUP(${totalL}${r},'Grading Scale'!$A$2:$C$${bands.length + 1},3,TRUE))` };
    ws.getCell(r, 9 + components.length).value = { formula: `IF(${totalL}${r}="","",VLOOKUP(${totalL}${r},'Grading Scale'!$A$2:$D$${bands.length + 1},4,TRUE))` };
    for (let c = 7 + components.length; c <= lastCol; c++) ws.getCell(r, c).fill = fill(GREY);
  });
  const lastRow = headerRow + Math.max(people.length, 1);
  components.forEach((c, i) => {
    const l = markCol(i);
    validate(ws, `${l}${headerRow + 1}:${l}${lastRow}`, {
      type: 'decimal',
      operator: 'between',
      allowBlank: true,
      formulae: [0, c.weight],
      showErrorMessage: true,
      errorTitle: 'Mark out of range',
      error: `Enter a mark from 0 to ${c.weight}`,
    });
  });

  const scale = wb.addWorksheet('Grading Scale');
  scale.addRow(['Min Score', 'Max Score', 'Grade', 'Interpretation']).font = { bold: true };
  bands.forEach((b, i) => scale.addRow([b.min, i + 1 < bands.length ? bands[i + 1].min - 1 : 100, b.grade, b.remark]));

  const weights = wb.addWorksheet('Assessment Weights');
  weights.columns = [{ width: 4 }, { width: 90 }, { width: 10 }];
  weights.addRow(['#', `Mode of Assessment — Semester ${term.semester}`, 'Weight (%)']).font = { bold: true };
  components.forEach((c, i) => weights.addRow([i + 1, c.label, c.weight]));

  const fileName = `Score sheet ${cls.name} ${subject.name} Sem ${term.semester}.xlsx`.replace(/[/\\]/g, '-');
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName };
}
