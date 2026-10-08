export interface GradeBand {
  /** Inclusive lower bound of the total score (0–100). */
  min: number;
  grade: string;
  remark: string;
}

/**
 * Starting point only: the WAEC-style nine-point scale widely used in Ghanaian
 * SHS report cards. The school must confirm or edit this in the admin portal
 * (Settings → Grading scale) before results are published.
 */
export const DEFAULT_GRADING_SCALE: GradeBand[] = [
  { min: 80, grade: 'A1', remark: 'Excellent' },
  { min: 70, grade: 'B2', remark: 'Very Good' },
  { min: 65, grade: 'B3', remark: 'Good' },
  { min: 60, grade: 'C4', remark: 'Credit' },
  { min: 55, grade: 'C5', remark: 'Credit' },
  { min: 50, grade: 'C6', remark: 'Credit' },
  { min: 45, grade: 'D7', remark: 'Pass' },
  { min: 40, grade: 'E8', remark: 'Pass' },
  { min: 0, grade: 'F9', remark: 'Fail' },
];

/** Default weighting: continuous assessment out of 30, examination out of 70. */
export const DEFAULT_SCORE_LIMITS = { caMax: 30, examMax: 70 };

export function gradeFor(total: number, scale: GradeBand[]): GradeBand {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const band = sorted.find((b) => total >= b.min);
  if (!band) throw new Error(`Grading scale has no band for a total of ${total}`);
  return band;
}
