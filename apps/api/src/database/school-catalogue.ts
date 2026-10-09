/**
 * The school's own academic catalogue, from "Expanded 2026/2027 Subject
 * Combination for the Six (6) Learning Areas — September 2026 Edition" and the
 * list of houses. Loading it is idempotent: existing rows (including any the
 * school has since edited in the admin portal) are left untouched.
 *
 * Subject codes are internal identifiers chosen for the system; the names are
 * as printed on the combination list.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { className } from '@sda-shs/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;

export const CORE_SUBJECTS: [code: string, name: string][] = [
  ['ENG', 'English Language'],
  ['GMATH', 'General Mathematics'],
  ['GSCI', 'General Science'],
  ['SOC', 'Social Studies'],
  ['PEH', 'Physical Education & Health'],
];

export const ELECTIVE_SUBJECTS: [code: string, name: string][] = [
  ['PHY', 'Physics'],
  ['CHEM', 'Chemistry'],
  ['BIO', 'Biology'],
  ['AMATH', 'Additional Mathematics'],
  ['GEOG', 'Geography'],
  ['ECON', 'Economics'],
  ['COMP', 'Computing'],
  ['BMGT', 'Business Management'],
  ['ACCT', 'Accounting'],
  ['ICT', 'ICT'],
  ['FREN', 'French'],
  ['ADF', 'Art & Design Foundation'],
  ['ADS', 'Art & Design Studio'],
  ['MIL', 'Management in Living'],
  ['FN', 'Foods & Nutrition'],
  ['CT', 'Clothing & Textiles'],
  ['PEHE', 'Physical Education & Health (Elective)'],
  ['TWI', 'Ghanaian Language (Akuapem Twi)'],
  ['LIT', 'Literature in English'],
  ['PA', 'Performing Arts'],
  ['MUS', 'Music'],
  ['RS', 'Religious Studies'],
  ['HIST', 'History'],
  ['GOVT', 'Government'],
];

interface ProgrammeDef {
  name: string;
  code: string;
  label: string;
  spacedName?: boolean;
  /** Classes per form (SHS 1–3): Arts 1–4, Bus 1–2, H/Econs 1–3, Lang 1–2, Science 1, Visual 1–2. */
  classesPerForm: number;
  /** Core subjects this learning area does not offer. */
  excludeCore?: string[];
  /** [option, stream, letter, elective codes, must drop one before SHS 3] */
  options: [number, number, string, string[], boolean?][];
}

