import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as schema from '../src/database/schema';
import { createApp, login, marksFor, resetDatabase, seedSchool, testDb } from './setup';

describe('classes, grading and transcripts', () => {
  let app: INestApplication;
  const { db, close } = testDb();
  let seed: Awaited<ReturnType<typeof seedSchool>>;
  let head: string;
  let teacherA: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetDatabase();
    seed = await seedSchool(db);
    app = await createApp();
    head = (await login(app, 'head@test.local')).accessToken;
    teacherA = (await login(app, 'teacher.a@test.local')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  it('creates a programme’s class set named "<form> <CODE> <stream>" and skips existing ones', async () => {
    const auth = { authorization: `Bearer ${head}` };
    const ga = await http().post('/api/v1/programmes').set(auth).send({ name: 'General Arts', code: 'g/a' }).expect(201);
    expect(ga.body.code).toBe('G/A');

    const first = await http().post('/api/v1/classes/bulk').set(auth).send({ programmeId: ga.body.id, streams: 6 }).expect(201);
    expect(first.body.created).toHaveLength(18);
    expect(first.body.created).toContain('1G/A 1');
    expect(first.body.created).toContain('3G/A 6');

    const again = await http().post('/api/v1/classes/bulk').set(auth).send({ programmeId: ga.body.id, forms: [1], streams: 7 }).expect(201);
    expect(again.body).toEqual({ created: ['1G/A 7'], skipped: 6 });

    // Streams sort numerically, not alphabetically.
    const list = await http().get('/api/v1/classes').set(auth).expect(200);
    const form1 = list.body.filter((c: { name: string }) => c.name.startsWith('1G/A')).map((c: { name: string }) => c.name);
    expect(form1).toEqual(['1G/A 1', '1G/A 2', '1G/A 3', '1G/A 4', '1G/A 5', '1G/A 6', '1G/A 7']);

    await http().post('/api/v1/classes/bulk').set({ authorization: `Bearer ${teacherA}` }).send({ programmeId: ga.body.id, streams: 1 }).expect(403);
  });

  it('a manually created class still works and gets its stream from the name', async () => {
    const res = await http()
      .post('/api/v1/classes')
      .set({ authorization: `Bearer ${head}` })
      .send({ name: '1G/S 12', form: 1, programmeId: seed.science.id })
      .expect(201);
    expect(res.body.stream).toBe(12);
  });

  it("grades on the school's scale with grade points and computes the aggregate and GPA", async () => {
    // Boundaries: 80 → A1, 79 → B2, 44 → E8, 39 → F9.
    const auth = { authorization: `Bearer ${teacherA}` };
    const rows = await http()
      .put('/api/v1/results')
      .set(auth)
      .send({ termId: seed.term.id, classId: seed.classA.id, subjectId: seed.maths.id, entries: [{ studentId: seed.studentA.id, scores: marksFor(80) }] })
      .expect(200);
    expect(rows.body[0]).toMatchObject({ total: 80, grade: 'A1', gradePoint: 1, remark: 'Excellent' });

    const cases: [number, string, number][] = [
      [79, 'B2', 2],
      [65, 'B3', 3],
      [44, 'E8', 8],
      [39, 'F9', 9],
    ];
    for (const [total, grade, points] of cases) {
      const res = await http()
        .put('/api/v1/results')
        .set(auth)
        .send({ termId: seed.term.id, classId: seed.classA.id, subjectId: seed.maths.id, entries: [{ studentId: seed.studentA.id, scores: marksFor(total) }] })
        .expect(200);
      expect(res.body[0]).toMatchObject({ grade, gradePoint: points });
    }

    // Three core + three elective subjects → aggregate of best 3 + best 3.
    const subjects = await db
      .insert(schema.subjects)
      .values([
        { code: 'ENG', name: 'English Language', isCore: true },
        { code: 'ISCI', name: 'Integrated Science', isCore: true },
        { code: 'PHY', name: 'Physics', isCore: false },
        { code: 'CHEM', name: 'Chemistry', isCore: false },
        { code: 'BIO', name: 'Biology', isCore: false },
      ])
      .returning();
    await db.insert(schema.classSubjects).values(subjects.map((s) => ({ classId: seed.classA.id, subjectId: s.id, teacherId: seed.teacherA.id })));
    const totals = [80, 72, 66, 61, 50]; // A1, B2, B3, C4, C6
    for (const [i, s] of subjects.entries()) {
      await http()
        .put('/api/v1/results')
        .set(auth)
        .send({ termId: seed.term.id, classId: seed.classA.id, subjectId: s.id, entries: [{ studentId: seed.studentA.id, scores: marksFor(totals[i]) }] })
        .expect(200);
    }
    await http().post('/api/v1/results/publish').set({ authorization: `Bearer ${head}` }).send({ termId: seed.term.id, classId: seed.classA.id }).expect(200);

    const student = (await login(app, 'student.a@test.local')).accessToken;
    const mine = await http().get('/api/v1/results/mine').set({ authorization: `Bearer ${student}` }).expect(200);
    // Core: maths F9 (9), English A1 (1), Int. Science B2 (2) → 12. Electives: B3 (3), C4 (4), C6 (6) → 13.
    // GPA: 0 + 4.0 + 3.5 + 3.0 + 2.5 + 1.5 = 14.5 over 6 subjects → 2.4.
    expect(mine.body.terms[0]).toMatchObject({ subjects: 6, aggregate: 25, gpa: 2.4 });
  });

  it('builds the official transcript from published results, with cumulative GPA and credits', async () => {
    const studentToken = (await login(app, 'student.a@test.local')).accessToken;
    const own = await http().get(`/api/v1/results/transcript/${seed.studentA.id}`).set({ authorization: `Bearer ${studentToken}` }).expect(200);
    expect(own.body.years).toHaveLength(1);
    expect(own.body.years[0].year).toBe(1);
    const english = own.body.years[0].courses.find((c: { subjectName: string }) => c.subjectName === 'English Language');
    expect(english.semesters[0]).toEqual({ gpa: 4, grade: 'A1' });
    // Five subjects passed (everything but the F9) at 10 credits each.
    expect(own.body).toMatchObject({ cumulativeGpa: 2.4, creditsEarned: 50, creditsPerSubject: 10 });
    expect(own.body.gradeInterpretation[0]).toEqual({ grade: 'A1', gpa: 4, min: 80, max: 100, remark: 'Excellent' });
    expect(own.body.gradeInterpretation.at(-1)).toMatchObject({ grade: 'F9', min: 0, max: 39 });

    // Teachers don't issue transcripts; leadership does (and it is audited).
    await http().get(`/api/v1/results/transcript/${seed.studentA.id}`).set({ authorization: `Bearer ${teacherA}` }).expect(403);
    await http().get(`/api/v1/results/transcript/${seed.studentA.id}`).set({ authorization: `Bearer ${head}` }).expect(200);
  });

  it('regrades unpublished results when the scale changes, and keeps published grades as issued', async () => {
    const auth = { authorization: `Bearer ${head}` };
    const [term2] = await db
      .insert(schema.terms)
      .values({ academicYearId: seed.term.academicYearId, name: 'Second Semester', semester: 2, startsOn: '2027-01-10', endsOn: '2027-04-10' })
      .returning();
    await http()
      .put('/api/v1/results')
      .set({ authorization: `Bearer ${teacherA}` })
      .send({ termId: term2.id, classId: seed.classA.id, subjectId: seed.maths.id, entries: [{ studentId: seed.studentA.id, scores: marksFor(77) }] })
      .expect(200);

    const scale = (await http().get('/api/v1/school/grading-scale').set(auth).expect(200)).body;
    const easier = { ...scale, bands: scale.bands.map((b: { grade: string; min: number }) => (b.grade === 'A1' ? { ...b, min: 75 } : b)) };
    await http().put('/api/v1/school/grading-scale').set(auth).send(easier).expect(200);

    const rows = (await http().get(`/api/v1/results/student/${seed.studentA.id}`).set(auth).expect(200)).body.rows;
    const byTerm = (termId: string, subject: string) => rows.find((r: { termId: string; subjectName: string }) => r.termId === termId && r.subjectName === subject);
    expect(byTerm(term2.id, seed.maths.name)).toMatchObject({ total: 77, grade: 'A1' }); // unpublished: regraded
    expect(byTerm(seed.term.id, 'Biology')).toMatchObject({ grade: 'C6' }); // published: unchanged
    await http().put('/api/v1/school/grading-scale').set(auth).send(scale).expect(200);
  });
});
