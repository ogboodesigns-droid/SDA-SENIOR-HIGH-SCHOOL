import { Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.module';
import {
  classes,
  classSubjects,
  combinationSubjects,
  programmeCoreExclusions,
  programmes,
  students,
  subjectCombinations,
  subjects,
} from '../database/schema';

/**
 * Which subjects a student takes. A student with an option (combination)
 * takes the core subjects their programme offers plus that option's
 * electives. A student without one (e.g. a class whose options haven't been
 * set up) takes every subject assigned to their class.
 */
@Injectable()
export class CurriculumService {
  constructor(@InjectDb() private readonly db: Database) {}

  private async coreSubjectIdsFor(programmeId: string): Promise<string[]> {
    const excluded = this.db
      .select({ id: programmeCoreExclusions.subjectId })
      .from(programmeCoreExclusions)
      .where(eq(programmeCoreExclusions.programmeId, programmeId));
    const rows = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.isCore, true), notInArray(subjects.id, excluded)));
    return rows.map((r) => r.id);
  }

  async subjectIdsForStudent(studentId: string): Promise<string[]> {
    const [s] = await this.db
      .select({ classId: students.classId, combinationId: students.combinationId, programmeId: classes.programmeId })
      .from(students)
      .innerJoin(classes, eq(classes.id, students.classId))
      .where(eq(students.id, studentId));
    if (!s) throw new NotFoundException('Student not found');

    if (!s.combinationId) {
      const rows = await this.db.select({ id: classSubjects.subjectId }).from(classSubjects).where(eq(classSubjects.classId, s.classId));
      return rows.map((r) => r.id);
    }
    const electives = await this.db
      .select({ id: combinationSubjects.subjectId })
      .from(combinationSubjects)
      .where(eq(combinationSubjects.combinationId, s.combinationId));
    return [...new Set([...(await this.coreSubjectIdsFor(s.programmeId)), ...electives.map((e) => e.id)])];
  }

  async takesSubject(studentId: string, subjectId: string): Promise<boolean> {
    return (await this.subjectIdsForStudent(studentId)).includes(subjectId);
  }

  /** Students in a class who take a subject: the mark sheet and assignment audience. */
  async studentIdsTakingSubject(classId: string, subjectId: string): Promise<string[]> {
    const [cls] = await this.db.select({ programmeId: classes.programmeId }).from(classes).where(eq(classes.id, classId));
    if (!cls) return [];
    const [subject] = await this.db.select({ isCore: subjects.isCore }).from(subjects).where(eq(subjects.id, subjectId));
    if (!subject) return [];

    const hasClassSubject =
      (
        await this.db
          .select({ id: classSubjects.id })
          .from(classSubjects)
          .where(and(eq(classSubjects.classId, classId), eq(classSubjects.subjectId, subjectId)))
          .limit(1)
      ).length > 0;
    // Students without an option take whatever is assigned to the class.
    const withoutOption = hasClassSubject ? isNull(students.combinationId) : undefined;

    let withOption;
    if (subject.isCore) {
      // Students with an option take every core subject their programme offers.
      if ((await this.coreSubjectIdsFor(cls.programmeId)).includes(subjectId)) withOption = isNotNull(students.combinationId);
    } else {
      const combos = this.db
        .select({ id: combinationSubjects.combinationId })
        .from(combinationSubjects)
        .where(eq(combinationSubjects.subjectId, subjectId));
      withOption = inArray(students.combinationId, combos);
    }
    const cond = or(withOption, withoutOption);
    if (!cond) return [];
    const rows = await this.db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.classId, classId), cond));
    return rows.map((r) => r.id);
  }

  /**
   * Adds to a class every subject its students take: the programme's core
   * subjects and the electives of the options belonging to the class's stream.
   * Existing assignments (and their teachers) are kept.
   */
  async syncClassSubjects(classId: string): Promise<number> {
    const [cls] = await this.db.select().from(classes).where(eq(classes.id, classId));
    if (!cls) throw new NotFoundException('Class not found');
    const core = await this.coreSubjectIdsFor(cls.programmeId);
    const electives =
      cls.stream === null
        ? []
        : await this.db
            .selectDistinct({ id: combinationSubjects.subjectId })
            .from(combinationSubjects)
            .innerJoin(subjectCombinations, eq(subjectCombinations.id, combinationSubjects.combinationId))
            .where(and(eq(subjectCombinations.programmeId, cls.programmeId), eq(subjectCombinations.stream, cls.stream)));
    const ids = [...new Set([...core, ...electives.map((e) => e.id)])];
    if (!ids.length) return 0;
    const added = await this.db
      .insert(classSubjects)
      .values(ids.map((subjectId) => ({ classId, subjectId })))
      .onConflictDoNothing()
      .returning({ id: classSubjects.id });
    return added.length;
  }

  /**
   * Whether two subjects may share a period in a class ("split" periods such
   * as GEOGRAPHY / COMPUTING). Core subjects never share; two electives may,
   * and the options whose students take both are returned so the timetable
   * can warn about them.
   */
  async splitCheck(classId: string, subjectA: string, subjectB: string): Promise<{ allowed: boolean; clashingOptions: string[] }> {
    if (subjectA === subjectB) return { allowed: false, clashingOptions: [] };
    const [cls] = await this.db
      .select({ c: classes, code: programmes.code })
      .from(classes)
      .innerJoin(programmes, eq(programmes.id, classes.programmeId))
      .where(eq(classes.id, classId));
    if (!cls) return { allowed: false, clashingOptions: [] };
    const core = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(inArray(subjects.id, [subjectA, subjectB]), eq(subjects.isCore, true)));
    if (core.length) return { allowed: false, clashingOptions: [] };
    if (cls.c.stream === null) return { allowed: true, clashingOptions: [] };

    const rows = await this.db
      .select({ id: subjectCombinations.id, option: subjectCombinations.option, letter: subjectCombinations.letter, subjectId: combinationSubjects.subjectId })
      .from(subjectCombinations)
      .innerJoin(combinationSubjects, eq(combinationSubjects.combinationId, subjectCombinations.id))
      .where(
        and(
          eq(subjectCombinations.programmeId, cls.c.programmeId),
          eq(subjectCombinations.stream, cls.c.stream),
          inArray(combinationSubjects.subjectId, [subjectA, subjectB]),
        ),
      );
    const perOption = new Map<string, { label: string; n: number }>();
    for (const r of [...rows].sort((a, b) => a.option - b.option)) {
      const cur = perOption.get(r.id) ?? { label: `Option ${r.option} (${cls.c.name}${r.letter})`, n: 0 };
      cur.n += 1;
      perOption.set(r.id, cur);
    }
    return { allowed: true, clashingOptions: [...perOption.values()].filter((o) => o.n === 2).map((o) => o.label) };
  }

  /** Options a student in this class can be placed in (same programme and stream). */
  async combinationFitsClass(combinationId: string, classId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: subjectCombinations.id })
      .from(subjectCombinations)
      .innerJoin(classes, and(eq(classes.programmeId, subjectCombinations.programmeId), eq(classes.id, classId)))
      .where(and(eq(subjectCombinations.id, combinationId), or(isNull(classes.stream), eq(classes.stream, subjectCombinations.stream))));
    return !!row;
  }
}

@Global()
@Module({ providers: [CurriculumService], exports: [CurriculumService] })
export class CurriculumModule {}