export const PROGRAMMES: ProgrammeDef[] = [
  {
    name: 'General Science',
    classesPerForm: 1,
    code: 'G/S',
    label: 'Science',
    // "Science Students will not offer General Science as a Core Subject."
    excludeCore: ['GSCI'],
    options: [
      [1, 1, 'A', ['PHY', 'CHEM', 'BIO', 'AMATH', 'GEOG', 'ECON']],
      [2, 1, 'B', ['PHY', 'CHEM', 'BIO', 'AMATH', 'COMP', 'BMGT']],
      [3, 1, 'C', ['PHY', 'CHEM', 'BIO', 'AMATH', 'COMP', 'ECON']],
      [4, 1, 'D', ['PHY', 'CHEM', 'BIO', 'AMATH', 'COMP', 'FREN']],
      [5, 1, 'E', ['PHY', 'CHEM', 'BIO', 'AMATH', 'GEOG', 'BMGT']],
      [6, 1, 'F', ['PHY', 'CHEM', 'BIO', 'AMATH', 'GEOG', 'FREN']],
      [7, 1, 'G', ['PHY', 'CHEM', 'BIO', 'AMATH', 'GEOG', 'COMP'], true],
    ],
  },
  {
    name: 'General Arts',
    classesPerForm: 4,
    code: 'G/A',
    label: 'Arts',
    options: [
      [1, 1, 'A', ['GOVT', 'HIST', 'LIT', 'PA', 'TWI']],
      [2, 1, 'B', ['GOVT', 'HIST', 'LIT', 'PA', 'FREN']],
      [3, 2, 'A', ['GEOG', 'ECON', 'RS', 'BMGT', 'ICT']],
      [4, 2, 'B', ['GOVT', 'HIST', 'ECON', 'PEHE', 'ACCT']],
      [5, 3, 'A', ['ECON', 'RS', 'ADF', 'MUS', 'PEHE']],
      [6, 3, 'B', ['GOVT', 'HIST', 'ECON', 'ADF', 'ICT']],
      [7, 4, '', ['GOVT', 'ECON', 'GEOG', 'AMATH', 'COMP']],
    ],
  },
  {
    name: 'Visual Arts',
    classesPerForm: 2,
    code: 'VIS',
    label: 'Visual',
    options: [
      [1, 1, 'A', ['ADF', 'ADS', 'BMGT', 'AMATH', 'FREN']],
      [2, 1, 'B', ['ADF', 'ADS', 'BMGT', 'ICT', 'PEHE']],
      [3, 1, 'C', ['ADF', 'ADS', 'BMGT', 'AMATH', 'COMP']],
      [5, 2, 'A', ['ADF', 'ADS', 'ACCT', 'ICT', 'PEHE']],
      [6, 2, 'B', ['ADF', 'ADS', 'ECON', 'ICT', 'PEHE']],
    ],
  },
  {
    name: 'Business',
    classesPerForm: 2,
    code: 'BUS',
    label: 'Bus',
    options: [
      [1, 1, 'A', ['BMGT', 'ACCT', 'ECON', 'ICT', 'ADS']],
      [2, 1, 'B', ['BMGT', 'ACCT', 'ECON', 'ICT', 'FREN']],
      [3, 2, 'A', ['BMGT', 'ACCT', 'ECON', 'AMATH', 'COMP']],
      [4, 2, 'B', ['BMGT', 'ACCT', 'ECON', 'AMATH', 'FREN']],
      [5, 2, 'C', ['BMGT', 'ACCT', 'ECON', 'AMATH', 'ADF']],
    ],
  },
  {
    name: 'Home Economics',
    classesPerForm: 3,
    code: 'H/E',
    label: 'H/Econs',
    options: [
      [1, 1, 'A', ['MIL', 'FN', 'BIO', 'ADF', 'ECON']],
      [2, 1, 'B', ['MIL', 'FN', 'BIO', 'ADF', 'ICT']],
      [3, 2, 'A', ['MIL', 'CT', 'BIO', 'ADF', 'ICT']],
      [4, 2, 'B', ['MIL', 'CT', 'CHEM', 'FREN', 'ECON']],
      [5, 2, 'C', ['MIL', 'CT', 'CHEM', 'ADF', 'ICT']],
      [6, 2, 'D', ['MIL', 'CT', 'CHEM', 'ADF', 'FREN']],
      [7, 2, 'E', ['MIL', 'CT', 'CHEM', 'ADF', 'ECON']],
      [8, 3, 'A', ['MIL', 'FN', 'CHEM', 'FREN', 'PEHE']],
      [9, 3, 'B', ['MIL', 'FN', 'BIO', 'CHEM', 'AMATH', 'ICT'], true],
      [10, 3, 'C', ['MIL', 'CT', 'BIO', 'CHEM', 'AMATH', 'ICT'], true],
    ],
  },
  {
    name: 'Languages',
    classesPerForm: 2,
    // The school writes these "1 LANG 1A", "1 LANG 2A".
    code: 'LANG',
    spacedName: true,
    label: 'Lang',
    options: [
      [1, 1, 'A', ['TWI', 'LIT', 'FREN', 'ICT', 'PA']],
      [2, 1, 'B', ['TWI', 'LIT', 'FREN', 'MUS', 'ICT']],
      [3, 2, 'A', ['TWI', 'LIT', 'RS', 'ICT', 'PA']],
      [4, 2, 'B', ['TWI', 'LIT', 'HIST', 'PEHE', 'PA']],
    ],
  },
];

/** The school's four houses and their colours. */
export const HOUSE_COLOURS: Record<string, string> = {
  'Gye Nyame': '#1e8e3e', // green
  Asokore: '#c8102e', // red
  'Agyei Sarfo': '#1f5fbf', // blue
  'Kuma Korante': '#f2c200', // yellow
};
export const HOUSES = Object.keys(HOUSE_COLOURS);

