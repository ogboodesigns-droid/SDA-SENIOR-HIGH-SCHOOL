import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import * as schema from '../src/database/schema';
import { loadSchoolCatalogue } from '../src/database/school-catalogue';
import { createApp, insertUser, login, marksFor, PASSWORD, resetDatabase, seedSchool, testDb } from './setup';

/** Learning-area options (subject combinations), houses and component marks, using the school's real catalogue. */
describe('options, houses and semester assessment', () => {
  let app: INestApplication;
  const { db, close } = testDb();
  let seed: Awaited<ReturnType<typeof seedSchool>>;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  let head: string;

  const subjectId = async (code: string) => (await db.select().from(schema.subjects).where(eq(schema.subjects.code, code)))[0].id;
  const programme = async (code: string) => (await db.select().from(schema.programmes).where(eq(schema.programmes.code, code)))[0];
  const option = async (programmeId: string, n: number) =>
    (await http().get(`/api/v1/combinations?programmeId=${programmeId}`).set(bearer(head)).expect(200)).body.find((c: { option: number }) => c.option === n);

  let bus1: { id: string };
  let studentArt: string; // 1BUS 1A — Art & Design Studio
  let studentFrench: string; // 1BUS 1B — French
  let studentArtId: string;
  let studentFrenchId: string;
  let frenchTeacher: string;

  beforeAll(async () => {
    await resetDatabase();
    seed = await seedSchool(db);
    // The shared fixture's maths subject isn't part of the school's catalogue.
    await db.update(schema.subjects).set({ isCore: false }).where(eq(schema.subjects.code, 'CMATH'));
    app = await createApp();
    head = (await login(app, 'head@test.local')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  it('loads the catalogue from the combination list, and loading again changes nothing', async () => {
    const first = await loadSchoolCatalogue(db);
    const again = await loadSchoolCatalogue(db);
    expect(first).toEqual({ subjects: 30, programmes: 6, houses: 4 }); // 29 from the list + the test's maths
    expect(again).toEqual(first);
    const combos = await db.select().from(schema.subjectCombinations);
    expect(combos).toHaveLength(7 + 7 + 5 + 5 + 10 + 4);
    expect(combos.filter((c) => c.mustDropOne)).toHaveLength(3);
  });

  it('creates classes named like the combination list and gives them the subjects their options need', async () => {
    const bus = await programme('BUS');
    const res = await http().post('/api/v1/classes/bulk').set(bearer(head)).send({ programmeId: bus.id, forms: [1], streams: 2 }).expect(201);
    expect(res.body.created).toEqual(['1BUS 1', '1BUS 2']);
    [bus1] = await db.select().from(schema.classes).where(eq(schema.classes.name, '1BUS 1'));

    const subjects = await http().get(`/api/v1/classes/${bus1.id}/subjects`).set(bearer(head)).expect(200);
    const names = subjects.body.map((s: { name: string }) => s.name).sort();
    // 5 core + options 1A/1B electives (Business Management, Accounting, Economics, ICT, Art & Design Studio, French)
    expect(names).toEqual(
      [
        'Accounting',
        'Art & Design Studio',
        'Business Management',
        'Economics',
        'English Language',
        'French',
        'General Mathematics',
        'General Science',
        'ICT',
        'Physical Education & Health',
        'Social Studies',
      ].sort(),
    );
  });

  it('places students in an option that belongs to their class only', async () => {
    const bus = await programme('BUS');
    const [opt1, opt2, opt3] = await Promise.all([option(bus.id, 1), option(bus.id, 2), option(bus.id, 3)]);
    const houses = await http().get('/api/v1/houses').set(bearer(head)).expect(200);
    const gyeNyame = houses.body.find((h: { name: string }) => h.name === 'Gye Nyame');
    const asokore = houses.body.find((h: { name: string }) => h.name === 'Asokore');

    const make = (n: string, combinationId: string, houseId: string) =>
      http()
        .post('/api/v1/users')
        .set(bearer(head))
        .send({ fullName: `Student ${n}`, role: 'student', temporaryPassword: PASSWORD, student: { studentNumber: n, classId: bus1.id, combinationId, houseId } });

    // Option 3 is class 2 (1BUS 2A), not 1BUS 1.
    await make('BUS9', opt3.id, gyeNyame.id).expect(400);
    const a = await make('BUS1', opt1.id, gyeNyame.id).expect(201);
    const b = await make('BUS2', opt2.id, asokore.id).expect(201);
    expect(a.body.student).toMatchObject({ groupName: '1BUS 1A', houseName: 'Gye Nyame' });
    expect(b.body.student).toMatchObject({ groupName: '1BUS 1B', houseName: 'Asokore' });
    studentArtId = a.body.student.id;
    studentFrenchId = b.body.student.id;
    await db.update(schema.users).set({ mustChangePassword: false });
    studentArt = (await login(app, 'BUS1')).accessToken;
    studentFrench = (await login(app, 'BUS2')).accessToken;
  });

  it("students see only their option's subjects", async () => {
    const art = (await http().get('/api/v1/me/subjects').set(bearer(studentArt)).expect(200)).body.map((s: { name: string }) => s.name);
    expect(art).toContain('Art & Design Studio');
    expect(art).not.toContain('French');
    expect(art).toContain('General Science');
    expect(art).toHaveLength(10);

    // Science students don't take General Science as a core subject.
    const gs = await programme('G/S');
    const [sci] = await db.insert(schema.classes).values({ name: '1G/S 1', form: 1, stream: 1, programmeId: gs.id }).returning();
    const opt = await option(gs.id, 2);
    await http()
      .post('/api/v1/users')
      .set(bearer(head))
      .send({ fullName: 'Sci Student', role: 'student', temporaryPassword: PASSWORD, student: { studentNumber: 'GS1', classId: sci.id, combinationId: opt.id } })
      .expect(201);
    await db.update(schema.users).set({ mustChangePassword: false });
    const sciToken = (await login(app, 'GS1')).accessToken;
    const sciSubjects = (await http().get('/api/v1/me/subjects').set(bearer(sciToken)).expect(200)).body.map((s: { name: string }) => s.name);
    expect(sciSubjects).not.toContain('General Science');
    expect(sciSubjects).toEqual(expect.arrayContaining(['Physics', 'Chemistry', 'Biology', 'Additional Mathematics', 'Computing', 'Business Management']));
  });

  it('elective work and marks reach only the students taking that subject', async () => {
    const teacher = await insertUser(db, 'French Teacher', 'teacher', 'french@test.local');
    const french = await subjectId('FREN');
    await http().put('/api/v1/class-subjects').set(bearer(head)).send({ classId: bus1.id, subjectId: french, teacherId: teacher.id }).expect(200);
    frenchTeacher = (await login(app, 'french@test.local')).accessToken;

    const roster = await http().get(`/api/v1/classes/${bus1.id}/students?subjectId=${french}`).set(bearer(frenchTeacher)).expect(200);
    expect(roster.body.map((s: { groupName: string }) => s.groupName)).toEqual(['1BUS 1B']);

    const due = new Date(Date.now() + 86_400_000).toISOString();
    const set = await http()
      .post('/api/v1/assignments')
      .set(bearer(frenchTeacher))
      .send({ classId: bus1.id, subjectId: french, title: 'Les verbes', instructions: 'Exercise 3', dueAt: due })
      .expect(201);
    expect((await http().get('/api/v1/assignments').set(bearer(studentFrench)).expect(200)).body).toHaveLength(1);
    expect((await http().get('/api/v1/assignments').set(bearer(studentArt)).expect(200)).body).toHaveLength(0);
    await http().get(`/api/v1/assignments/${set.body.id}`).set(bearer(studentArt)).expect(404);
    await http().post(`/api/v1/assignments/${set.body.id}/submission`).set(bearer(studentArt)).send({ textResponse: 'x' }).expect(404);

    const notes = await http().get('/api/v1/notifications').set(bearer(studentArt)).expect(200);
    expect(notes.body.items).toHaveLength(0);

    const term = seed.term.id;
    await http()
      .put('/api/v1/results')
      .set(bearer(frenchTeacher))
      .send({ termId: term, classId: bus1.id, subjectId: french, entries: [{ studentId: studentArtId, scores: marksFor(60) }] })
      .expect(400);
  });

  it('marks are entered per assessment component and only complete results are published', async () => {
    const french = await subjectId('FREN');
    const body = (scores: Record<string, number | null>) => ({
      termId: seed.term.id,
      classId: bus1.id,
      subjectId: french,
      entries: [{ studentId: studentFrenchId, scores }],
    });
    await http().put('/api/v1/results').set(bearer(frenchTeacher)).send(body({ exam: 41 })).expect(400);
    await http().put('/api/v1/results').set(bearer(frenchTeacher)).send(body({ homework: 5 })).expect(400);

    // Marks added during the semester…
    const partial = await http().put('/api/v1/results').set(bearer(frenchTeacher)).send(body({ class: 13, midsem: 12 })).expect(200);
    expect(partial.body[0]).toMatchObject({ complete: false, total: 25 });
    const pub1 = await http().post('/api/v1/results/publish').set(bearer(head)).send({ termId: seed.term.id, classId: bus1.id }).expect(200);
    expect(pub1.body).toEqual({ published: 0, students: 0, incomplete: 1 });

    // …and the rest at the end; earlier components are kept.
    const done = await http().put('/api/v1/results').set(bearer(frenchTeacher)).send(body({ practical: 8, project: 17, exam: 31 })).expect(200);
    expect(done.body[0]).toMatchObject({ complete: true, total: 81, caScore: 50, examScore: 31, grade: 'A1' });
    expect(done.body[0].breakdown.map((b: { key: string; score: number }) => [b.key, b.score])).toEqual([
      ['class', 13],
      ['midsem', 12],
      ['practical', 8],
      ['project', 17],
      ['exam', 31],
    ]);
    const pub2 = await http().post('/api/v1/results/publish').set(bearer(head)).send({ termId: seed.term.id, classId: bus1.id }).expect(200);
    expect(pub2.body).toEqual({ published: 1, students: 1, incomplete: 0 });
  });

  it('electives for different option groups can share a period; core lessons cannot', async () => {
    const slot = (code: string, startsAt = '10:00', endsAt = '11:00') =>
      subjectId(code).then((id) =>
        http().post('/api/v1/timetable').set(bearer(head)).send({ termId: seed.term.id, classId: bus1.id, subjectId: id, dayOfWeek: 2, startsAt, endsAt }),
      );
    expect((await slot('FREN')).status).toBe(201);
    expect((await slot('ADS')).status).toBe(201); // 1BUS 1A has Art & Design Studio while 1BUS 1B has French
    expect((await slot('ENG', '10:30', '11:30')).status).toBe(409);
    expect((await slot('ECON')).status).toBe(409); // both groups take Economics

    const artWeek = await http().get('/api/v1/timetable/mine').set(bearer(studentArt)).expect(200);
    expect(artWeek.body.map((s: { subjectName: string }) => s.subjectName)).toEqual(['Art & Design Studio']);
  });

  it('houses: leadership awards points; house notices reach that house only', async () => {
    const houses = (await http().get('/api/v1/houses').set(bearer(studentArt)).expect(200)).body;
    const asokore = houses.find((h: { name: string }) => h.name === 'Asokore');
    const teacher = (await login(app, 'teacher.a@test.local')).accessToken;
    await http().post(`/api/v1/houses/${asokore.id}/points`).set(bearer(teacher)).send({ points: 50, reason: 'Inter-house athletics' }).expect(403);
    await http().post(`/api/v1/houses/${asokore.id}/points`).set(bearer(head)).send({ points: 50, reason: 'Inter-house athletics' }).expect(201);
    await http().post(`/api/v1/houses/${asokore.id}/points`).set(bearer(head)).send({ points: -5, reason: 'Late for assembly' }).expect(201);

    const standings = (await http().get('/api/v1/houses').set(bearer(studentArt)).expect(200)).body;
    expect(standings[0]).toMatchObject({ name: 'Asokore', points: 45, members: 1 });

    await http()
      .post('/api/v1/announcements')
      .set(bearer(head))
      .send({ title: 'Asokore house meeting', body: 'After prep', category: 'boarding', audienceType: 'house', audienceRef: asokore.id })
      .expect(201);
    const seen = async (t: string) => (await http().get('/api/v1/announcements').set(bearer(t)).expect(200)).body.map((a: { title: string }) => a.title);
    expect(await seen(studentFrench)).toContain('Asokore house meeting');
    expect(await seen(studentArt)).not.toContain('Asokore house meeting');
  });
});
