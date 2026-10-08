import type { Role } from './roles';
import type { Permission } from './permissions';
import type {
  AnnouncementCategory,
  AnnouncementPriority,
  AudienceType,
  EventCategory,
  NotificationType,
  SubmissionStatus,
} from './enums';

/** JSON wire types returned by the API. Dates are ISO strings. */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface StudentSummary {
  id: string;
  userId: string;
  fullName: string;
  studentNumber: string;
  classId: string;
  className: string;
  form: number;
  programmeName: string;
  /** Class plus option letter as on the combination list, e.g. "1BUS 2A". */
  groupName: string;
  combinationId: string | null;
  houseId: string | null;
  houseName: string | null;
}

export interface Me {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
  /** Present when role = student. */
  student: StudentSummary | null;
  /** Present when role = parent: the children this guardian is linked to. */
  children: StudentSummary[];
  /** Present for teachers: classes they are form master of. */
  formClassIds: string[];
}

export interface AuthResponse extends TokenPair {
  user: Me;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserListItem {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: 'active' | 'deactivated';
  studentNumber: string | null;
  staffNumber: string | null;
  className: string | null;
  lastLoginAt: string | null;
}

export interface SchoolProfile {
  name: string;
  shortName: string | null;
  motto: string | null;
  vision: string | null;
  mission: string | null;
  coreValues: string[];
  history: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  updatedAt: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  priority: AnnouncementPriority;
  audienceType: AudienceType;
  audienceRef: string | null;
  authorName: string;
  publishAt: string;
  expiresAt: string | null;
}

export interface SchoolEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  audienceType: AudienceType;
  audienceRef: string | null;
}

export interface TimetableSlot {
  id: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  room: string | null;
  subjectId: string;
  subjectName: string;
  classId: string;
  className: string;
  teacherName: string | null;
  /**
   * Other classes in the same lesson: the same teacher takes the same subject
   * with them at the same time (e.g. French for 1G/S 1 and 1H/E 2 together).
   */
  combinedWith: string[];
}

export interface SubjectWithTeacher {
  /** Null when the subject hasn't been added to the class yet (no teacher assigned). */
  classSubjectId: string | null;
  subjectId: string;
  code: string;
  name: string;
  isCore: boolean;
  teacherId: string | null;
  teacherName: string | null;
}

export interface AssignmentSummary {
  id: string;
  title: string;
  instructions: string;
  dueAt: string;
  maxScore: number;
  allowLateSubmissions: boolean;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  teacherName: string;
  createdAt: string;
  /** For students/parents: their own submission, if any. */
  mySubmission: SubmissionSummary | null;
  /** For staff: how many students have submitted. */
  submissionCount?: number;
}

export interface SubmissionSummary {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  textResponse: string | null;
  file: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
  status: SubmissionStatus;
  submittedAt: string;
  score: number | null;
  feedback: string | null;
  gradedAt: string | null;
}

export interface ResultRow {
  id: string;
  studentId: string;
  studentName: string;
  subjectId: string;
  subjectName: string;
  termId: string;
  termName: string;
  caScore: number;
  examScore: number;
  /** Mark for each assessment component, in the order of the semester's scheme. */
  breakdown: { key: string; label: string; weight: number; score: number | null }[];
  /** Every component has a mark; only complete results can be published. */
  complete: boolean;
  total: number;
  grade: string;
  /** WAEC numeric value (1 = A1 … 9 = F9). */
  gradePoint: number;
  remark: string;
  teacherComment: string | null;
  published: boolean;
}

export interface TermSummary {
  id: string;
  name: string;
  academicYearName: string;
  startsOn: string;
  endsOn: string;
  semester: 1 | 2;
  isCurrent: boolean;
}

export interface House {
  id: string;
  name: string;
  colour: string | null;
  points: number;
  members: number;
}

export interface SubjectCombination {
  id: string;
  programmeId: string;
  option: number;
  stream: number;
  letter: string;
  mustDropOne: boolean;
  electives: { id: string; name: string }[];
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string> | null;
  readAt: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  issues?: { path: string; message: string }[];
}
