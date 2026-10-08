/**
 * One-time setup for a fresh installation:
 *   - creates the school profile with the school's official details
 *   - creates the first Super Administrator account
 *
 * It deliberately creates no students, staff, classes or other sample data:
 * the school enters its real records through the admin portal.
 *
 * Usage:
 *   ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." pnpm db:bootstrap
 * (SCHOOL_NAME, SCHOOL_MOTTO and SCHOOL_ADDRESS override the defaults below.)
 */
import { hash } from 'argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { DEFAULT_GRADING_SCALE, DEFAULT_SCORE_LIMITS, passwordSchema } from '@sda-shs/shared';
import * as schema from './schema';

/** As shown on the school crest and supplied by the school. */
const SCHOOL = {
  name: 'S.D.A Senior High School, Asokore-Koforidua',
  shortName: 'SDA SHS',
  motto: 'Knowledge for Excellence',
  address: 'P. O. Box 18, Asokore - Koforidua',
};

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 });
  const db = drizzle(pool, { schema });
  try {
    await db
      .insert(schema.schoolProfile)
      .values({
        id: 1,
        name: process.env.SCHOOL_NAME?.trim() || SCHOOL.name,
        shortName: SCHOOL.shortName,
        motto: process.env.SCHOOL_MOTTO?.trim() || SCHOOL.motto,
        address: process.env.SCHOOL_ADDRESS?.trim() || SCHOOL.address,
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
