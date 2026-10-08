/**
 * Every account has exactly one primary role. Finer-grained responsibilities
 * (form master/mistress, subject teacher of a class) are derived from
 * assignments in the database rather than from extra roles.
 */
export const ROLES = [
  'super_admin',
  'head',
  'assistant_head',
  'teacher',
  'accountant',
  'librarian',
  'counsellor',
  'parent',
  'student',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  head: 'Headmaster/Headmistress',
  assistant_head: 'Assistant Head',
  teacher: 'Teacher',
  accountant: 'Accountant',
  librarian: 'Librarian',
  counsellor: 'Counsellor',
  parent: 'Parent/Guardian',
  student: 'Student',
};

/** Roles with school-wide visibility of academic records. */
export const SCHOOL_LEADERSHIP_ROLES: readonly Role[] = ['super_admin', 'head', 'assistant_head'];

export const STAFF_ROLES: readonly Role[] = [
  'super_admin',
  'head',
  'assistant_head',
  'teacher',
  'accountant',
  'librarian',
  'counsellor',
];

export function isLeadership(role: Role): boolean {
  return SCHOOL_LEADERSHIP_ROLES.includes(role);
}

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