export async function loadSchoolCatalogue(db: Db) {
  await db
    .insert(schema.subjects)
    .values([
      ...CORE_SUBJECTS.map(([code, name]) => ({ code, name, isCore: true })),
      ...ELECTIVE_SUBJECTS.map(([code, name]) => ({ code, name, isCore: false })),
    ])
    .onConflictDoNothing();
  const subjectRows = await db.select({ id: schema.subjects.id, code: schema.subjects.code }).from(schema.subjects);
  const subjectId = new Map(subjectRows.map((s) => [s.code, s.id]));
  const need = (code: string) => {
    const id = subjectId.get(code);
    if (!id) throw new Error(`Subject ${code} is missing`);
    return id;
  };

  for (const p of PROGRAMMES) {
    await db.insert(schema.programmes).values({ name: p.name, code: p.code, label: p.label, spacedName: p.spacedName ?? false }).onConflictDoNothing();
    const [programme] = await db.select().from(schema.programmes).where(eq(schema.programmes.name, p.name));
    if (!programme) continue;

    if (p.excludeCore?.length) {
      await db
        .insert(schema.programmeCoreExclusions)
        .values(p.excludeCore.map((code) => ({ programmeId: programme.id, subjectId: need(code) })))
        .onConflictDoNothing();
    }

    for (const [option, stream, letter, electives, mustDropOne = false] of p.options) {
      const inserted = await db
        .insert(schema.subjectCombinations)
        .values({ programmeId: programme.id, option, stream, letter, mustDropOne })
        .onConflictDoNothing()
        .returning({ id: schema.subjectCombinations.id });
      // Only fill subjects for combinations created now; never overwrite the school's edits.
      if (inserted.length) {
        await db.insert(schema.combinationSubjects).values(electives.map((code) => ({ combinationId: inserted[0].id, subjectId: need(code) })));
      }
    }
  }

  await createClasses(db);

  await db
    .insert(schema.houses)
    .values(HOUSES.map((name) => ({ name, colour: HOUSE_COLOURS[name] })))
    .onConflictDoNothing();
  // Houses created before colours were known get theirs; colours changed in the portal are kept.
  for (const name of HOUSES) {
    await db.update(schema.houses).set({ colour: HOUSE_COLOURS[name] }).where(and(eq(schema.houses.name, name), isNull(schema.houses.colour)));
  }

  const counts = {
    subjects: subjectRows.length,
    programmes: (await db.select({ id: schema.programmes.id }).from(schema.programmes).where(inArray(schema.programmes.name, PROGRAMMES.map((p) => p.name)))).length,
    classes: (await db.select({ id: schema.classes.id }).from(schema.classes)).length,
    houses: (await db.select({ id: schema.houses.id }).from(schema.houses).where(inArray(schema.houses.name, HOUSES))).length,
  };
  return counts;
}

/**
 * Every learning area's classes for SHS 1–3, each given the core subjects its
 * learning area offers and the electives of its options. Existing classes
 * and subject assignments (with their teachers) are kept.
 */
async function createClasses(db: Db) {
  const coreRows = await db.select({ id: schema.subjects.id }).from(schema.subjects).where(eq(schema.subjects.isCore, true));
  for (const p of PROGRAMMES) {
    const [programme] = await db.select().from(schema.programmes).where(eq(schema.programmes.name, p.name));
    if (!programme?.code) continue;
    const excluded = new Set(
      (
        await db
          .select({ id: schema.programmeCoreExclusions.subjectId })
          .from(schema.programmeCoreExclusions)
          .where(eq(schema.programmeCoreExclusions.programmeId, programme.id))
      ).map((r) => r.id),
    );
    const core = coreRows.map((r) => r.id).filter((id) => !excluded.has(id));

    for (const form of [1, 2, 3]) {
      for (let stream = 1; stream <= p.classesPerForm; stream++) {
        const name = className(form, programme.code, stream, programme.spacedName);
        await db.insert(schema.classes).values({ name, form, stream, programmeId: programme.id }).onConflictDoNothing();
        const [cls] = await db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.name, name));
        const electives = await db
          .selectDistinct({ id: schema.combinationSubjects.subjectId })
          .from(schema.combinationSubjects)
          .innerJoin(schema.subjectCombinations, eq(schema.subjectCombinations.id, schema.combinationSubjects.combinationId))
          .where(and(eq(schema.subjectCombinations.programmeId, programme.id), eq(schema.subjectCombinations.stream, stream)));
        const subjectIds = [...new Set([...core, ...electives.map((e) => e.id)])];
        if (subjectIds.length) {
          await db
            .insert(schema.classSubjects)
            .values(subjectIds.map((subjectId) => ({ classId: cls.id, subjectId })))
            .onConflictDoNothing();
        }
      }
    }
  }
}

if (require.main === module) {
  // Usage: DATABASE_URL=... node dist/database/school-catalogue.js
  void (async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const counts = await loadSchoolCatalogue(drizzle(pool, { schema }));
      console.log(`School catalogue loaded: ${counts.subjects} subjects, ${counts.programmes} learning areas, ${counts.classes} classes, ${counts.houses} houses.`);
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
