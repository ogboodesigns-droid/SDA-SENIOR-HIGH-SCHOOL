import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import * as schema from '../src/database/schema';
import { loadSchoolCatalogue } from '../src/database/school-catalogue';
import { loadSampleTimetables } from '../src/database/sample-timetables';
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
    // 29 subjects from the list + the fixture's maths; 14 classes per form × 3 + the fixture's 2 classes.
    expect(first).toEqual({ subjects: 30, programmes: 6, classes: 44, houses: 4 });
    expect(again).toEqual(first);
    const combos = await db.select().from(schema.subjectCombinations);
    expect(combos).toHaveLength(7 + 7 + 5 + 5 + 10 + 4);
    expect(combos.filter((c) => c.mustDropOne)).toHaveLength(3);
  });

  it('creates Arts 1–4, Bus 1–2, H/Econs 1–3, Lang 1–2, Science 1 and Visual 1–2 for every form, named like the combination list', async () => {
    const names = (await http().get('/api/v1/classes').set(bearer(head)).expect(200)).body.map((c: { name: string }) => c.name);
    for (const form of [1, 2, 3]) {
      expect(names).toEqual(
        expect.arrayContaining([
          `${form}G/A 1`,
          `${form}G/A 4`,
          `${form}BUS 2`,
          `${form}H/E 3`,
          `${form} LANG 1`,
          `${form} LANG 2`,
          `${form}G/S 1`,
          `${form}VIS 2`,
        ]),
      );
      expect(names).not.toContain(`${form}G/A 5`);
      expect(names).not.toContain(`${form}G/S 2`);
    }
    // Adding a class later still works and follows the same naming.
    const bus = await programme('BUS');
    const res = await http().post('/api/v1/classes/bulk').set(bearer(head)).send({ programmeId: bus.id, forms: [1], streams: 3 }).expect(201);
    expect(res.body).toEqual({ created: ['1BUS 3'], skipped: 2 });
    const lang = await programme('LANG');
    const more = await http().post('/api/v1/classes/bulk').set(bearer(head)).send({ programmeId: lang.id, forms: [1], streams: 3 }).expect(201);
    expect(more.body.created).toEqual(['1 LANG 3']);
    [bus1] = await db.select().from(schema.classes).where(eq(schema.classes.name, '1BUS 1'));

    const subjects = await http().get(`/api/v1/classes/${bus1.id}/subjects`).set(bearer(head)).expect(200);
    const subjectNames = subjects.body.map((s: { name: string }) => s.name).sort();
    // 5 core + options 1A/1B electives (Business Management, Accounting, Economics, ICT, Art & Design Studio, French)
    expect(subjectNames).toEqual(
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
    const [sci] = await db.select().from(schema.classes).where(eq(schema.classes.name, '1G/S 1'));
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
    // Both groups take Economics: allowed (the school decides) but flagged.
    const econ = await slot('ECON');
    expect(econ.status).toBe(201);
    expect(econ.body.warnings).toEqual(['Option 1 (1BUS 1A) takes both subjects in this period', 'Option 2 (1BUS 1B) takes both subjects in this period']);
    await http().delete(`/api/v1/timetable/${econ.body.id}`).set(bearer(head)).expect(204);

    // Friday 09:30–11:30 is PLC / VLC.
    const plc = await http()
      .post('/api/v1/timetable')
      .set(bearer(head))
      .send({ termId: seed.term.id, classId: bus1.id, subjectId: await subjectId('ICT'), dayOfWeek: 5, startsAt: '10:30', endsAt: '11:30' });
    expect(plc.status).toBe(409);
    expect(plc.body.message).toMatch(/PLC \/ VLC/);

    const artWeek = await http().get('/api/v1/timetable/mine').set(bearer(studentArt)).expect(200);
    expect(artWeek.body.map((s: { subjectName: string }) => s.subjectName)).toEqual(['Art & Design Studio']);
  });

  it('loads the provisional 1SC and 1HE2 timetables, splits included', async () => {
    const report = await loadSampleTimetables(db, seed.term.id);
    expect(report).toEqual({ '1G/S 1': '49 lessons added', '1H/E 2': '49 lessons added' });
    expect(await loadSampleTimetables(db, seed.term.id)).toEqual({
      '1G/S 1': 'already has a timetable for this semester; left unchanged',
      '1H/E 2': 'already has a timetable for this semester; left unchanged',
    });

    const [he2] = await db.select().from(schema.classes).where(eq(schema.classes.name, '1H/E 2'));
    const week = (await http().get(`/api/v1/timetable/class/${he2.id}?termId=${seed.term.id}`).set(bearer(head)).expect(200)).body as {
      dayOfWeek: number;
      startsAt: string;
      subjectName: string;
    }[];
    const wedP7 = week.filter((s) => s.dayOfWeek === 3 && s.startsAt === '14:00').map((s) => s.subjectName).sort();
    expect(wedP7).toEqual(['Art & Design Foundation', 'French']);
    // Each subject has 4 periods a week; core PEH has 1.
    const count = (n: string) => week.filter((s) => s.subjectName === n).length;
    expect(count('Clothing & Textiles')).toBe(4);
    expect(count('ICT')).toBe(4);
    expect(count('Physical Education & Health')).toBe(1);
  });

  it("Dodjivi's French for 1SC and 1HE2 is one combined lesson, not a clash", async () => {
    const dodjivi = await insertUser(db, 'Dodjivi', 'teacher', 'dodjivi@test.local');
    const french = await subjectId('FREN');
    const [sc] = await db.select().from(schema.classes).where(eq(schema.classes.name, '1G/S 1'));
    const [he2] = await db.select().from(schema.classes).where(eq(schema.classes.name, '1H/E 2'));
    for (const c of [sc, he2]) {
      await http().put('/api/v1/class-subjects').set(bearer(head)).send({ classId: c.id, subjectId: french, teacherId: dodjivi.id }).expect(200);
    }

    type Slot = { dayOfWeek: number; startsAt: string; subjectName: string; className: string; combinedWith: string[] };
    const week = async (classId: string) =>
      (await http().get(`/api/v1/timetable/class/${classId}?termId=${seed.term.id}`).set(bearer(head)).expect(200)).body as Slot[];
    const wedP7 = (slots: Slot[]) => slots.find((s) => s.dayOfWeek === 3 && s.startsAt === '14:00' && s.subjectName === 'French');
    expect(wedP7(await week(he2.id))?.combinedWith).toEqual(['1G/S 1']);
    expect(wedP7(await week(sc.id))?.combinedWith).toEqual(['1H/E 2']);
    // Lessons that aren't shared stay uncombined.
    expect((await week(he2.id)).find((s) => s.subjectName === 'English Language')?.combinedWith).toEqual([]);

    // Dodjivi's own week shows one French lesson for both classes, 4 periods in all.
    const token = (await login(app, 'dodjivi@test.local')).accessToken;
    const mine = (await http().get(`/api/v1/timetable/mine?termId=${seed.term.id}`).set(bearer(token)).expect(200)).body as Slot[];
    expect(mine).toHaveLength(4);
    expect(wedP7(mine)?.className).toBe('1G/S 1 + 1H/E 2');

    // Adding French for a third class at the same time joins the combined lesson without a warning…
    const [vis] = await db.select().from(schema.classes).where(eq(schema.classes.name, '1VIS 1'));
    await http().put('/api/v1/class-subjects').set(bearer(head)).send({ classId: vis.id, subjectId: french, teacherId: dodjivi.id }).expect(200);
    const joined = await http()
      .post('/api/v1/timetable')
      .set(bearer(head))
      .send({ termId: seed.term.id, classId: vis.id, subjectId: french, dayOfWeek: 3, startsAt: '14:00', endsAt: '15:00' })
      .expect(201);
    expect(joined.body.warnings).toEqual([]);
    expect(wedP7(await week(he2.id))?.combinedWith).toEqual(['1G/S 1', '1VIS 1']);

    // …but a different subject for the same teacher at that time is a real double-booking.
    const ict = await subjectId('ICT');
    await http().put('/api/v1/class-subjects').set(bearer(head)).send({ classId: vis.id, subjectId: ict, teacherId: dodjivi.id }).expect(200);
    const clash = await http()
      .post('/api/v1/timetable')
      .set(bearer(head))
      .send({ termId: seed.term.id, classId: vis.id, subjectId: ict, dayOfWeek: 4, startsAt: '14:00', endsAt: '15:00' })
      .expect(201);
    expect(clash.body.warnings).toEqual(expect.arrayContaining(['The teacher is also teaching French to 1G/S 1 at this time']));
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
