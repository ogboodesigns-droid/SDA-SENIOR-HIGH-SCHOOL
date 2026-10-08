import { sql } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { students } from '../database/schema';

/**
 * Admission numbers follow the school's format SDA/YY/NNNN: SDA, the
 * two-digit year of admission, and a four-digit serial within that year,
 * e.g. SDA/25/0101.
 */
export const ADMISSION_NO = /^SDA\/(\d{2})\/(\d{4})$/;

export function normaliseAdmissionNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '').replace(/\\/g, '/');
}

export function formatAdmissionNo(year: number, serial: number): string {
  return `SDA/${String(year % 100).padStart(2, '0')}/${String(serial).padStart(4, '0')}`;
}

/** Highest serial already used for each two-digit admission year. */
export async function highestSerials(db: Pick<Database, 'select'>): Promise<Map<string, number>> {
  const rows = await db
    .select({
      yy: sql<string>`substring(${students.studentNumber} from 5 for 2)`,
      max: sql<number>`max(substring(${students.studentNumber} from 8 for 4)::int)`,
    })
    .from(students)
    .where(sql`${students.studentNumber} ~ '^SDA/[0-9]{2}/[0-9]{4}$'`)
    .groupBy(sql`substring(${students.studentNumber} from 5 for 2)`);
  return new Map(rows.map((r) => [r.yy, Number(r.max)]));
}

/** Hands out the next free serials per admission year, continuing after the highest one in use. */
export class AdmissionNumberer {
  constructor(private readonly highest: Map<string, number>) {}

  /** Records a number supplied in the file so generated ones continue after it. */
  claim(admissionNo: string) {
    const m = ADMISSION_NO.exec(admissionNo);
    if (!m) return;
    this.highest.set(m[1], Math.max(this.highest.get(m[1]) ?? 0, Number(m[2])));
  }

  next(admissionYear: number): string {
    const yy = String(admissionYear % 100).padStart(2, '0');
    const serial = (this.highest.get(yy) ?? 0) + 1;
    if (serial > 9999) throw new Error(`No admission numbers left for 20${yy}`);
    this.highest.set(yy, serial);
    return formatAdmissionNo(admissionYear, serial);
  }
}
