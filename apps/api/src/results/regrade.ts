import { isNull, sql, type SQL } from 'drizzle-orm';
import type { GradeBand } from '@sda-shs/shared';
import type { Database } from '../database/database.module';
import { results } from '../database/schema';

/**
 * Re-applies a grading scale to stored results (grade, grade point and
 * remark follow from the total). Published results keep their grades unless
 * `includePublished` is set, so what students and parents were shown stays fixed.
 */
export async function regradeResults(db: Pick<Database, 'update'>, bands: GradeBand[], opts: { includePublished?: boolean } = {}): Promise<number> {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const pick = (field: (b: GradeBand) => string | number): SQL => {
    const cases = sorted.map((b) => sql`when ${results.total} >= ${b.min} then ${field(b)}`);
    return sql`(case ${sql.join(cases, sql` `)} end)`;
  };
  const updated = await db
    .update(results)
    .set({
      grade: pick((b) => b.grade),
      gradePoint: sql`${pick((b) => b.points)}::smallint`,
      remark: pick((b) => b.remark),
    })
    .where(opts.includePublished ? undefined : isNull(results.publishedAt))
    .returning({ id: results.id });
  return updated.length;
}
