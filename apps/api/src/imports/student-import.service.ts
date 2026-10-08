import { BadRequestException, Injectable } from '@nestjs/common';
import { hash } from 'argon2';
import { inArray, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { randomInt } from 'node:crypto';
import type { ImportCredential, ImportIssue, StudentImportReport, StudentImportRow } from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { guardianProfiles, guardianStudents, houses, students, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { ADMISSION_NO, AdmissionNumberer, highestSerials, normaliseAdmissionNo } from './admission';
import { beceIndex, cellDate, cellText, ghanaPhone, headerKey } from './cells';
import { loadGroups, programmeMatches, type GroupTarget } from './groups';

/** Columns of the "Student Import" sheet, by heading (the * is ignored). */
export const STUDENT_COLUMNS = [
  'BECE Index No.',
  'Admission No.',
  'Surname',
  'First Name',
  'Other Names',
  'Gender',
  'Date of Birth',
  'Nationality',
  'Ghana Card No.',
  'Hometown',
  'Home Region',
  'Religion / Denomination',
  'JHS Attended',
  'Programme',
  'Form',
  'Class',
  'House',
  'Residential Status',
  'Admission Date',
  'Guardian Name',
  'Relationship',
  'Guardian Phone',
  'Alt. Phone',
  'Guardian Occupation',
  'Guardian Email',
  'Residential Address',
  'GhanaPost GPS',
  'Emergency Contact',
  'Medical / Special Needs',
] as const;
export const REQUIRED_STUDENT_COLUMNS = new Set([
  'BECE Index No.',
  'Surname',
  'First Name',
  'Gender',
  'Date of Birth',
  'Programme',
  'Form',
  'Class',
  'House',
  'Residential Status',
  'Admission Date',
  'Guardian Name',
  'Relationship',
  'Guardian Phone',
]);

/** The template's illustration rows: refused so sample people never become real accounts. */
const SAMPLE_BECE = new Set([
  '0050401012',
  '0050402087',
  '0050715034',
  '0050401145',
  '0051203009',
  '0050401220',
  '0050803061',
  '0050401307',
  '0050902118',
  '0050401388',
]);

const MAX_ROWS = 2000;

interface ParsedStudent {
  row: number;
  beceIndexNo: string;
  admissionNo: string | null;
  surname: string;
  firstName: string;
  otherNames: string | null;
  gender: 'M' | 'F';
  dateOfBirth: string;
  nationality: string | null;
  ghanaCardNo: string | null;
  hometown: string | null;
  homeRegion: string | null;
  religion: string | null;
  jhsAttended: string | null;
  target: GroupTarget;
  houseId: string;
  residentialStatus: 'boarder' | 'day';
  admissionDate: string;
  guardian: {
    name: string;
    relationship: string;
    phone: string;
    altPhone: string | null;
    occupation: string | null;
    email: string | null;
  };
  residentialAddress: string | null;
  gpsAddress: string | null;
  emergencyContact: string | null;
  medicalNotes: string | null;
}

/** Readable one-time password: 4 letters, 4 digits, 2 letters, without look-alike characters. */
function temporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string, n: number) => Array.from({ length: n }, () => set[randomInt(set.length)]).join('');
  return `${pick(letters, 4)}${pick(digits, 4)}${pick(letters, 2)}`;
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
}

