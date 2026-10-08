import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from 'argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import type { Role } from '@sda-shs/shared';
import { DEFAULT_ASSESSMENT_SCHEMES, DEFAULT_GRADING_SCALE } from '@sda-shs/shared';
import * as schema from '../src/database/schema';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://sda_shs:sda_shs@localhost:5432/sda_shs_test';
export const PASSWORD = 'Correct-horse-42';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.LOCAL_STORAGE_DIR = '/tmp/sda-shs-test-uploads';

export async function resetDatabase() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await pool.end();
  const { runMigrations } = await import('../src/database/migrate');
  await runMigrations(TEST_DATABASE_URL);
}

export async function createApp(): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}

export function testDb() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

type Db = ReturnType<typeof testDb>['db'];

export async function insertUser(db: Db, fullName: string, role: Role, email: string, mustChangePassword = false) {
  const [u] = await db
    .insert(schema.users)
    .values({ fullName, role, email, passwordHash: await hash(PASSWORD), mustChangePassword })
    .returning();
  return u;
}

export async function login(app: INestApplication, identifier: string, password = PASSWORD) {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; refreshToken: string };
}

/**
 * Component marks adding up to `total` on the default scheme
 * (class 15, mid-sem 15, practical 10, project 20, exam 40), exam filled first.
 */
export function marksFor(total: number): Record<string, number> {
  let left = total;
  const out: Record<string, number> = {};
  for (const c of [...DEFAULT_ASSESSMENT_SCHEMES['1']].sort((a, b) => Number(b.isExam) - Number(a.isExam))) {
    out[c.key] = Math.min(c.weight, left);
    left -= out[c.key];
  }
  return out;
}

/** A small school: two classes, one teacher per class, a student in each, and a parent for each student. */
export async function seedSchool(db: Db) {
  await db
    .insert(schema.schoolProfile)
    .values({ id: 1, name: 'Test School', gradingScale: { bands: DEFAULT_GRADING_SCALE }, assessmentSchemes: DEFAULT_ASSESSMENT_SCHEMES });
  const [year] = await db.insert(schema.academicYears).values({ name: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-07-31' }).returning();
  const [term] = await db
    .insert(schema.terms)
    .values({ academicYearId: year.id, name: 'First Semester', startsOn: '2026-09-01', endsOn: '2026-12-18', isCurrent: true })
    .returning();
  const [science] = await db.insert(schema.programmes).values({ name: 'Test Science', code: 'TS' }).returning();

  const head = await insertUser(db, 'Head Teacher', 'head', 'head@test.local');
  const teacherA = await insertUser(db, 'Teacher A', 'teacher', 'teacher.a@test.local');
  const teacherB = await insertUser(db, 'Teacher B', 'teacher', 'teacher.b@test.local');
  const accountant = await insertUser(db, 'Accountant', 'accountant', 'accounts@test.local');

  const [classA] = await db
    .insert(schema.classes)
    .values({ name: '2 Science A', form: 2, programmeId: science.id, formMasterId: teacherA.id })
    .returning();
  const [classB] = await db.insert(schema.classes).values({ name: '2 Science B', form: 2, programmeId: science.id }).returning();
  const [maths] = await db.insert(schema.subjects).values({ code: 'CMATH', name: 'Core Mathematics', isCore: true }).returning();
  await db.insert(schema.classSubjects).values([
    { classId: classA.id, subjectId: maths.id, teacherId: teacherA.id },
    { classId: classB.id, subjectId: maths.id, teacherId: teacherB.id },
  ]);

  const studentAUser = await insertUser(db, 'Student A', 'student', 'student.a@test.local');
  const studentBUser = await insertUser(db, 'Student B', 'student', 'student.b@test.local');
  const [studentA] = await db.insert(schema.students).values({ userId: studentAUser.id, studentNumber: 'SDA0001', classId: classA.id }).returning();
  const [studentB] = await db.insert(schema.students).values({ userId: studentBUser.id, studentNumber: 'SDA0002', classId: classB.id }).returning();

  const parentA = await insertUser(db, 'Parent A', 'parent', 'parent.a@test.local');
  const parentB = await insertUser(db, 'Parent B', 'parent', 'parent.b@test.local');
  await db.insert(schema.guardianStudents).values([
    { guardianUserId: parentA.id, studentId: studentA.id, relationship: 'Mother' },
    { guardianUserId: parentB.id, studentId: studentB.id, relationship: 'Father' },
  ]);

  return { term, science, classA, classB, maths, head, teacherA, teacherB, accountant, studentA, studentB, studentAUser, studentBUser, parentA, parentB };
}
