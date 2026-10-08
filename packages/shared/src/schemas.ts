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
    caMax: z.number().positive().max(100),
    examMax: z.number().positive().max(100),
    bands: z
      .array(z.object({ min: z.number().min(0).max(100), grade: trimmed(4), remark: trimmed(40) }))
      .min(2)
      .max(15),
  })
  .refine((v) => v.caMax + v.examMax === 100, 'CA and exam maximums must add up to 100')
  .refine((v) => v.bands.some((b) => b.min === 0), 'One band must start at 0');
export type GradingScaleInput = z.infer<typeof gradingScaleSchema>;

// ── Academic structure ──────────────────────────────────────────────────────

export const academicYearSchema = z
  .object({ name: trimmed(20), startsOn: isoDate, endsOn: isoDate })
  .refine((v) => v.startsOn < v.endsOn, 'The year must end after it starts');

export const termSchema = z
  .object({
    academicYearId: uuid,
    name: trimmed(40),
    startsOn: isoDate,
    endsOn: isoDate,
    isCurrent: z.boolean().default(false),
  })
  .refine((v) => v.startsOn < v.endsOn, 'The term must end after it starts');

export const programmeSchema = z.object({ name: trimmed(80) });

export const classSchema = z.object({
  name: trimmed(60),
  form: z.number().int().min(1).max(3),
  programmeId: uuid,
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
        caScore: z.number().min(0).max(100),
        examScore: z.number().min(0).max(100),
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
