import type { Role } from './roles';

/**
 * Coarse-grained permissions checked at the route level. Record-level rules
 * (a student sees only their own results, a teacher only their classes, a
 * parent only linked children) are enforced separately by the API's access
 * policy.
 */
export const PERMISSIONS = [
  'users:read',
  'users:manage',
  'school:manage',
  'academics:manage',
  'timetable:manage',
  'announcements:publish',
  'announcements:publish_school_wide',
  'events:manage',
  'assignments:manage',
  'results:enter',
  'results:publish',
  'houses:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const LEADERSHIP: Permission[] = [
  'users:read',
  'users:manage',
  'school:manage',
  'academics:manage',
  'timetable:manage',
  'announcements:publish',
  'announcements:publish_school_wide',
  'events:manage',
  'assignments:manage',
  'results:enter',
  'results:publish',
  'houses:manage',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: [...LEADERSHIP, 'audit:read'],
  head: [...LEADERSHIP, 'audit:read'],
  // Assistant heads cannot alter school identity or manage accounts.
  assistant_head: LEADERSHIP.filter((p) => p !== 'school:manage' && p !== 'users:manage'),
  teacher: ['announcements:publish', 'assignments:manage', 'results:enter'],
  accountant: [],
  librarian: [],
  counsellor: [],
  parent: [],
  student: [],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
