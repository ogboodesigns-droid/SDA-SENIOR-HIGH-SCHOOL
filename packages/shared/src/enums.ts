export const ANNOUNCEMENT_CATEGORIES = [
  'general',
  'academic',
  'examination',
  'sports',
  'src',
  'pta',
  'religious',
  'clubs',
  'boarding',
  'health',
  'emergency',
  'events',
] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  general: 'General',
  academic: 'Academic',
  examination: 'Examination',
  sports: 'Sports',
  src: 'SRC',
  pta: 'PTA',
  religious: 'Religious Activities',
  clubs: 'Clubs & Societies',
  boarding: 'Boarding',
  health: 'Health',
  emergency: 'Emergency',
  events: 'School Events',
};

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'important', 'urgent'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

/**
 * Who an announcement or event is addressed to.
 * - school: everyone
 * - role: audienceRef is a Role (e.g. "parent")
 * - form: audienceRef is "1" | "2" | "3"
 * - programme / class / house: audienceRef is the programme, class or house id
 */
export const AUDIENCE_TYPES = ['school', 'role', 'form', 'programme', 'class', 'house'] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export const EVENT_CATEGORIES = [
  'academic',
  'examination',
  'holiday',
  'meeting',
  'sports',
  'religious',
  'src',
  'ceremony',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const SUBMISSION_STATUSES = ['submitted', 'late', 'graded'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const FORMS = [1, 2, 3] as const;

export const NOTIFICATION_TYPES = [
  'announcement',
  'assignment',
  'assignment_graded',
  'result_published',
  'event',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
