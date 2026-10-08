import { z } from 'zod';
import { ROLES } from './roles';
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_PRIORITIES,
  AUDIENCE_TYPES,
  EVENT_CATEGORIES,
} from './enums';

const uuid = z.uuid();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
/** "HH:MM" 24-hour time. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

// ── Auth ────────────────────────────────────────────────────────────────────

/** Strong enough for minors' records without being hostile on a phone keyboard. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number');

export const loginSchema = z.object({
  /** Email address, phone number or student/staff number. */
  identifier: trimmed(120),
  password: z.string().min(1).max(128),
  deviceName: optionalText(80),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const pushTokenSchema = z.object({
  token: trimmed(255),
  platform: z.enum(['android', 'ios', 'web']),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

// ── Users ───────────────────────────────────────────────────────────────────

const ghanaPhone = z
  .string()
  .trim()
  .regex(/^\+?\d{9,15}$/, 'Enter a phone number using digits only, e.g. +233241234567');

export const createUserSchema = z
  .object({
    fullName: trimmed(120),
    email: z.email().max(160).nullish(),
    phone: ghanaPhone.nullish(),
    role: z.enum(ROLES),
    /** Issued by the school; shown to the user once and must be changed at first sign-in. */
    temporaryPassword: passwordSchema,
    student: z
      .object({
        studentNumber: trimmed(40),
        classId: uuid,
        combinationId: uuid.nullish(),
        houseId: uuid.nullish(),
        dateOfBirth: isoDate.nullish(),
      })
      .optional(),
    staff: z.object({ staffNumber: trimmed(40) }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'student' && !v.student) {
      ctx.addIssue({ code: 'custom', path: ['student'], message: 'Student details are required' });
    }
    if (v.role !== 'student' && v.student) {
      ctx.addIssue({ code: 'custom', path: ['student'], message: 'Only students have student details' });
    }
    if (v.role !== 'student' && !v.email && !v.phone && !v.staff) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Provide an email, phone or staff number to sign in with' });
    }
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: trimmed(120).optional(),
  email: z.email().max(160).nullish(),
  phone: ghanaPhone.nullish(),
  status: z.enum(['active', 'deactivated']).optional(),
  classId: uuid.optional(),
  combinationId: uuid.nullish(),
  houseId: uuid.nullish(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ temporaryPassword: passwordSchema });

export const linkGuardianSchema = z.object({
  guardianUserId: uuid,
  studentId: uuid,
  relationship: trimmed(40),
});
export type LinkGuardianInput = z.infer<typeof linkGuardianSchema>;

export const listUsersQuerySchema = z.object({
  role: z.enum(ROLES).optional(),
  search: z.string().trim().max(80).optional(),
  classId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// ── School profile & settings ───────────────────────────────────────────────

export const schoolProfileSchema = z.object({
  name: trimmed(160),
  shortName: optionalText(40),
  motto: optionalText(200),
  vision: optionalText(2000),
  mission: optionalText(2000),
  coreValues: z.array(trimmed(80)).max(20).default([]),
  history: optionalText(20000),
  address: optionalText(400),
  phone: optionalText(40),
  email: z.email().nullish(),
  website: z.url().nullish(),
  logoUrl: z.url().nullish(),
});
export type SchoolProfileInput = z.infer<typeof schoolProfileSchema>;

export const gradingScaleSchema = z
  .object({
    bands: z
      .array(z.object({ min: z.number().min(0).max(100), grade: trimmed(4), points: z.number().int().min(1).max(9), remark: trimmed(40) }))
      .min(2)
      .max(15),
  })
  .refine((v) => v.bands.some((b) => b.min === 0), 'One band must start at 0');
export type GradingScaleInput = z.infer<typeof gradingScaleSchema>;

const assessmentComponentSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,23}$/, 'Use lowercase letters, numbers and _'),
  label: trimmed(200),
  weight: z.number().positive().max(100),
  isExam: z.boolean(),
});

const assessmentSchemeSchema = z
  .array(assessmentComponentSchema)
  .min(1)
  .max(10)
  .refine((cs) => Math.abs(cs.reduce((s, c) => s + c.weight, 0) - 100) < 0.001, 'The weights must add up to 100')
  .refine((cs) => new Set(cs.map((c) => c.key)).size === cs.length, 'Each component needs a different key');

