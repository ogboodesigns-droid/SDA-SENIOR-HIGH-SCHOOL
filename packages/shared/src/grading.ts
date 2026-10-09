export interface GradeBand {
  /** Inclusive lower bound of the total score (0–100). */
  min: number;
  grade: string;
  /** WAEC numeric value: 1 (A1) … 9 (F9). Lower is better; used for aggregates. */
  points: number;
  /** Grade points on the transcript's 4.0 scale (A1 4.0 … F9 0.0). */
  gpa: number;
  remark: string;
}

/** The school's official scale, as on its semester score sheet, with the transcript's GPA points. */
export const DEFAULT_GRADING_SCALE: GradeBand[] = [
  { min: 80, grade: 'A1', points: 1, gpa: 4.0, remark: 'Excellent' },
  { min: 70, grade: 'B2', points: 2, gpa: 3.5, remark: 'Very Good' },
  { min: 65, grade: 'B3', points: 3, gpa: 3.0, remark: 'Good' },
  { min: 60, grade: 'C4', points: 4, gpa: 2.5, remark: 'Credit' },
  { min: 55, grade: 'C5', points: 5, gpa: 2.0, remark: 'Credit' },
  { min: 50, grade: 'C6', points: 6, gpa: 1.5, remark: 'Credit' },
  { min: 45, grade: 'D7', points: 7, gpa: 1.0, remark: 'Pass' },
  { min: 40, grade: 'E8', points: 8, gpa: 0.5, remark: 'Pass' },
  { min: 0, grade: 'F9', points: 9, gpa: 0.0, remark: 'Fail' },
];

/** Credits for each subject passed (any grade but F9) in a semester; 10, as on the school's transcript. */
export const DEFAULT_CREDITS_PER_SUBJECT = 10;

export function gradeFor(total: number, scale: GradeBand[]): GradeBand {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const band = sorted.find((b) => total >= b.min);
  if (!band) throw new Error(`Grading scale has no band for a total of ${total}`);
  return band;
}

/** GPA points for a stored grade (e.g. "B3" → 3.0); 0 for a grade the scale doesn't know. */
export function gpaFor(grade: string, scale: GradeBand[]): number {
  return scale.find((b) => b.grade === grade)?.gpa ?? 0;
}

/** A pass earns credits: anything above the lowest band (F9). */
export function isPass(grade: string, scale: GradeBand[]): boolean {
  const lowest = [...scale].sort((a, b) => a.min - b.min)[0];
  return grade !== lowest?.grade;
}

/** Rounded to one decimal place, as on the transcript (64.5 / 42 → 1.5). */
export function roundGpa(value: number): number {
  return Math.round(value * 10) / 10;
}
