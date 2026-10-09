import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/database/schema';
import { todayInGhana } from '../src/attendance/attendance.service';
import { createApp, login, resetDatabase, seedSchool, testDb } from './setup';

const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

describe('attendance', () => {
  let app: INestApplication;
  const { db, close } = testDb();
  let seed: Awaited<ReturnType<typeof seedSchool>>;
  let head: string;
  let teacherA: string;
  let teacherB: string;
  let student: string;
  const today = todayInGhana();
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const save = (token: string, date: string, entries: object[], classId = seed.classA.id) =>
    http().put('/api/v1/attendance/register').set(bearer(token)).send({ classId, date, entries });

  beforeAll(async () => {
    await resetDatabase();
    seed = await seedSchool(db);
    // The semester runs around today, so "absent today" alerts can be tested.
    await db.update(schema.terms).set({ startsOn: shift(today, -30), endsOn: shift(today, 30) }).where(eq(schema.terms.id, seed.term.id));
    app = await createApp();
    head = (await login(app, 'head@test.local')).accessToken;
    teacherA = (await login(app, 'teacher.a@test.local')).accessToken;
    teacherB = (await login(app, 'teacher.b@test.local')).accessToken;
    student = (await login(app, 'student.a@test.local')).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  it("gives the class's teachers today's register and keeps other teachers out", async () => {
    const res = await http().get(`/api/v1/attendance/register?classId=${seed.classA.id}`).set(bearer(teacherA)).expect(200);
    expect(res.body).toMatchObject({ date: today, taken: false, className: '2 Science A' });
    expect(res.body.students).toEqual([expect.objectContaining({ studentId: seed.studentA.id, status: null })]);
    await http().get(`/api/v1/attendance/register?classId=${seed.classA.id}`).set(bearer(teacherB)).expect(403);
    await http().get(`/api/v1/attendance/register?classId=${seed.classA.id}`).set(bearer(student)).expect(403);
  });

  it('records the register and tells guardians once when a child is absent today', async () => {
    const res = await save(teacherA, today, [{ studentId: seed.studentA.id, status: 'absent' }]).expect(200);
    expect(res.body).toMatchObject({ taken: true, takenBy: 'Teacher A' });
    expect(res.body.students[0]).toMatchObject({ status: 'absent' });
    // Saving the same mark again doesn't send a second alert.
    await save(teacherA, today, [{ studentId: seed.studentA.id, status: 'absent', note: 'No word from home' }]).expect(200);

    const alerts = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.type, 'attendance'), eq(schema.notifications.userId, seed.parentA.id)));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain('Student A was marked absent');
    // The student and other parents get nothing.
    const others = await db.select().from(schema.notifications).where(eq(schema.notifications.type, 'attendance'));
    expect(others).toHaveLength(1);
  });

  it('refuses future dates, dates outside any semester and students from another class', async () => {
    await save(teacherA, shift(today, 1), [{ studentId: seed.studentA.id, status: 'present' }]).expect(400);
    await save(teacherA, shift(today, -400), [{ studentId: seed.studentA.id, status: 'present' }]).expect(400);
    await save(teacherA, today, [{ studentId: seed.studentB.id, status: 'present' }]).expect(400);
    await save(teacherB, today, [{ studentId: seed.studentA.id, status: 'present' }]).expect(403);
  });

  it('summarises the semester for staff, the student and the report card', async () => {
    await save(head, shift(today, -1), [{ studentId: seed.studentA.id, status: 'present' }]).expect(200);
    await save(teacherA, shift(today, -2), [{ studentId: seed.studentA.id, status: 'late' }]).expect(200);

    const summary = await http().get(`/api/v1/attendance/summary?classId=${seed.classA.id}&termId=${seed.term.id}`).set(bearer(teacherA)).expect(200);
    // Late counts as present: 2 of 3 days.
    expect(summary.body[0]).toMatchObject({ present: 1, late: 1, absent: 1, excused: 0, days: 3, percentage: 66.7 });

    const mine = await http().get(`/api/v1/attendance/mine?termId=${seed.term.id}`).set(bearer(student)).expect(200);
    expect(mine.body.counts).toMatchObject({ days: 3, percentage: 66.7 });
    expect(mine.body.exceptions.map((e: { status: string }) => e.status)).toEqual(['absent', 'late']);
    expect(mine.body.exceptions[0]).toMatchObject({ date: today, note: 'No word from home' });
    await http().get(`/api/v1/attendance/mine?termId=${seed.term.id}&studentId=${seed.studentB.id}`).set(bearer(student)).expect(404);

    const card = await http().get(`/api/v1/reports/student/${seed.studentA.id}?termId=${seed.term.id}`).set(bearer(head)).expect(200);
    expect(card.body.attendance).toEqual({ attended: 2, days: 3 });
  });

  it("shows leadership which classes' registers are marked today", async () => {
    const res = await http().get('/api/v1/attendance/overview').set(bearer(head)).expect(200);
    expect(res.body.find((c: { classId: string }) => c.classId === seed.classA.id)).toMatchObject({ students: 1, marked: 1, absent: 1 });
    expect(res.body.find((c: { classId: string }) => c.classId === seed.classB.id)).toMatchObject({ students: 1, marked: 0 });
    await http().get('/api/v1/attendance/overview').set(bearer(teacherA)).expect(403);
  });
});