@Injectable()
export class StudentImportService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private async readSheet(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('This file could not be read. Upload the .xlsx template saved from Excel.');
    }
    for (const ws of wb.worksheets) {
      for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
        const row = ws.getRow(r);
        const cols = new Map<string, number>();
        row.eachCell((cell, c) => cols.set(headerKey(cell.value), c));
        if (cols.has('bece index no.') && cols.has('surname')) return { ws, headerRow: r, cols };
      }
    }
    throw new BadRequestException("No 'Student Import' sheet with the template's column headings was found.");
  }

  /** Reads and checks every row; nothing is written. */
  private async analyse(buffer: Buffer) {
    const { ws, headerRow, cols } = await this.readSheet(buffer);
    const missingCols = [...REQUIRED_STUDENT_COLUMNS].filter((c) => !cols.has(c.toLowerCase()));
    if (missingCols.length) throw new BadRequestException(`These columns are missing: ${missingCols.join(', ')}. Use the template without changing headings.`);

    const [{ byCode }, houseRows] = await Promise.all([loadGroups(this.db), this.db.select().from(houses)]);
    const houseByName = new Map(houseRows.map((h) => [h.name.toLowerCase(), h.id]));

    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const parsed: ParsedStudent[] = [];
    const reportRows: StudentImportRow[] = [];
    const seenBece = new Map<string, number>();
    const seenAdmission = new Map<string, number>();

    const last = Math.min(ws.rowCount, headerRow + MAX_ROWS);
    for (let r = headerRow + 1; r <= last; r++) {
      const row = ws.getRow(r);
      const get = (name: string) => {
        const c = cols.get(name.toLowerCase());
        return c ? row.getCell(c).value : null;
      };
      if (!STUDENT_COLUMNS.some((c) => cellText(get(c)))) continue; // empty row

      const rowErrors: ImportIssue[] = [];
      const fail = (column: string, message: string) => rowErrors.push({ row: r, column, message });
      const text = (column: string) => cellText(get(column));
      const required = (column: string) => {
        const v = text(column);
        if (!v) fail(column, 'Required');
        return v ?? '';
      };

      // Student
      const bece = beceIndex(get('BECE Index No.'));
      if (bece === null) fail('BECE Index No.', 'Required');
      else if (bece === 'invalid') fail('BECE Index No.', 'Must be 10 digits');
      else if (SAMPLE_BECE.has(bece)) fail('BECE Index No.', 'This is a sample row from the template. Delete the sample rows before importing.');
      else if (seenBece.has(bece)) fail('BECE Index No.', `Repeated: also on row ${seenBece.get(bece)}`);
      else seenBece.set(bece, r);

      let admissionNo: string | null = null;
      const admRaw = text('Admission No.');
      if (admRaw) {
        admissionNo = normaliseAdmissionNo(admRaw);
        if (!ADMISSION_NO.test(admissionNo)) fail('Admission No.', 'Use the format SDA/YY/NNNN, e.g. SDA/25/0101 — or leave blank to generate it');
        else if (seenAdmission.has(admissionNo)) fail('Admission No.', `Repeated: also on row ${seenAdmission.get(admissionNo)}`);
        else seenAdmission.set(admissionNo, r);
      }

      const surname = required('Surname').toUpperCase();
      const firstName = titleCase(required('First Name'));
      const otherNamesRaw = text('Other Names');
      const genderRaw = required('Gender').toUpperCase();
      const gender = genderRaw === 'M' || genderRaw === 'MALE' ? 'M' : genderRaw === 'F' || genderRaw === 'FEMALE' ? 'F' : null;
      if (genderRaw && !gender) fail('Gender', 'Use M or F');
      const dob = cellDate(get('Date of Birth'));
      if (dob === null) fail('Date of Birth', 'Required');
      else if (dob === 'invalid') fail('Date of Birth', 'Use a date, DD/MM/YYYY');

      // Academic
      const programme = required('Programme');
      const formRaw = required('Form');
      const form = Number(formRaw);
      if (formRaw && ![1, 2, 3].includes(form)) fail('Form', 'Use 1, 2 or 3');
      const classRaw = required('Class');
      let target: GroupTarget | undefined;
      if (classRaw) {
        target = byCode.get(classRaw.toUpperCase().replace(/\s+/g, ''));
        if (!target) {
          fail('Class', `"${classRaw}" is not a class and option on the subject combination list (e.g. 1BUS 1A, 1G/A 4, 1L1 1A)`);
        } else {
          if (programme && !programmeMatches(programme, target.programmeName)) fail('Programme', `${target.groupName} is a ${target.programmeName} class`);
          if ([1, 2, 3].includes(form) && form !== target.form) fail('Form', `${target.groupName} is a form ${target.form} class`);
        }
      }
      const houseRaw = required('House');
      const houseId = houseRaw ? houseByName.get(houseRaw.toLowerCase()) : undefined;
      if (houseRaw && !houseId) fail('House', `Unknown house. Use one of: ${houseRows.map((h) => h.name).join(', ')}`);
      const resRaw = required('Residential Status').toLowerCase();
      const residentialStatus = resRaw === 'boarder' ? 'boarder' : resRaw === 'day' ? 'day' : null;
      if (resRaw && !residentialStatus) fail('Residential Status', 'Use Boarder or Day');
      const admissionDate = cellDate(get('Admission Date'));
      if (admissionDate === null) fail('Admission Date', 'Required');
      else if (admissionDate === 'invalid') fail('Admission Date', 'Use a date, DD/MM/YYYY');
      if (admissionNo && ADMISSION_NO.test(admissionNo) && typeof admissionDate === 'string' && admissionDate !== 'invalid') {
        const yy = admissionDate.slice(2, 4);
        if (admissionNo.slice(4, 6) !== yy) {
          warnings.push({ row: r, column: 'Admission No.', message: `${admissionNo} does not show the admission year 20${yy}` });
        }
      }

      // Guardian
      const guardianName = required('Guardian Name');
      const relationship = required('Relationship');
      const phone = ghanaPhone(get('Guardian Phone'));
      if (phone === null) fail('Guardian Phone', 'Required');
      else if (phone === 'invalid') fail('Guardian Phone', '10 digits starting with 0, e.g. 0244000101');
      const altPhone = ghanaPhone(get('Alt. Phone'));
      if (altPhone === 'invalid') fail('Alt. Phone', '10 digits starting with 0');
      const emailRaw = text('Guardian Email');
      const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
      if (emailRaw && !email) fail('Guardian Email', 'Not a valid email address');
      const gps = text('GhanaPost GPS');
      if (gps && !/^[A-Z]{2}-\d{3,4}-\d{3,4}$/i.test(gps)) warnings.push({ row: r, column: 'GhanaPost GPS', message: `"${gps}" doesn't look like a GhanaPost address (e.g. EN-012-3456)` });
      const card = text('Ghana Card No.');
      if (card && !/^GHA-\d{9}-\d$/i.test(card)) fail('Ghana Card No.', 'Use the format GHA-XXXXXXXXX-X');

      const fullName = [firstName, otherNamesRaw ? titleCase(otherNamesRaw) : null, surname].filter(Boolean).join(' ');
      reportRows.push({
        row: r,
        admissionNo,
        admissionNoGenerated: !admissionNo,
        fullName,
        groupName: target?.groupName ?? classRaw,
        guardianName: guardianName || null,
        guardianPhone: typeof phone === 'string' && phone !== 'invalid' ? phone : null,
        guardianExists: false,
        ok: rowErrors.length === 0,
      });
      errors.push(...rowErrors);
      if (rowErrors.length) continue;

      parsed.push({
        row: r,
        beceIndexNo: bece as string,
        admissionNo,
        surname,
        firstName,
        otherNames: otherNamesRaw ? titleCase(otherNamesRaw) : null,
        gender: gender!,
        dateOfBirth: dob as string,
        nationality: text('Nationality') ?? 'Ghanaian',
        ghanaCardNo: card ? card.toUpperCase() : null,
        hometown: text('Hometown'),
        homeRegion: text('Home Region'),
        religion: text('Religion / Denomination'),
        jhsAttended: text('JHS Attended'),
        target: target!,
        houseId: houseId!,
        residentialStatus: residentialStatus!,
        admissionDate: admissionDate as string,
        guardian: { name: guardianName, relationship, phone: phone as string, altPhone: (altPhone as string | null) ?? null, occupation: text('Guardian Occupation'), email },
        residentialAddress: text('Residential Address'),
        gpsAddress: gps ? gps.toUpperCase() : null,
        emergencyContact: text('Emergency Contact'),
        medicalNotes: text('Medical / Special Needs'),
      });
    }
    if (!reportRows.length) throw new BadRequestException('The sheet has no student rows.');

    // Already registered?
    const markBad = (row: number, column: string, message: string) => {
      errors.push({ row, column, message });
      const rr = reportRows.find((x) => x.row === row);
      if (rr) rr.ok = false;
    };
    if (parsed.length) {
      const existingBece = await this.db
        .select({ bece: students.beceIndexNo, number: students.studentNumber })
        .from(students)
        .where(inArray(students.beceIndexNo, parsed.map((p) => p.beceIndexNo)));
      const beceTaken = new Map(existingBece.map((e) => [e.bece, e.number]));
      const givenNumbers = parsed.map((p) => p.admissionNo).filter((n): n is string => !!n);
      const numbersTaken = new Set(
        givenNumbers.length
          ? (await this.db.select({ n: students.studentNumber }).from(students).where(inArray(students.studentNumber, givenNumbers))).map((r) => r.n)
          : [],
      );
      for (const p of parsed) {
        if (beceTaken.has(p.beceIndexNo)) markBad(p.row, 'BECE Index No.', `Already registered as ${beceTaken.get(p.beceIndexNo)}`);
        else if (p.admissionNo && numbersTaken.has(p.admissionNo)) markBad(p.row, 'Admission No.', `${p.admissionNo} is already used by another student`);
      }
    }
    const badRows = new Set(errors.map((e) => e.row));
    const valid = parsed.filter((p) => !badRows.has(p.row));

    // Guardians: one account per phone number, shared by siblings and reused across imports.
    const phones = [...new Set(valid.map((p) => p.guardian.phone))];
    const phoneOwners = phones.length
      ? await this.db.select({ id: users.id, phone: users.phone, role: users.role, fullName: users.fullName }).from(users).where(inArray(users.phone, phones))
      : [];
    const owners = new Map(phoneOwners.map((o) => [o.phone!, o]));
    const namesByPhone = new Map<string, string>();
    for (const p of valid) {
      const owner = owners.get(p.guardian.phone);
      if (owner && owner.role !== 'parent') {
        markBad(p.row, 'Guardian Phone', 'This phone number belongs to a staff or student account');
        continue;
      }
      const rr = reportRows.find((x) => x.row === p.row)!;
      rr.guardianExists = !!owner;
      const first = namesByPhone.get(p.guardian.phone);
      if (first && first.toLowerCase() !== p.guardian.name.toLowerCase()) {
        warnings.push({ row: p.row, column: 'Guardian Name', message: `Same phone as "${first}" — both students will be linked to one guardian account` });
      } else namesByPhone.set(p.guardian.phone, p.guardian.name);
    }
    const finalBad = new Set(errors.map((e) => e.row));
    return { valid: valid.filter((p) => !finalBad.has(p.row)), errors, warnings, reportRows, owners };
  }

  async run(actor: AuthUser, buffer: Buffer, dryRun: boolean, ip: string | null): Promise<StudentImportReport> {
    const { valid, errors, warnings, reportRows, owners } = await this.analyse(buffer);
    const report: StudentImportReport = {
      dryRun,
      total: reportRows.length,
      valid: valid.length,
      rows: reportRows,
      errors: errors.sort((a, b) => a.row - b.row),
      warnings: warnings.sort((a, b) => a.row - b.row),
      credentials: [],
      created: { students: 0, parents: 0, linkedToExistingParents: 0 },
    };

    // Admission numbers are worked out (for the preview too) after the rows that bring their own.
    const numberer = new AdmissionNumberer(await highestSerials(this.db));
    for (const p of valid) if (p.admissionNo) numberer.claim(p.admissionNo);
    for (const p of valid) {
      if (!p.admissionNo) {
        p.admissionNo = numberer.next(Number(p.admissionDate.slice(0, 4)));
        reportRows.find((r) => r.row === p.row)!.admissionNo = p.admissionNo;
      }
    }
    if (dryRun || !valid.length) return report;

    // Passwords are hashed up front, a few at a time (argon2 is deliberately slow).
    const newGuardianPhones = [...new Set(valid.map((p) => p.guardian.phone))].filter((ph) => !owners.has(ph));
    const passwords = new Map<string, string>();
    const hashes = new Map<string, string>();
    const keys = [...valid.map((p) => `s:${p.admissionNo}`), ...newGuardianPhones.map((ph) => `g:${ph}`)];
    for (let i = 0; i < keys.length; i += 8) {
      await Promise.all(
        keys.slice(i, i + 8).map(async (k) => {
          const pw = temporaryPassword();
          passwords.set(k, pw);
          hashes.set(k, await hash(pw));
        }),
      );
    }

    const credentials: ImportCredential[] = [];
    await this.db.transaction(async (tx) => {
      // Serialise imports so two uploads can't hand out the same admission numbers.
      await tx.execute(sql`select pg_advisory_xact_lock(724201)`);

      const guardianIds = new Map<string, string>([...owners].map(([phone, o]) => [phone, o.id]));
      const guardianCreds = new Map<string, ImportCredential>();
      for (const phone of newGuardianPhones) {
        const p = valid.find((v) => v.guardian.phone === phone)!;
        let email = p.guardian.email;
        if (email) {
          const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
          if (taken) {
            warnings.push({ row: p.row, column: 'Guardian Email', message: `${email} is already used by another account; the guardian was created without it` });
            email = null;
          }
        }
        const [u] = await tx
          .insert(users)
          .values({ fullName: p.guardian.name, phone, email, role: 'parent', passwordHash: hashes.get(`g:${phone}`)!, mustChangePassword: true })
          .returning({ id: users.id });
        await tx.insert(guardianProfiles).values({ userId: u.id, occupation: p.guardian.occupation, altPhone: p.guardian.altPhone });
        guardianIds.set(phone, u.id);
        const cred: ImportCredential = { fullName: p.guardian.name, role: 'parent', signInId: phone, temporaryPassword: passwords.get(`g:${phone}`)!, groupName: null, children: [] };
        guardianCreds.set(phone, cred);
      }

      for (const p of valid) {
        const fullName = [p.firstName, p.otherNames, p.surname].filter(Boolean).join(' ');
        const [u] = await tx
          .insert(users)
          .values({ fullName, role: 'student', passwordHash: hashes.get(`s:${p.admissionNo}`)!, mustChangePassword: true })
          .returning({ id: users.id });
        const [st] = await tx
          .insert(students)
          .values({
            userId: u.id,
            studentNumber: p.admissionNo!,
            beceIndexNo: p.beceIndexNo,
            surname: p.surname,
            firstName: p.firstName,
            otherNames: p.otherNames,
            gender: p.gender,
            dateOfBirth: p.dateOfBirth,
            nationality: p.nationality,
            ghanaCardNo: p.ghanaCardNo,
            hometown: p.hometown,
            homeRegion: p.homeRegion,
            religion: p.religion,
            jhsAttended: p.jhsAttended,
            classId: p.target.classId,
            combinationId: p.target.combinationId,
            houseId: p.houseId,
            residentialStatus: p.residentialStatus,
            admissionDate: p.admissionDate,
            residentialAddress: p.residentialAddress,
            gpsAddress: p.gpsAddress,
            emergencyContact: p.emergencyContact,
            medicalNotes: p.medicalNotes,
          })
          .returning({ id: students.id });
        await tx
          .insert(guardianStudents)
          .values({ guardianUserId: guardianIds.get(p.guardian.phone)!, studentId: st.id, relationship: p.guardian.relationship })
          .onConflictDoNothing();
        credentials.push({ fullName, role: 'student', signInId: p.admissionNo!, temporaryPassword: passwords.get(`s:${p.admissionNo}`)!, groupName: p.target.groupName });
        guardianCreds.get(p.guardian.phone)?.children?.push(`${fullName} (${p.target.groupName})`);
        if (!guardianCreds.has(p.guardian.phone)) report.created.linkedToExistingParents += 1;
      }
      credentials.push(...guardianCreds.values());
      report.created.students = valid.length;
      report.created.parents = guardianCreds.size;
    });

    report.credentials = credentials;
    report.warnings = warnings.sort((a, b) => a.row - b.row);
    await this.audit.record({
      actorId: actor.id,
      action: 'students.imported',
      entityType: 'import',
      metadata: { students: report.created.students, parents: report.created.parents, rejected: report.total - report.valid },
      ip,
    });
    return report;
  }
}
