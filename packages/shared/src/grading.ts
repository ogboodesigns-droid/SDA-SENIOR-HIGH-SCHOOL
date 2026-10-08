export interface GradeBand {
  /** Inclusive lower bound of the total score (0–100). */
  min: number;
  grade: string;
  /** WAEC numeric value: 1 (A1) … 9 (F9). Lower is better; used for aggregates. */
  points: number;
  remark: string;
}

/** WASSCE grading scale used by Ghanaian senior high schools. */
export const DEFAULT_GRADING_SCALE: GradeBand[] = [
  { min: 75, grade: 'A1', points: 1, remark: 'Excellent' },
  { min: 70, grade: 'B2', points: 2, remark: 'Very Good' },
  { min: 65, grade: 'B3', points: 3, remark: 'Good' },
  { min: 60, grade: 'C4', points: 4, remark: 'Credit' },
  { min: 55, grade: 'C5', points: 5, remark: 'Credit' },
  { min: 50, grade: 'C6', points: 6, remark: 'Credit' },
  { min: 45, grade: 'D7', points: 7, remark: 'Pass' },
  { min: 40, grade: 'E8', points: 8, remark: 'Pass' },
  { min: 0, grade: 'F9', points: 9, remark: 'Fail' },
];

/** Default weighting: continuous assessment out of 30, examination out of 70. */
export const DEFAULT_SCORE_LIMITS = { caMax: 30, examMax: 70 };

export function gradeFor(total: number, scale: GradeBand[]): GradeBand {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const band = sorted.find((b) => total >= b.min);
  if (!band) throw new Error(`Grading scale has no band for a total of ${total}`);
  return band;
}
