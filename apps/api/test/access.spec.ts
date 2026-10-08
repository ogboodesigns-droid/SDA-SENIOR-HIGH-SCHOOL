import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, login, resetDatabase, seedSchool, testDb } from './setup';

/**
 * Record-level access: who can see and change which student data.
 * Class A: Teacher A (maths + form master), Student A, Parent A.
 * Class B: Teacher B (maths), Student B, Parent B.
 */
describe('record-level access', () => {
  let app: INestApplication;
  const { db, close } = testDb();
  let seed: Awaited<ReturnType<typeof seedSchool>>;
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    await resetDatabase();
    seed = await seedSchool(db);
    app = await createApp();
    for (const [who, email] of Object.entries({
      head: 'head@test.local',
      teacherA: 'teacher.a@test.local',
      teacherB: 'teacher.b@test.local',
      accountant: 'accounts@test.local',
      studentA: 'student.a@test.local',
      studentB: 'student.b@test.local',
      parentA: 'parent.a@test.local',
      parentB: 'parent.b@test.local',
    })) {
      tokens[who] = (await login(app, email)).accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  describe('assignments', () => {
    let assignmentId: string;
    const due = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

    it('a teacher can set work only for a class-subject they are assigned to', async () => {
      const body = { classId: seed.classA.id, subjectId: seed.maths.id, title: 'Quadratics', instructions: 'Exercise 4B', dueAt: due(), maxScore: 20 };
      const res = await http().post('/api/v1/assignments').set(as('teacherA')).send(body).expect(201);
      assignmentId = res.body.id;
      await http().post('/api/v1/assignments').set(as('teacherB')).send(body).expect(403);
      await http().post('/api/v1/assignments').set(as('studentA')).send(body).expect(403);
    });

    it('notifies the class and its guardians, not other classes', async () => {
      const a = await http().get('/api/v1/notifications').set(as('parentA')).expect(200);
      expect(a.body.items.some((n: { type: string }) => n.type === 'assignment')).toBe(true);
      const b = await http().get('/api/v1/notifications').set(as('studentB')).expect(200);
      expect(b.body.items).toHaveLength(0);
    });

    it('is visible to the class, its parents and teachers only', async () => {
      const mine = await http().get('/api/v1/assignments').set(as('studentA')).expect(200);
      expect(mine.body.map((a: { id: string }) => a.id)).toContain(assignmentId);
      const child = await http().get('/api/v1/assignments').set(as('parentA')).expect(200);
      expect(child.body).toHaveLength(1);

      const other = await http().get('/api/v1/assignments').set(as('studentB')).expect(200);
      expect(other.body).toHaveLength(0);
      await http().get(`/api/v1/assignments/${assignmentId}`).set(as('studentB')).expect(404);
      await http().get(`/api/v1/assignments/${assignmentId}`).set(as('parentB')).expect(404);
      await http().get(`/api/v1/assignments/${assignmentId}`).set(as('teacherB')).expect(404);
    });

    it('only the class teacher can see and mark submissions', async () => {
      const sub = await http()
        .post(`/api/v1/assignments/${assignmentId}/submission`)
        .set(as('studentA'))
        .send({ textResponse: 'x = 2 or x = 3' })
        .expect(201);
      expect(sub.body.status).toBe('submitted');

      await http().post(`/api/v1/assignments/${assignmentId}/submission`).set(as('studentB')).send({ textResponse: 'hi' }).expect(404);
      await http().post(`/api/v1/assignments/${assignmentId}/submission`).set(as('parentA')).send({ textResponse: 'hi' }).expect(403);

      await http().get(`/api/v1/assignments/${assignmentId}/submissions`).set(as('teacherB')).expect(403);
      const list = await http().get(`/api/v1/assignments/${assignmentId}/submissions`).set(as('teacherA')).expect(200);
      expect(list.body).toHaveLength(1);

      await http().post(`/api/v1/submissions/${sub.body.id}/grade`).set(as('teacherA')).send({ score: 25 }).expect(400);
      await http().post(`/api/v1/submissions/${sub.body.id}/grade`).set(as('teacherB')).send({ score: 15 }).expect(403);
      await http().post(`/api/v1/submissions/${sub.body.id}/grade`).set(as('teacherA')).send({ score: 18, feedback: 'Good' }).expect(204);

      const after = await http().get(`/api/v1/assignments/${assignmentId}`).set(as('parentA')).expect(200);
      expect(after.body.mySubmission.score).toBe(18);
      // Marked work can't be silently replaced.
      await http().post(`/api/v1/assignments/${assignmentId}/submission`).set(as('studentA')).send({ textResponse: 'new' }).expect(400);
    });
  });

  describe('results', () => {
    it('only the subject teacher can enter marks, and grades are computed from the scale', async () => {
      const body = {
        termId: seed.term.id,
        classId: seed.classA.id,
        subjectId: seed.maths.id,
        entries: [{ studentId: seed.studentA.id, caScore: 27, examScore: 55 }],
      };
      await http().put('/api/v1/results').set(as('teacherB')).send(body).expect(403);
      await http()
        .put('/api/v1/results')
        .set(as('teacherA'))
        .send({ ...body, entries: [{ studentId: seed.studentB.id, caScore: 20, examScore: 50 }] })
        .expect(400);
      await http()
        .put('/api/v1/results')
        .set(as('teacherA'))
        .send({ ...body, entries: [{ studentId: seed.studentA.id, caScore: 31, examScore: 50 }] })
        .expect(400);

      const sheet = await http().put('/api/v1/results').set(as('teacherA')).send(body).expect(200);
      expect(sheet.body[0]).toMatchObject({ total: 82, grade: 'A1', published: false });
    });

    it('unpublished results are hidden from students and parents', async () => {
      const res = await http().get('/api/v1/results/mine').set(as('studentA')).expect(200);
      expect(res.body.rows).toHaveLength(0);
    });

    it('teachers cannot publish; leadership can', async () => {
      const body = { termId: seed.term.id, classId: seed.classA.id };
      await http().post('/api/v1/results/publish').set(as('teacherA')).send(body).expect(403);
      const res = await http().post('/api/v1/results/publish').set(as('head')).send(body).expect(200);
      expect(res.body).toEqual({ published: 1, students: 1 });
    });

    it('published results reach the student and their parent only', async () => {
      const own = await http().get('/api/v1/results/mine').set(as('studentA')).expect(200);
      expect(own.body.rows).toHaveLength(1);
      expect(own.body.terms[0].average).toBe(82);

      const parent = await http().get(`/api/v1/results/mine?studentId=${seed.studentA.id}`).set(as('parentA')).expect(200);
      expect(parent.body.rows).toHaveLength(1);

      await http().get(`/api/v1/results/mine?studentId=${seed.studentA.id}`).set(as('parentB')).expect(404);
      await http().get(`/api/v1/results/student/${seed.studentA.id}`).set(as('studentB')).expect(404);
      await http().get(`/api/v1/results/student/${seed.studentA.id}`).set(as('teacherB')).expect(404);
      await http().get(`/api/v1/results/student/${seed.studentA.id}`).set(as('accountant')).expect(404);
      await http().get(`/api/v1/results/student/${seed.studentA.id}`).set(as('teacherA')).expect(200);
    });

    it('published marks are frozen for teachers', async () => {
      await http()
        .put('/api/v1/results')
        .set(as('teacherA'))
        .send({ termId: seed.term.id, classId: seed.classA.id, subjectId: seed.maths.id, entries: [{ studentId: seed.studentA.id, caScore: 30, examScore: 70 }] })
        .expect(403);
    });
  });

  describe('announcements', () => {
    it('teachers may post only to classes they teach', async () => {
      const base = { title: 'Class test', body: 'Bring calculators', category: 'academic' };
      await http().post('/api/v1/announcements').set(as('teacherA')).send({ ...base, audienceType: 'school' }).expect(403);
      await http().post('/api/v1/announcements').set(as('teacherA')).send({ ...base, audienceType: 'class', audienceRef: seed.classB.id }).expect(403);
      await http().post('/api/v1/announcements').set(as('teacherA')).send({ ...base, audienceType: 'class', audienceRef: seed.classA.id }).expect(201);
      await http().post('/api/v1/announcements').set(as('studentA')).send({ ...base, audienceType: 'class', audienceRef: seed.classA.id }).expect(403);
    });

    it('targeted announcements reach only their audience', async () => {
      await http()
        .post('/api/v1/announcements')
        .set(as('head'))
        .send({ title: 'PTA meeting', body: 'Saturday', category: 'pta', audienceType: 'role', audienceRef: 'parent', sendPush: true })
        .expect(201);

      const titles = async (who: string) =>
        (await http().get('/api/v1/announcements').set(as(who)).expect(200)).body.map((a: { title: string }) => a.title).sort();

      expect(await titles('studentA')).toEqual(['Class test']);
      expect(await titles('studentB')).toEqual([]);
      expect(await titles('parentA')).toEqual(['Class test', 'PTA meeting']);
      expect(await titles('parentB')).toEqual(['PTA meeting']);
      expect(await titles('head')).toEqual(['Class test', 'PTA meeting']);

      const notes = await http().get('/api/v1/notifications').set(as('parentB')).expect(200);
      expect(notes.body.items.map((n: { title: string }) => n.title)).toContain('PTA meeting');
    });

    it('scheduled announcements stay hidden until their publish time', async () => {
      await http()
        .post('/api/v1/announcements')
        .set(as('head'))
        .send({ title: 'Future', body: 'Later', category: 'general', publishAt: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(201);
      const feed = await http().get('/api/v1/announcements').set(as('studentA')).expect(200);
      expect(feed.body.map((a: { title: string }) => a.title)).not.toContain('Future');
    });
  });

  describe('class information', () => {
    it('students cannot list classmates; the class teacher can', async () => {
      await http().get(`/api/v1/classes/${seed.classA.id}/students`).set(as('studentA')).expect(404);
      await http().get(`/api/v1/classes/${seed.classA.id}/students`).set(as('teacherB')).expect(404);
      const list = await http().get(`/api/v1/classes/${seed.classA.id}/students`).set(as('teacherA')).expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('timetable is limited to the student’s own class and clashes are refused', async () => {
      const slot = { termId: seed.term.id, classId: seed.classA.id, subjectId: seed.maths.id, dayOfWeek: 1, startsAt: '08:00', endsAt: '09:00' };
      await http().post('/api/v1/timetable').set(as('teacherA')).send(slot).expect(403);
      await http().post('/api/v1/timetable').set(as('head')).send(slot).expect(201);
      await http().post('/api/v1/timetable').set(as('head')).send({ ...slot, startsAt: '08:30', endsAt: '09:30' }).expect(409);

      const mine = await http().get('/api/v1/timetable/mine').set(as('studentA')).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({ startsAt: '08:00', subjectName: 'Core Mathematics', teacherName: 'Teacher A' });
      const teacher = await http().get('/api/v1/timetable/mine').set(as('teacherA')).expect(200);
      expect(teacher.body).toHaveLength(1);
      await http().get(`/api/v1/timetable/class/${seed.classA.id}`).set(as('studentB')).expect(404);
    });

    it('staff management routes are closed to students and parents', async () => {
      await http().get('/api/v1/users').set(as('studentA')).expect(403);
      await http().get('/api/v1/users').set(as('teacherA')).expect(403);
      await http().get('/api/v1/audit-logs').set(as('teacherA')).expect(403);
      await http().get('/api/v1/audit-logs').set(as('head')).expect(200);
    });
  });

  describe('files', () => {
    it('accepts real PDFs, rejects disguised files, and keeps them private', async () => {
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
      await http()
        .post('/api/v1/files')
        .set(as('studentA'))
        .attach('file', Buffer.from('MZ fake exe'), { filename: 'homework.pdf', contentType: 'application/pdf' })
        .expect(400);
      const up = await http()
        .post('/api/v1/files')
        .set(as('studentA'))
        .attach('file', pdf, { filename: 'homework.pdf', contentType: 'application/pdf' })
        .expect(201);
      await http().get(`/api/v1/files/${up.body.id}`).set(as('studentB')).expect(404);
      await http().get(`/api/v1/files/${up.body.id}`).set(as('studentA')).expect(200);
    });
  });
});
