import { Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or } from 'drizzle-orm';
import type { PendingSubjectChoice, SubjectChoice, SubjectRef } from '@sda-shs/shared';
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
  terms,
  timetableEntries,
  users,
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

  /** The subjects a student takes: their option's subjects without the one they dropped. */
  async subjectIdsForStudent(studentId: string): Promise<string[]> {
    const { subjectIds, droppedSubjectId } = await this.optionSubjects(studentId);
    return subjectIds.filter((id) => id !== droppedSubjectId);
  }

  /** Everything the student's option (or class, without an option) offers, before any dropped subject. */
  private async optionSubjects(studentId: string) {
    const [s] = await this.db
      .select({
        classId: students.classId,
        combinationId: students.combinationId,
        droppedSubjectId: students.droppedSubjectId,
        programmeId: classes.programmeId,
      })
      .from(students)
      .innerJoin(classes, eq(classes.id, students.classId))
      .where(eq(students.id, studentId));
    if (!s) throw new NotFoundException('Student not found');

    if (!s.combinationId) {
      const rows = await this.db.select({ id: classSubjects.subjectId }).from(classSubjects).where(eq(classSubjects.classId, s.classId));
      return { ...s, subjectIds: rows.map((r) => r.id), electiveIds: [] as string[] };
    }
    const electives = await this.db
      .select({ id: combinationSubjects.subjectId })
      .from(combinationSubjects)
      .where(eq(combinationSubjects.combinationId, s.combinationId));
    const electiveIds = electives.map((e) => e.id);
    return { ...s, subjectIds: [...new Set([...(await this.coreSubjectIdsFor(s.programmeId)), ...electiveIds])], electiveIds };
  }

  /**
   * Whether a student must choose which subject to drop, and between which.
   * Required when the class timetable runs two of the student's electives at
   * the same time (e.g. Geography / Computing for Science Option 7), or in
   * SHS 3 on an option marked "must drop one before SHS 3".
   */
  async subjectChoice(studentId: string, termId?: string): Promise<SubjectChoice> {
    const o = await this.optionSubjects(studentId);
    const [meta] = await this.db
      .select({ form: classes.form, mustDropOne: subjectCombinations.mustDropOne })
      .from(students)
      .innerJoin(classes, eq(classes.id, students.classId))
      .leftJoin(subjectCombinations, eq(subjectCombinations.id, students.combinationId))
      .where(eq(students.id, studentId));
    const names = new Map(
      o.electiveIds.length
        ? (await this.db.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, o.electiveIds))).map((r) => [r.id, r.name])
        : [],
    );

    // Pairs of the student's own electives that the timetable puts in the same period.
    const pairs: [string, string][] = [];
    const term = termId ?? (await this.db.select({ id: terms.id }).from(terms).where(eq(terms.isCurrent, true)))[0]?.id;
    if (term && o.electiveIds.length > 1) {
      const lessons = await this.db
        .select({ subjectId: timetableEntries.subjectId, day: timetableEntries.dayOfWeek, startsAt: timetableEntries.startsAt, endsAt: timetableEntries.endsAt })
        .from(timetableEntries)
        .where(and(eq(timetableEntries.termId, term), eq(timetableEntries.classId, o.classId), inArray(timetableEntries.subjectId, o.electiveIds)));
      const seen = new Set<string>();
      for (const a of lessons) {
        for (const b of lessons) {
          if (a.subjectId >= b.subjectId || a.day !== b.day || !(a.startsAt < b.endsAt && b.startsAt < a.endsAt)) continue;
          const key = `${a.subjectId}|${b.subjectId}`;
          if (!seen.has(key)) {
            seen.add(key);
            pairs.push([a.subjectId, b.subjectId]);
          }
        }
      }
    }

    const dropped = o.droppedSubjectId;
    const unresolved = pairs.filter(([a, b]) => dropped !== a && dropped !== b);
    let reason: SubjectChoice['reason'] = null;
    let choices: string[] = [];
    if (unresolved.length) {
      reason = 'timetable_clash';
      choices = [...new Set(unresolved.flat())];
    } else if (meta?.mustDropOne && meta.form === 3 && !dropped) {
      reason = 'drop_before_shs3';
      choices = o.electiveIds;
    }
    // What may be dropped: when the timetable clashes, only a subject that resolves it;
    // otherwise, on a * option, any of its electives.
    const allowed = pairs.length ? [...new Set(pairs.flat())] : meta?.mustDropOne ? o.electiveIds : [];
    const toItem = (id: string) => ({ id, name: names.get(id) ?? '' });
    return {
      required: reason !== null,
      reason,
      choices: choices.map(toItem),
      clashes: pairs.map(([a, b]) => [toItem(a), toItem(b)] as [SubjectRef, SubjectRef]),
      allowed: allowed.map(toItem).sort((a, b) => a.name.localeCompare(b.name)),
      droppedSubjectId: dropped,
    };
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
      // Students who dropped this subject don't take it.
      .where(and(eq(students.classId, classId), cond, or(isNull(students.droppedSubjectId), ne(students.droppedSubjectId, subjectId))));
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

  /**
   * Students whose dropped subject still has to be recorded. Only classes
   * whose timetable runs two electives together, and SHS 3 students on a *
   * option, can be affected, so only those students are checked.
   */
  async pendingChoices(termId?: string): Promise<PendingSubjectChoice[]> {
    const term = termId ?? (await this.db.select({ id: terms.id }).from(terms).where(eq(terms.isCurrent, true)))[0]?.id;
    const classIds = new Set<string>();
    if (term) {
      const lessons = await this.db
        .select({ classId: timetableEntries.classId, subjectId: timetableEntries.subjectId, day: timetableEntries.dayOfWeek, startsAt: timetableEntries.startsAt, endsAt: timetableEntries.endsAt })
        .from(timetableEntries)
        .where(eq(timetableEntries.termId, term));
      const byClassDay = new Map<string, typeof lessons>();
      for (const l of lessons) {
        const key = `${l.classId}|${l.day}`;
        byClassDay.set(key, [...(byClassDay.get(key) ?? []), l]);
      }
      for (const ls of byClassDay.values()) {
        if (ls.some((a) => ls.some((b) => a.subjectId !== b.subjectId && a.startsAt < b.endsAt && b.startsAt < a.endsAt))) classIds.add(ls[0].classId);
      }
    }
    const candidates = await this.db
      .select({ id: students.id, classId: students.classId, form: classes.form, mustDropOne: subjectCombinations.mustDropOne })
      .from(students)
      .innerJoin(classes, eq(classes.id, students.classId))
      .innerJoin(subjectCombinations, eq(subjectCombinations.id, students.combinationId));
    const toCheck = candidates.filter((c) => classIds.has(c.classId) || (c.mustDropOne && c.form === 3));

    const pending: { studentId: string; choice: SubjectChoice }[] = [];
    for (const c of toCheck) {
      const choice = await this.subjectChoice(c.id, term);
      if (choice.required) pending.push({ studentId: c.id, choice });
    }
    if (!pending.length) return [];
    const info = await this.db
      .select({
        id: students.id,
        userId: students.userId,
        studentNumber: students.studentNumber,
        className: classes.name,
        letter: subjectCombinations.letter,
        fullName: users.fullName,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .innerJoin(classes, eq(classes.id, students.classId))
      .leftJoin(subjectCombinations, eq(subjectCombinations.id, students.combinationId))
      .where(inArray(students.id, pending.map((p) => p.studentId)));
    const byId = new Map(info.map((i) => [i.id, i]));
    return pending
      .map(({ studentId, choice }) => {
        const i = byId.get(studentId)!;
        return {
          studentId,
          userId: i.userId,
          fullName: i.fullName,
          studentNumber: i.studentNumber,
          groupName: `${i.className}${i.letter ?? ''}`,
          reason: choice.reason!,
          choices: choice.choices,
        };
      })
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.fullName.localeCompare(b.fullName));
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
