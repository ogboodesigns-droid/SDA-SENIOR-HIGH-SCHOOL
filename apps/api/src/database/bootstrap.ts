/**
 * One-time setup for a fresh installation:
 *   - creates the school profile row with the official school name
 *   - creates the first Super Administrator account
 *
 * It deliberately creates no students, staff, classes or other sample data:
 * the school enters its real records through the admin portal.
 *
 * Usage:
 *   SCHOOL_NAME="..." ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." pnpm db:bootstrap
 */
import { hash } from 'argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { DEFAULT_GRADING_SCALE, DEFAULT_SCORE_LIMITS, passwordSchema } from '@sda-shs/shared';
import * as schema from './schema';

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const schoolName = required('SCHOOL_NAME');
    await db
      .insert(schema.schoolProfile)
      .values({
        id: 1,
        name: schoolName,
        gradingScale: { ...DEFAULT_SCORE_LIMITS, bands: DEFAULT_GRADING_SCALE },
      })
      .onConflictDoNothing();

    const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, 'super_admin')).limit(1);
    if (existing.length) {
      console.log('A super administrator already exists; nothing else to do.');
      return;
    }
    const password = passwordSchema.parse(required('ADMIN_PASSWORD'));
    await db.insert(schema.users).values({
      fullName: required('ADMIN_NAME'),
      email: required('ADMIN_EMAIL').toLowerCase(),
      passwordHash: await hash(password),
      role: 'super_admin',
      mustChangePassword: true,
    });
    console.log('Super administrator created. Sign in and change the password immediately.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
