import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import * as schema from '../src/database/schema';
import { loadSchoolCatalogue } from '../src/database/school-catalogue';
import { createApp, login, resetDatabase, seedSchool, testDb } from './setup';

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name));

async function workbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}
async function save(wb: ExcelJS.Workbook) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Bulk import using the school's own templates. */
describe('bulk imports', () => {
  let app: INestApplication;
  const { db, close } = testDb();
  let seed: Awaited<ReturnType<typeof seedSchool>>;
  let head: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const uploadStudents = (buffer: Buffer, dryRun: boolean) =>
    http()
      .post(`/api/v1/imports/students?dryRun=${dryRun}`)
      .set(bearer(head))
      .attach('file', buffer, { filename: 'students.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  beforeAll(async () => {
    await resetDatabase();
    seed = await seedSchool(db);
    await loadSchoolCatalogue(db);
    app = await createApp();
    head = (await login(app, 'head@test.local')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  it('refuses the template’s sample rows, so example people never become accounts', async () => {
    const res = await uploadStudents(fixture('student-import-template.xlsx'), true).expect(201);
    expect(res.body).toMatchObject({ dryRun: true, total: 10, valid: 0 });
    expect(res.body.errors.filter((e: { message: string }) => /sample row/.test(e.message))).toHaveLength(10);
  });

  /** The school's template with real-looking rows instead of the samples. */
  async function filledTemplate() {
    const wb = await workbook(fixture('student-import-template.xlsx'));
    const ws = wb.getWorksheet('Student Import')!;
    const houses = ['Gye Nyame', 'Asokore', 'Agyei Sarfo', 'Kuma Korante'];
    for (let r = 2; r <= 11; r++) {
      ws.getCell(r, 1).value = `07000000${String(r).padStart(2, '0')}`; // BECE
      ws.getCell(r, 17).value = houses[r % 4]; // House
    }
    ws.getCell(2, 2).value = null; // no admission number: the system generates one
    ws.getCell(3, 22).value = 244000101; // phone typed as a number: Excel dropped the 0
    ws.getCell(3, 20).value = 'Mr. Yaw Acheampong'; // same guardian as row 2 (siblings)
    ws.getCell(3, 22).value = '0244000101';
    // Two bad rows
    ws.getRow(12).values = ['0700000012', '', 'MENSAH', 'Kofi', '', 'M', new Date(Date.UTC(2010, 1, 1)), '', '', '', '', '', '', 'Business', '1', '1XYZ 9', 'Asokore', 'Day', new Date(Date.UTC(2025, 9, 6)), 'Mr. Mensah', 'Father', '02400', ''];
    ws.getRow(13).values = ['0700000013', 'SDA-25-7', 'OWUSU', 'Ama', '', 'F', new Date(Date.UTC(2010, 1, 1)), '', '', '', '', '', '', 'Business', '2', '1BUS 1A', 'Asokore', 'Day', new Date(Date.UTC(2025, 9, 6)), 'Mrs. Owusu', 'Mother', '0244111222', ''];
    return save(wb);
  }

  it('checks every row first: classes and options, admission numbers, phones and forms', async () => {
    const res = await uploadStudents(await filledTemplate(), true).expect(201);
    expect(res.body).toMatchObject({ total: 12, valid: 10 });
    const errorFor = (row: number) => res.body.errors.filter((e: { row: number }) => e.row === row).map((e: { column: string }) => e.column);
    expect(errorFor(12)).toEqual(expect.arrayContaining(['Class', 'Guardian Phone']));
    expect(errorFor(13)).toEqual(expect.arrayContaining(['Admission No.', 'Form']));

    const rows = res.body.rows as { row: number; admissionNo: string; admissionNoGenerated: boolean; groupName: string }[];
    // SDA/25/0102 … 0110 are given in the file, so the blank one gets the next free number.
    expect(rows.find((r) => r.row === 2)).toMatchObject({ admissionNo: 'SDA/25/0111', admissionNoGenerated: true });
    // Classes as written on the combination list, including Languages' "1L1 1A".
    expect(rows.find((r) => r.row === 3)?.groupName).toBe('1G/A 1B');
    expect(rows.find((r) => r.row === 4)?.groupName).toBe('1G/S 1A'); // Programme "Science"
    expect(rows.find((r) => r.row === 8)?.groupName).toBe('1VIS 1B'); // Programme "Visual Art"
    expect(rows.find((r) => r.row === 10)?.groupName).toBe('1 LANG 1A'); // "1L1 1A"
    // Nothing was written.
    expect(await db.select().from(schema.students).where(eq(schema.students.studentNumber, 'SDA/25/0102'))).toHaveLength(0);
  });

  it('imports the valid rows and hands out one-time sign-in details', async () => {
    const res = await uploadStudents(await filledTemplate(), false).expect(201);
    expect(res.body.created).toEqual({ students: 10, parents: 9, linkedToExistingParents: 0 });
    const creds = res.body.credentials as { role: string; signInId: string; temporaryPassword: string; children?: string[] }[];
    expect(creds.filter((c) => c.role === 'student')).toHaveLength(10);
    // Siblings share one guardian account.
    const yaw = creds.find((c) => c.role === 'parent' && c.signInId === '0244000101');
    expect(yaw?.children).toHaveLength(2);

    const [student] = await db.select().from(schema.students).where(eq(schema.students.studentNumber, 'SDA/25/0103'));
    expect(student).toMatchObject({ beceIndexNo: '0700000004', surname: 'AGYEMANG', gender: 'M', residentialStatus: 'boarder', admissionDate: '2025-10-06' });

    // Students sign in with their admission number; parents with their phone. Both must change the password.
    const sCred = creds.find((c) => c.signInId === 'SDA/25/0103')!;
    const s = await http().post('/api/v1/auth/login').send({ identifier: 'sda/25/0103', password: sCred.temporaryPassword }).expect(200);
    expect(s.body.user).toMatchObject({ mustChangePassword: true, student: { groupName: '1G/S 1A' } });
    const p = await http().post('/api/v1/auth/login').send({ identifier: '0244000101', password: yaw!.temporaryPassword }).expect(200);
    expect(p.body.user.children).toHaveLength(2);

    // Importing the same file again registers nobody twice.
    const again = await uploadStudents(await filledTemplate(), true).expect(201);
    expect(again.body.valid).toBe(0);
    expect(again.body.errors.some((e: { message: string }) => /Already registered as SDA\/25\/0103/.test(e.message))).toBe(true);
  });

  it('teachers cannot import students', async () => {
    const teacher = (await login(app, 'teacher.a@test.local')).accessToken;
    await http()
      .post('/api/v1/imports/students?dryRun=true')
      .set(bearer(teacher))
      .attach('file', fixture('student-import-template.xlsx'), 'students.xlsx')
      .expect(403);
  });

  it('downloads a registration template with the school’s classes and houses', async () => {
    const res = await http().get('/api/v1/imports/students/template').set(bearer(head)).buffer(true).parse(binary).expect(200);
    const wb = await workbook(res.body);
    expect(wb.getWorksheet('Student Import')!.getCell(1, 1).value).toBe('BECE Index No. *');
    const lists = wb.getWorksheet('Lists')!;
    const column = (title: string) => {
      const c = (lists.getRow(1).values as string[]).indexOf(title);
      return lists.getColumn(c).values.slice(2).filter(Boolean);
    };
    expect(column('House')).toEqual(['Agyei Sarfo', 'Asokore', 'Gye Nyame', 'Kuma Korante']);
    expect(column('Class')).toEqual(expect.arrayContaining(['1BUS 1A', '2G/A 4', '3 LANG 2B', '1H/E 2D']));
  });

  describe('score sheets', () => {
    let bus1Id: string;
    let accountingId: string;

    beforeAll(async () => {
      // Three 2BUS 1A students, admitted 2024.
      const wb = await workbook(fixture('student-import-template.xlsx'));
      const ws = wb.getWorksheet('Student Import')!;
      for (let r = 2; r <= 11; r++) ws.getRow(r).values = [];
      ['ADJEI', 'BAAH', 'COFFIE'].forEach((surname, i) => {
        ws.getRow(i + 2).values = [
          `08000000${i + 1}0`, `SDA/24/000${i + 1}`, surname, 'Yaw', '', 'M', new Date(Date.UTC(2009, 0, 1)), '', '', '', '', '', '',
          'Business', '2', '2BUS 1A', 'Asokore', 'Day', new Date(Date.UTC(2024, 9, 7)), `Guardian ${surname}`, 'Father', `020000000${i + 1}`,
        ];
      });
      await uploadStudents(await save(wb), false).expect(201);
      [{ id: bus1Id }] = await db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.name, '2BUS 1'));
      [{ id: accountingId }] = await db.select({ id: schema.subjects.id }).from(schema.subjects).where(eq(schema.subjects.code, 'ACCT'));
    });

    const uploadGrades = (buffer: Buffer, q: string, token = head) =>
      http()
        .post(`/api/v1/imports/results?${q}`)
        .set(bearer(token))
        .attach('file', buffer, { filename: 'grades.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    it("reads the school's own score sheet layout", async () => {
      const wb = await workbook(fixture('grade-import-template.xlsx'));
      const ws = wb.getWorksheet('Grade Import')!;
      // Point the first three rows at our students; the other twelve are unknown IDs.
      ['SDA/24/0001', 'SDA/24/0002', 'SDA/24/0003'].forEach((id, i) => {
        ws.getCell(10 + i, 2).value = id;
        ws.getCell(10 + i, 3).value = null;
      });
      ws.getCell(12, 11).value = null; // exam not marked yet for the third student

      const preview = await uploadGrades(await save(wb), 'dryRun=true').expect(201);
      expect(preview.body).toMatchObject({ academicYear: '2026/2027', semester: 'Semester 1', className: '2BUS 1', subjectName: 'Accounting', total: 15, valid: 3 });
      // Rows 13–24: students from the earlier import are in other classes; the rest aren't registered.
      expect(preview.body.errors.filter((e: { row: number }) => e.row >= 13).map((e: { message: string }) => e.message)).toEqual([
        ...Array.from({ length: 8 }, () => expect.stringMatching(/is not in 2BUS 1$/)),
        ...Array.from({ length: 4 }, () => expect.stringMatching(/is not a registered student$/)),
      ]);
      const first = preview.body.rows[0];
      expect(first).toMatchObject({ admissionNo: 'SDA/24/0001', total: 77, grade: 'B2', complete: true });
      expect(preview.body.rows[2]).toMatchObject({ complete: false, grade: null });

      const saved = await uploadGrades(await save(wb), 'dryRun=false').expect(201);
      expect(saved.body.saved).toBe(3);
      const sheet = await http()
        .get(`/api/v1/results/sheet?termId=${seed.term.id}&classId=${bus1Id}&subjectId=${accountingId}`)
        .set(bearer(head))
        .expect(200);
      expect(sheet.body.map((r: { total: number; complete: boolean }) => [r.total, r.complete])).toEqual([
        [77, true],
        [89, true],
        [36, false],
      ]);

      // Uploading again needs an explicit overwrite.
      const again = await uploadGrades(await save(wb), 'dryRun=true').expect(201);
      expect(again.body.valid).toBe(0);
      expect(again.body.errors.filter((e: { message: string }) => /Replace existing marks/.test(e.message))).toHaveLength(3);
      const overwrite = await uploadGrades(await save(wb), 'dryRun=true&overwrite=true').expect(201);
      expect(overwrite.body.valid).toBe(3);
    });

    it('downloads a class score sheet with its register and marks, and takes it back', async () => {
      const res = await http()
        .get(`/api/v1/imports/results/template?termId=${seed.term.id}&classId=${bus1Id}&subjectId=${accountingId}`)
        .set(bearer(head))
        .buffer(true)
        .parse(binary)
        .expect(200);
      const wb = await workbook(res.body);
      const ws = wb.getWorksheet('Grade Import')!;
      expect(ws.getCell(4, 4).value).toBe('2BUS 1');
      expect(ws.getCell(10, 2).value).toBe('SDA/24/0001');
      expect(ws.getCell(10, 4).value).toBe('ADJEI');
      expect([7, 8, 9, 10, 11].map((c) => ws.getCell(12, c).value)).toEqual([9, 8, 6, 13, null]); // exam mark not in yet
      ws.getCell(12, 11).value = 20;
      const done = await uploadGrades(await save(wb), 'overwrite=true').expect(201);
      expect(done.body.saved).toBe(3);
      const sheet = await http()
        .get(`/api/v1/results/sheet?termId=${seed.term.id}&classId=${bus1Id}&subjectId=${accountingId}`)
        .set(bearer(head))
        .expect(200);
      expect(sheet.body[2]).toMatchObject({ total: 56, complete: true, grade: 'C5' });
    });

    it('only the subject teacher (or leadership) can import marks', async () => {
      const teacher = (await login(app, 'teacher.b@test.local')).accessToken;
      await uploadGrades(fixture('grade-import-template.xlsx'), 'dryRun=true', teacher).expect(403);
    });
  });
});

/** Supertest parser that keeps a binary response as a Buffer. */
function binary(res: request.Response, cb: (err: Error | null, body: unknown) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}
