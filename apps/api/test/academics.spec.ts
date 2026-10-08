import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as schema from '../src/database/schema';
import { createApp, login, marksFor, resetDatabase, seedSchool, testDb } from './setup';

describe('classes and WAEC grading', () => {
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

  it('grades on the WASSCE scale with grade points and computes the aggregate', async () => {
    // Boundaries: 75 → A1, 74 → B2, 44 → E8, 39 → F9.
    const auth = { authorization: `Bearer ${teacherA}` };
    const rows = await http()
      .put('/api/v1/results')
      .set(auth)
      .send({ termId: seed.term.id, classId: seed.classA.id, subjectId: seed.maths.id, entries: [{ studentId: seed.studentA.id, scores: marksFor(75) }] })
      .expect(200);
    expect(rows.body[0]).toMatchObject({ total: 75, grade: 'A1', gradePoint: 1, remark: 'Excellent' });

    const cases: [number, string, number][] = [
      [74, 'B2', 2],
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
    expect(mine.body.terms[0]).toMatchObject({ subjects: 6, aggregate: 25 });
  });
});
