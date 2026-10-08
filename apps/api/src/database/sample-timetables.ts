/**
 * The school's provisional 2026/2027 master timetables for SHS 1 Science
 * ("1SC" = 1G/S 1) and SHS 1 Home Economics Two ("1HE2" = 1H/E 2).
 *
 * Loads the lessons into the current semester for classes that have no
 * timetable yet. Teachers are not created: the names printed on the
 * timetables are listed in TEACHERS so the school can create their accounts
 * and assign them to the class subjects in the admin portal.
 *
 *   DATABASE_URL=... node dist/database/sample-timetables.js
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DEFAULT_BELL_SCHEDULE } from '@sda-shs/shared';
import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;

/** Monday … Friday, periods P1 … P8. "A/B" is a split period; null is a free, activity or closed slot. */
type Week = (string | null)[][];

export const SAMPLE_TIMETABLES: Record<string, Week> = {
  '1G/S 1': [
    ['GMATH', 'GMATH', 'PHY', 'PHY', 'SOC', 'SOC', 'GEOG/COMP', 'GEOG/COMP'],
    ['ENG', 'ENG', 'CHEM', 'CHEM', 'GMATH', 'AMATH', 'GEOG/COMP', 'GEOG/COMP'],
    ['GMATH', 'AMATH', 'BIO', 'BIO', 'PHY', 'PHY', 'ECON/BMGT/FREN', 'ECON/BMGT/FREN'],
    ['ENG', 'ENG', 'AMATH', 'AMATH', 'CHEM', 'CHEM', 'ECON/BMGT/FREN', 'ECON/BMGT/FREN'],
    ['SOC', 'SOC', null, null, 'BIO', 'BIO', 'PEH', null],
  ],
  '1H/E 2': [
    ['ENG', 'ENG', 'CT', 'CT', 'ICT/ECON', 'PEH', 'BIO/CHEM', 'BIO/CHEM'],
    ['CT', 'CT', 'SOC', 'SOC', 'GMATH', 'GMATH', 'BIO/CHEM', 'BIO/CHEM'],
    ['ENG', 'ENG', 'GSCI', 'GSCI', 'ICT/ECON', 'ICT/ECON', 'ADF/FREN', 'ADF/FREN'],
    ['GMATH', 'GMATH', 'MIL', 'MIL', 'GSCI', 'GSCI', 'ADF/FREN', 'ADF/FREN'],
    ['SOC', 'SOC', null, null, 'MIL', 'MIL', 'ICT/ECON', null],
  ],
};

/** Teachers as printed on the provisional timetables, by subject code. */
export const TEACHERS: Record<string, Record<string, string>> = {
  '1G/S 1': {
    GMATH: 'Kyei Bodison',
    ENG: 'Agbana Michael',
    SOC: 'Frimpong Solomon',
    AMATH: 'Alex Acheampong',
    PHY: 'Elizabeth Ekpe',
    CHEM: 'Seth Adjei Kwabi',
    BIO: 'Nimatu Soale',
    GEOG: 'Joshua Baffour',
    COMP: 'Henry Affum',
    ECON: 'Francis',
    BMGT: 'Barbara',
    FREN: 'Dodjivi',
    PEH: 'Kenneth Anyetei-Wireko',
  },
  '1H/E 2': {
    ENG: 'Agbana Michael',
    CT: 'David Ansah',
    SOC: 'Eugenia Yeboah',
    GSCI: 'Theophilus Asante',
    MIL: 'Millicent Ameyaw',
    GMATH: 'Esther Konadu',
    ICT: 'New teacher',
    ECON: 'Agyemang',
    PEH: 'Kenneth Anyetei',
    BIO: 'Nimatu',
    CHEM: 'Seth',
    ADF: 'Afari M.',
    FREN: 'Dodjivi',
  },
};

export async function loadSampleTimetables(db: Db, termId?: string) {
  const [term] = termId
    ? await db.select().from(schema.terms).where(eq(schema.terms.id, termId))
    : await db.select().from(schema.terms).where(eq(schema.terms.isCurrent, true));
  if (!term) throw new Error('Create the current semester first (Classes & subjects → Academic years & semesters).');

  const lessons = DEFAULT_BELL_SCHEDULE.periods.filter((p) => p.kind === 'lesson');
  const subjects = new Map((await db.select({ id: schema.subjects.id, code: schema.subjects.code }).from(schema.subjects)).map((s) => [s.code, s.id]));
  const report: Record<string, string> = {};

  for (const [name, week] of Object.entries(SAMPLE_TIMETABLES)) {
    const [cls] = await db.select().from(schema.classes).where(eq(schema.classes.name, name));
    if (!cls) {
      report[name] = 'class not found';
      continue;
    }
    const existing = await db
      .select({ id: schema.timetableEntries.id })
      .from(schema.timetableEntries)
      .where(and(eq(schema.timetableEntries.classId, cls.id), eq(schema.timetableEntries.termId, term.id)))
      .limit(1);
    if (existing.length) {
      report[name] = 'already has a timetable for this semester; left unchanged';
      continue;
    }

    const codes = [...new Set(week.flat().filter((c): c is string => !!c).flatMap((c) => c.split('/')))];
    const ids = codes.map((c) => {
      const id = subjects.get(c);
      if (!id) throw new Error(`Subject ${c} is missing; load the school catalogue first`);
      return id;
    });
    // Make sure every subject on the timetable is on the class.
    await db
      .insert(schema.classSubjects)
      .values(ids.map((subjectId) => ({ classId: cls.id, subjectId })))
      .onConflictDoNothing();

    const rows = week.flatMap((day, d) =>
      day.flatMap((cell, p) =>
        cell
          ? cell.split('/').map((code) => ({
              termId: term.id,
              classId: cls.id,
              subjectId: subjects.get(code)!,
              dayOfWeek: d + 1,
              startsAt: lessons[p].startsAt,
              endsAt: lessons[p].endsAt,
            }))
          : [],
      ),
    );
    await db.insert(schema.timetableEntries).values(rows);
    report[name] = `${rows.length} lessons added`;
  }
  return report;
}

/** Subject codes on a class's timetable that have no teacher assigned yet, with the name printed on the timetable. */
export async function unassignedTeachers(db: Db) {
  const out: string[] = [];
  for (const [name, bySubject] of Object.entries(TEACHERS)) {
    const [cls] = await db.select().from(schema.classes).where(eq(schema.classes.name, name));
    if (!cls) continue;
    const rows = await db
      .select({ code: schema.subjects.code, teacherId: schema.classSubjects.teacherId })
      .from(schema.classSubjects)
      .innerJoin(schema.subjects, eq(schema.subjects.id, schema.classSubjects.subjectId))
      .where(and(eq(schema.classSubjects.classId, cls.id), inArray(schema.subjects.code, Object.keys(bySubject))));
    for (const r of rows) if (!r.teacherId) out.push(`${name} ${r.code}: ${bySubject[r.code]}`);
  }
  return out;
}

if (require.main === module) {
  void (async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const db = drizzle(pool, { schema });
      for (const [cls, result] of Object.entries(await loadSampleTimetables(db))) console.log(`${cls}: ${result}`);
      const todo = await unassignedTeachers(db);
      if (todo.length) console.log(`\nAssign these teachers in the admin portal (Classes & subjects):\n  ${todo.join('\n  ')}`);
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
