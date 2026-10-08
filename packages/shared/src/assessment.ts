/**
 * How a semester's result is made up. Each component's weight is also the
 * mark it is entered out of, so the components add up to a total out of 100.
 */
export interface AssessmentComponent {
  /** Stable identifier stored with each result's scores. */
  key: string;
  label: string;
  weight: number;
  /** The supervised end-of-semester assessment (shown as "exam"). */
  isExam: boolean;
}

export type Semester = 1 | 2;
export type AssessmentSchemes = Record<'1' | '2', AssessmentComponent[]>;

/** "Assessment Activities and Marks Distribution", Semesters 1 and 2. */
export const DEFAULT_ASSESSMENT_SCHEMES: AssessmentSchemes = {
  '1': [
    { key: 'class', label: 'Individual Class Assessments (classwork, quizzes, homework)', weight: 15, isExam: false },
    { key: 'midsem', label: 'Mid-Semester', weight: 15, isExam: false },
    { key: 'practical', label: 'Practical, Portfolio or Performance Assessment (individual)', weight: 10, isExam: false },
    { key: 'project', label: 'Group Projects, Research, Case Studies, Practical/Lab Work, Workshops, Performances, Presentations (out of class)', weight: 20, isExam: false },
    { key: 'exam', label: 'Supervised Individual Semester Assessment', weight: 40, isExam: true },
  ],
  '2': [
    { key: 'class', label: 'Individual Class Assessments (classwork, quizzes, mid-sem test, homework)', weight: 15, isExam: false },
    { key: 'midsem', label: 'Mid-Semester', weight: 15, isExam: false },
    { key: 'practical', label: 'Practical, Portfolio or Performance Assessment (individual)', weight: 10, isExam: false },
    { key: 'project', label: 'Individual Projects, Research, Case Studies, Practical/Lab Work, Workshops, Performances, Presentations (out of class)', weight: 20, isExam: false },
    { key: 'exam', label: 'Supervised Individual Semester Assessment', weight: 40, isExam: true },
  ],
};

/** Short labels for narrow screens and table headers. */
export const ASSESSMENT_SHORT_LABELS: Record<string, string> = {
  class: 'Class',
  midsem: 'Mid-sem',
  practical: 'Practical',
  project: 'Project',
  exam: 'Exam',
};

export function shortLabel(c: AssessmentComponent): string {
  return ASSESSMENT_SHORT_LABELS[c.key] ?? (c.label.length > 12 ? `${c.label.slice(0, 11)}…` : c.label);
}

export interface ScoreSummary {
  total: number;
  caScore: number;
  examScore: number;
  /** Every component has a mark. */
  complete: boolean;
}

export function summariseScores(components: AssessmentComponent[], scores: Record<string, number | null | undefined>): ScoreSummary {
  let ca = 0;
  let exam = 0;
  let complete = true;
  for (const c of components) {
    const v = scores[c.key];
    if (v === null || v === undefined) {
      complete = false;
      continue;
    }
    if (c.isExam) exam += v;
    else ca += v;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { caScore: r(ca), examScore: r(exam), total: r(ca + exam), complete };
}
