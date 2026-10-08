import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_PRIORITIES,
  AUDIENCE_TYPES,
  EVENT_CATEGORIES,
  NOTIFICATION_TYPES,
  ROLES,
  SUBMISSION_STATUSES,
  type AssessmentSchemes,
  type GradeBand,
} from '@sda-shs/shared';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Scores are stored exactly; numeric comes back from pg as a string. */
const score = (name: string) => numeric(name, { precision: 6, scale: 2, mode: 'number' });

export const roleEnum = pgEnum('role', ROLES);
export const userStatusEnum = pgEnum('user_status', ['active', 'deactivated']);
export const announcementCategoryEnum = pgEnum('announcement_category', ANNOUNCEMENT_CATEGORIES);
export const announcementPriorityEnum = pgEnum('announcement_priority', ANNOUNCEMENT_PRIORITIES);
export const audienceTypeEnum = pgEnum('audience_type', AUDIENCE_TYPES);
export const eventCategoryEnum = pgEnum('event_category', EVENT_CATEGORIES);
export const submissionStatusEnum = pgEnum('submission_status', SUBMISSION_STATUSES);
export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);

// ── Identity ────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: id(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('users_phone_unique').on(t.phone),
    index('users_role_idx').on(t.role),
  ],
);

export const staffProfiles = pgTable('staff_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  staffNumber: text('staff_number').notNull().unique(),
});

/**
 * One row per signed-in device. The refresh token is stored only as a SHA-256
 * hash and is rotated on every use; the previous hash is kept so that
 * presenting an already-rotated token (a sign of theft) revokes the session.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    previousTokenHash: text('previous_token_hash'),
    deviceName: text('device_name'),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_previous_hash_idx').on(t.previousTokenHash)],
);

export const pushTokens = pgTable('push_tokens', {
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  updatedAt: updatedAt(),
});

// ── School ──────────────────────────────────────────────────────────────────

/** Single-row table (id is always 1). Every field is editable by the school. */
export const schoolProfile = pgTable('school_profile', {
  id: smallint('id').primaryKey().default(1),
  name: text('name').notNull(),
  shortName: text('short_name'),
  motto: text('motto'),
  vision: text('vision'),
  mission: text('mission'),
  coreValues: jsonb('core_values').$type<string[]>().notNull().default([]),
  history: text('history'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  website: text('website'),
  logoUrl: text('logo_url'),
  gradingScale: jsonb('grading_scale').$type<{ bands: GradeBand[] }>(),
  /** Assessment components and weights for semester 1 and semester 2. */
  assessmentSchemes: jsonb('assessment_schemes').$type<AssessmentSchemes>(),
  updatedAt: updatedAt(),
});

export const academicYears = pgTable('academic_years', {
  id: id(),
  name: text('name').notNull().unique(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
});

export const terms = pgTable(
  'terms',
  {
    id: id(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** 1 or 2: the school runs two semesters per academic year. */
    semester: smallint('semester').notNull().default(1),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
  },
  (t) => [
    check('terms_semester_range', sql`${t.semester} in (1, 2)`),
    uniqueIndex('terms_year_name_unique').on(t.academicYearId, t.name),
    // At most one current term.
    uniqueIndex('terms_single_current').on(t.isCurrent).where(sql`${t.isCurrent}`),
  ],
);

export const programmes = pgTable('programmes', {
  id: id(),
  name: text('name').notNull().unique(),
  /** Short code used in class names: "SCI" in "1 SCI 2". Required by the API for new programmes. */
  code: text('code').unique(),
  /** What people call the classes: "Arts" → "Arts 1", "Arts 2". */
  label: text('label'),
});

/** Core subjects a programme doesn't take (e.g. Science students don't take General Science). */
export const programmeCoreExclusions = pgTable(
  'programme_core_exclusions',
  {
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.programmeId, t.subjectId] })],
);

/**
 * A learning-area option from the school's subject combination list, e.g.
 * Business Option 3 = class stream 2, group A ("1BUS 2A").
 */
export const subjectCombinations = pgTable(
  'subject_combinations',
  {
    id: id(),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'cascade' }),
    option: smallint('option').notNull(),
    stream: smallint('stream').notNull(),
    letter: text('letter').notNull().default(''),
    mustDropOne: boolean('must_drop_one').notNull().default(false),
  },
  (t) => [uniqueIndex('combinations_programme_option').on(t.programmeId, t.option)],
);

export const combinationSubjects = pgTable(
  'combination_subjects',
  {
    combinationId: uuid('combination_id')
      .notNull()
      .references(() => subjectCombinations.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.combinationId, t.subjectId] })],
);

export const houses = pgTable('houses', {
  id: id(),
  name: text('name').notNull().unique(),
  colour: text('colour'),
});

