import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, insertUser, login, PASSWORD, resetDatabase, seedSchool, testDb } from './setup';

describe('authentication', () => {
  let app: INestApplication;
  const { db, close } = testDb();
  let seed: Awaited<ReturnType<typeof seedSchool>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetDatabase();
    seed = await seedSchool(db);
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  it('rejects requests without a token', async () => {
    await http().get('/api/v1/auth/me').expect(401);
  });

  it('signs in with email (any case) or student number and returns the profile', async () => {
    const byEmail = await http().post('/api/v1/auth/login').send({ identifier: 'STUDENT.A@test.local', password: PASSWORD }).expect(200);
    expect(byEmail.body.user.role).toBe('student');
    expect(byEmail.body.user.student.className).toBe('2 Science A');

    const byNumber = await http().post('/api/v1/auth/login').send({ identifier: 'sda0001', password: PASSWORD }).expect(200);
    expect(byNumber.body.user.id).toBe(seed.studentAUser.id);
  });

  it('gives the same answer for unknown accounts and wrong passwords', async () => {
    const unknown = await http().post('/api/v1/auth/login').send({ identifier: 'nobody@test.local', password: PASSWORD }).expect(401);
    const wrong = await http().post('/api/v1/auth/login').send({ identifier: 'head@test.local', password: 'wrong-password-1' }).expect(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('locks an account after repeated failures', async () => {
    await insertUser(db, 'Lock Me', 'teacher', 'lock@test.local');
    for (let i = 0; i < 5; i++) {
      await http().post('/api/v1/auth/login').send({ identifier: 'lock@test.local', password: 'wrong-password-1' }).expect(401);
    }
    const locked = await http().post('/api/v1/auth/login').send({ identifier: 'lock@test.local', password: PASSWORD }).expect(401);
    expect(locked.body.message).toMatch(/Too many failed attempts/);
  });

  it('forces a temporary password to be changed before anything else, then signs out other devices', async () => {
    await insertUser(db, 'New Teacher', 'teacher', 'new@test.local', true);
    const first = await login(app, 'new@test.local');
    const second = await login(app, 'new@test.local');
    const auth = { authorization: `Bearer ${first.accessToken}` };

    await http().get('/api/v1/auth/me').set(auth).expect(200);
    await http().get('/api/v1/announcements').set(auth).expect(403);

    await http()
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: PASSWORD, newPassword: 'short' })
      .expect(400);
    const changed = await http()
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ currentPassword: PASSWORD, newPassword: 'A-much-better-pass-9' })
      .expect(200);
    expect(changed.body.mustChangePassword).toBe(false);

    await http().get('/api/v1/announcements').set(auth).expect(200);
    await http().get('/api/v1/auth/me').set({ authorization: `Bearer ${second.accessToken}` }).expect(401);
  });

  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    const tokens = await login(app, 'teacher.b@test.local');
    const rotated = await http().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(tokens.refreshToken);
    await http().get('/api/v1/auth/me').set({ authorization: `Bearer ${rotated.body.accessToken}` }).expect(200);

    // Replaying the first token looks like theft: the session ends for everyone holding it.
    await http().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
    await http().get('/api/v1/auth/me').set({ authorization: `Bearer ${rotated.body.accessToken}` }).expect(401);
  });

  it('ends access immediately when an account is deactivated', async () => {
    const victim = await insertUser(db, 'Leaving Teacher', 'teacher', 'leaving@test.local');
    const t = await login(app, 'leaving@test.local');
    const head = await login(app, 'head@test.local');
    await http()
      .patch(`/api/v1/users/${victim.id}`)
      .set({ authorization: `Bearer ${head.accessToken}` })
      .send({ status: 'deactivated' })
      .expect(200);
    await http().get('/api/v1/auth/me').set({ authorization: `Bearer ${t.accessToken}` }).expect(401);
    await http().post('/api/v1/auth/login').send({ identifier: 'leaving@test.local', password: PASSWORD }).expect(401);
  });

  it('logout revokes only the current device', async () => {
    const a = await login(app, 'accounts@test.local');
    const b = await login(app, 'accounts@test.local');
    await http().post('/api/v1/auth/logout').set({ authorization: `Bearer ${a.accessToken}` }).expect(204);
    await http().get('/api/v1/auth/me').set({ authorization: `Bearer ${a.accessToken}` }).expect(401);
    await http().get('/api/v1/auth/me').set({ authorization: `Bearer ${b.accessToken}` }).expect(200);
  });

  it('does not let a head create a super administrator', async () => {
    const head = await login(app, 'head@test.local');
    await http()
      .post('/api/v1/users')
      .set({ authorization: `Bearer ${head.accessToken}` })
      .send({ fullName: 'Sneaky', email: 'sneaky@test.local', role: 'super_admin', temporaryPassword: 'Temporary-pass-1' })
      .expect(403);
  });

  it('lets a head create a student who must then change their password', async () => {
    const head = await login(app, 'head@test.local');
    const created = await http()
      .post('/api/v1/users')
      .set({ authorization: `Bearer ${head.accessToken}` })
      .send({
        fullName: 'New Student',
        role: 'student',
        temporaryPassword: 'Temporary-pass-1',
        student: { studentNumber: 'sda0099', classId: seed.classA.id },
      })
      .expect(201);
    expect(created.body.student.studentNumber).toBe('SDA0099');
    const res = await http().post('/api/v1/auth/login').send({ identifier: 'SDA0099', password: 'Temporary-pass-1' }).expect(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });
});