export const assessmentSchemesSchema = z.object({ '1': assessmentSchemeSchema, '2': assessmentSchemeSchema });
export type AssessmentSchemesInput = z.infer<typeof assessmentSchemesSchema>;

// ── Academic structure ──────────────────────────────────────────────────────

export const academicYearSchema = z
  .object({ name: trimmed(20), startsOn: isoDate, endsOn: isoDate })
  .refine((v) => v.startsOn < v.endsOn, 'The year must end after it starts');

export const termSchema = z
  .object({
    academicYearId: uuid,
    name: trimmed(40),
    /** The school runs two semesters per academic year. */
    semester: z.union([z.literal(1), z.literal(2)]),
    startsOn: isoDate,
    endsOn: isoDate,
    isCurrent: z.boolean().default(false),
  })
  .refine((v) => v.startsOn < v.endsOn, 'The semester must end after it starts');

/** Code used in class names, e.g. "BUS" in "1BUS 2" or "G/A" in "2G/A 3". */
const programmeCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9/]{0,5}$/, 'Use up to 6 letters, e.g. BUS or G/A');

export const programmeSchema = z.object({
  name: trimmed(80),
  code: programmeCode,
  /** Write class names with a space after the form: "1 LANG 1" instead of "1LANG 1". */
  spacedName: z.boolean().default(false),
  /** What people call the classes, e.g. "Arts" for "Arts 1", "Arts 2". */
  label: z.string().trim().max(20).nullish(),
});

/**
 * Creates the standard set of classes for a programme, named "<form><CODE> <stream>",
 * e.g. 1BUS 1, 1BUS 2 … 3BUS 2. Classes that already exist are left alone.
 */
export const bulkClassesSchema = z.object({
  programmeId: uuid,
  forms: z.array(z.number().int().min(1).max(3)).min(1).max(3).default([1, 2, 3]),
  streams: z.number().int().min(1).max(20),
});
export type BulkClassesInput = z.infer<typeof bulkClassesSchema>;

export function className(form: number, programmeCode: string, stream: number, spaced = false) {
  return `${form}${spaced ? ' ' : ''}${programmeCode} ${stream}`;
}

/**
 * A learning-area option ("Option 3"): the elective subjects a group of
 * students in a class takes. Its letter distinguishes the groups sharing a
 * class, as in "1BUS 2A" and "1BUS 2B".
 */
export const combinationSchema = z.object({
  programmeId: uuid,
  option: z.number().int().min(1).max(30),
  stream: z.number().int().min(1).max(50),
  letter: z.string().trim().toUpperCase().max(2).default(''),
  electiveSubjectIds: z.array(uuid).min(1).max(8),
  /** Marked * on the combination list: the student must drop one subject before SHS 3. */
  mustDropOne: z.boolean().default(false),
});
export type CombinationInput = z.infer<typeof combinationSchema>;

/** Core subjects a programme does not take (Science students don't take General Science). */
export const coreExclusionsSchema = z.object({ subjectIds: z.array(uuid).max(10) });

// ── Houses ──────────────────────────────────────────────────────────────────

export const houseSchema = z.object({
  name: trimmed(60),
  colour: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #a00561').nullish(),
});

export const housePointsSchema = z.object({
  points: z
    .number()
    .int()
    .min(-1000)
    .max(1000)
    .refine((n) => n !== 0, 'Enter a non-zero number of points'),
  reason: trimmed(200),
});
export type HousePointsInput = z.infer<typeof housePointsSchema>;

export const classSchema = z.object({
  name: trimmed(60),
  form: z.number().int().min(1).max(3),
  programmeId: uuid,
  /** Stream number within the form and programme (the "2" in "1BUS 2"); used for ordering. */
  stream: z.number().int().min(1).max(50).nullish(),
  formMasterId: uuid.nullish(),
});

export const subjectSchema = z.object({
  code: trimmed(12),
  name: trimmed(80),
  isCore: z.boolean().default(false),
});

/** Assigns a subject to a class and names the teacher who takes it. */
export const classSubjectSchema = z.object({
  classId: uuid,
  subjectId: uuid,
  teacherId: uuid.nullish(),
});

export const timetableEntrySchema = z
  .object({
    termId: uuid,
    classId: uuid,
    subjectId: uuid,
    dayOfWeek: z.number().int().min(1).max(7),
    startsAt: timeOfDay,
    endsAt: timeOfDay,
    room: optionalText(40),
  })
  .refine((v) => v.startsAt < v.endsAt, 'The period must end after it starts');