export const housePoints = pgTable(
  'house_points',
  {
    id: id(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'cascade' }),
    points: integer('points').notNull(),
    reason: text('reason').notNull(),
    awardedBy: uuid('awarded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [index('house_points_house_idx').on(t.houseId)],
);

export const classes = pgTable(
  'classes',
  {
    id: id(),
    name: text('name').notNull().unique(),
    form: smallint('form').notNull(),
    /** Stream number within the form and programme: the "2" in "1 SCI 2". */
    stream: smallint('stream'),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'restrict' }),
    formMasterId: uuid('form_master_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [check('classes_form_range', sql`${t.form} between 1 and 3`)],
);

export const subjects = pgTable('subjects', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isCore: boolean('is_core').notNull().default(false),
});

/** Which subjects a class takes and who teaches each one. Drives teacher access. */
export const classSubjects = pgTable(
  'class_subjects',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('class_subjects_unique').on(t.classId, t.subjectId),
    index('class_subjects_teacher_idx').on(t.teacherId),
  ],
);

export const students = pgTable(
  'students',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentNumber: text('student_number').notNull().unique(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    /** The student's option; decides their elective subjects. */
    combinationId: uuid('combination_id').references(() => subjectCombinations.id, { onDelete: 'set null' }),
    houseId: uuid('house_id').references(() => houses.id, { onDelete: 'set null' }),
    dateOfBirth: date('date_of_birth'),
  },
  (t) => [index('students_class_idx').on(t.classId)],
);

export const guardianStudents = pgTable(
  'guardian_students',
  {
    guardianUserId: uuid('guardian_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    relationship: text('relationship').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.guardianUserId, t.studentId] })],
);

export const timetableEntries = pgTable(
  'timetable_entries',
  {
    id: id(),
    termId: uuid('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    room: text('room'),
  },
  (t) => [
    index('timetable_class_term_idx').on(t.classId, t.termId),
    check('timetable_day_range', sql`${t.dayOfWeek} between 1 and 7`),
    check('timetable_period_order', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

// ── Communication ───────────────────────────────────────────────────────────

export const announcements = pgTable(
  'announcements',
  {
    id: id(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    category: announcementCategoryEnum('category').notNull(),
    priority: announcementPriorityEnum('priority').notNull().default('normal'),
    audienceType: audienceTypeEnum('audience_type').notNull().default('school'),
    audienceRef: text('audience_ref'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    publishAt: timestamp('publish_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Whether recipients get an in-app notification (and push) when it goes live. */
    notifyOnPublish: boolean('notify_on_publish').notNull().default(false),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('announcements_publish_idx').on(t.publishAt)],
);

export const events = pgTable(
  'events',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description'),
    category: eventCategoryEnum('category').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location'),
    audienceType: audienceTypeEnum('audience_type').notNull().default('school'),
    audienceRef: text('audience_ref'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [index('events_starts_idx').on(t.startsAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, string>>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)],
);

// ── Files ───────────────────────────────────────────────────────────────────

export const files = pgTable('files', {
  id: id(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull().unique(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: createdAt(),
});

// ── Academics ───────────────────────────────────────────────────────────────

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    maxScore: score('max_score').notNull().default(100),
    allowLateSubmissions: boolean('allow_late_submissions').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assignments_class_due_idx').on(t.classId, t.dueAt)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    textResponse: text('text_response'),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    status: submissionStatusEnum('status').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    score: score('score'),
    feedback: text('feedback'),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    gradedBy: uuid('graded_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('submissions_one_per_student').on(t.assignmentId, t.studentId)],
);

export const results = pgTable(
  'results',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => terms.id, { onDelete: 'restrict' }),
    /** Class at the time the result was entered (students move between classes). */
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    /** Mark per assessment component key (each out of that component's weight). */
    scores: jsonb('scores').$type<Record<string, number | null>>().notNull().default({}),
    /** Sum of the non-exam components. */
    caScore: score('ca_score').notNull(),
    /** The supervised semester assessment. */
    examScore: score('exam_score').notNull(),
    complete: boolean('complete').notNull().default(false),
    total: score('total').notNull(),
    grade: text('grade').notNull(),
    /** WAEC numeric value, 1 (A1) … 9 (F9). */
    gradePoint: smallint('grade_point').notNull(),
    remark: text('remark').notNull(),
    teacherComment: text('teacher_comment'),
    enteredBy: uuid('entered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('results_student_subject_term').on(t.studentId, t.subjectId, t.termId),
    index('results_class_term_idx').on(t.classId, t.termId),
  ],
);

// ── Audit ───────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: inet('ip_address'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_created_idx').on(t.createdAt)],
);
