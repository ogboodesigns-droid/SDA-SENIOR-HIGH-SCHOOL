import { eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { classes, programmes, subjectCombinations } from '../database/schema';

export interface GroupTarget {
  classId: string;
  className: string;
  form: number;
  programmeId: string;
  programmeName: string;
  combinationId: string | null;
  /** As written on the combination list: class + option letter, e.g. "1BUS 2A". */
  groupName: string;
}

/** Upper-case with spaces removed: "1 lang 1a" → "1LANG1A". */
export const groupKey = (s: string) => s.toUpperCase().replace(/\s+/g, '');

/**
 * Every code a class (and option group) can be written as on a spreadsheet:
 * "1BUS 1A", "1G/A 4", the class alone ("1BUS 1") when it has no options,
 * and for Languages both "1 LANG 1A" and the combination list's "1L1 1A".
 */
export async function loadGroups(db: Database): Promise<{ byCode: Map<string, GroupTarget>; byClass: Map<string, GroupTarget> }> {
  const rows = await db
    .select({ c: classes, programmeName: programmes.name, programmeCode: programmes.code })
    .from(classes)
    .innerJoin(programmes, eq(programmes.id, classes.programmeId));
  const options = await db.select().from(subjectCombinations);
  const byCode = new Map<string, GroupTarget>();
  const byClass = new Map<string, GroupTarget>();

  for (const { c, programmeName, programmeCode } of rows) {
    const base = { classId: c.id, className: c.name, form: c.form, programmeId: c.programmeId, programmeName };
    const classTarget: GroupTarget = { ...base, combinationId: null, groupName: c.name };
    byClass.set(groupKey(c.name), classTarget);
    const mine = options.filter((o) => o.programmeId === c.programmeId && c.stream !== null && o.stream === c.stream);
    if (!mine.length) {
      byCode.set(groupKey(c.name), classTarget);
      continue;
    }
    for (const o of mine) {
      const target: GroupTarget = { ...base, combinationId: o.id, groupName: `${c.name}${o.letter}` };
      byCode.set(groupKey(target.groupName), target);
      if (programmeCode === 'LANG') byCode.set(groupKey(`${c.form}L${c.stream} ${c.stream}${o.letter}`), target);
    }
  }
  return { byCode, byClass };
}

/** Programme names as people write them on forms. */
const PROGRAMME_ALIASES: Record<string, string> = {
  science: 'general science',
  'visual art': 'visual arts',
  'gen arts': 'general arts',
  arts: 'general arts',
  'home econs': 'home economics',
  'h/econs': 'home economics',
  language: 'languages',
  lang: 'languages',
};

export function programmeMatches(written: string, programmeName: string): boolean {
  const w = written.trim().toLowerCase();
  const p = programmeName.toLowerCase();
  return w === p || PROGRAMME_ALIASES[w] === p;
}