export type TimetableEntryInput = z.infer<typeof timetableEntrySchema>;

const bellPeriodSchema = z
  .object({
    key: z.string().trim().regex(/^[A-Za-z0-9_]{1,16}$/),
    label: trimmed(40),
    startsAt: timeOfDay,
    endsAt: timeOfDay,
    kind: z.enum(['lesson', 'break']),
  })
  .refine((p) => p.startsAt < p.endsAt, 'A period must end after it starts');

export const bellScheduleSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  periods: z
    .array(bellPeriodSchema)
    .min(1)
    .max(20)
    .refine((ps) => ps.every((p, i) => i === 0 || ps[i - 1].endsAt <= p.startsAt), 'Periods must be in order and must not overlap'),
  activities: z
    .array(
      z
        .object({ day: z.number().int().min(1).max(7), label: trimmed(40), startsAt: timeOfDay, endsAt: timeOfDay })
        .refine((a) => a.startsAt < a.endsAt, 'An activity must end after it starts'),
    )
    .max(30),
});

// ── Announcements & events ──────────────────────────────────────────────────

const audience = {
  audienceType: z.enum(AUDIENCE_TYPES).default('school'),
  audienceRef: z.string().trim().max(60).nullish(),
};

function audienceRefRequired(v: { audienceType: string; audienceRef?: string | null }) {
  return v.audienceType === 'school' || !!v.audienceRef;
}

export const announcementSchema = z
  .object({
    title: trimmed(160),
    body: trimmed(10000),
    category: z.enum(ANNOUNCEMENT_CATEGORIES),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('normal'),
    ...audience,
    /** Omit to publish immediately. */
    publishAt: isoDateTime.nullish(),
    expiresAt: isoDateTime.nullish(),
    sendPush: z.boolean().default(false),
  })
  .refine(audienceRefRequired, { path: ['audienceRef'], message: 'Choose who this is for' });
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const eventSchema = z
  .object({
    title: trimmed(160),
    description: optionalText(4000),
    category: z.enum(EVENT_CATEGORIES),
    startsAt: isoDateTime,
    endsAt: isoDateTime.nullish(),
    allDay: z.boolean().default(false),
    location: optionalText(160),
    ...audience,
  })
  .refine(audienceRefRequired, { path: ['audienceRef'], message: 'Choose who this is for' })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) >= Date.parse(v.startsAt), { path: ['endsAt'], message: 'Must end after it starts' });
export type EventInput = z.infer<typeof eventSchema>;

export const dateRangeQuerySchema = z.object({ from: isoDate, to: isoDate });

// ── Assignments ─────────────────────────────────────────────────────────────

export const assignmentSchema = z.object({
  classId: uuid,
  subjectId: uuid,
  title: trimmed(160),
  instructions: trimmed(10000),
  dueAt: isoDateTime,
  maxScore: z.number().positive().max(1000).default(100),
  allowLateSubmissions: z.boolean().default(true),
});
export type AssignmentInput = z.infer<typeof assignmentSchema>;

export const submissionSchema = z
  .object({
    textResponse: optionalText(20000),
    /** File key returned by POST /files. */
    fileId: uuid.nullish(),
  })
  .refine((v) => !!v.textResponse || !!v.fileId, 'Write a response or attach a file');
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const gradeSubmissionSchema = z.object({
  score: z.number().min(0).max(1000),
  feedback: optionalText(4000),
});
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;

// ── Results ─────────────────────────────────────────────────────────────────

export const resultEntrySchema = z.object({
  termId: uuid,
  classId: uuid,
  subjectId: uuid,
  entries: z
    .array(
      z.object({
        studentId: uuid,
        /** Marks per assessment component key, each out of the component's weight. Null = not yet entered. */
        scores: z.record(z.string().max(24), z.number().min(0).max(100).nullable()),
        teacherComment: optionalText(500),
      }),
    )
    .min(1)
    .max(200),
});
export type ResultEntryInput = z.infer<typeof resultEntrySchema>;

export const publishResultsSchema = z.object({
  termId: uuid,
  classId: uuid,
  /** Omit to publish every subject for the class. */
  subjectId: uuid.optional(),
});
export type PublishResultsInput = z.infer<typeof publishResultsSchema>;
