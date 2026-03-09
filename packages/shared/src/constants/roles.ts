import { UserRole } from "./enums.js";

/** Roles that can be assigned to user accounts */
export const ASSIGNABLE_ROLES = [
  UserRole.ADMIN,
  UserRole.STAFF,
  UserRole.BOARD_MEMBER,
] as const;

/** Roles that are mutually exclusive on the same PERSON */
export const MUTUALLY_EXCLUSIVE_ROLES: [UserRole, UserRole] = [
  UserRole.STAFF,
  UserRole.BOARD_MEMBER,
];

/**
 * Check if two roles are mutually exclusive.
 * Staff and board_member cannot coexist on the same PERSON.
 */
export function areRolesMutuallyExclusive(
  role1: UserRole,
  role2: UserRole,
): boolean {
  return (
    (role1 === UserRole.STAFF && role2 === UserRole.BOARD_MEMBER) ||
    (role1 === UserRole.BOARD_MEMBER && role2 === UserRole.STAFF)
  );
}

/** Display labels for user roles */
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SYS_ADMIN]: "System Administrator",
  [UserRole.ADMIN]: "Town Administrator",
  [UserRole.STAFF]: "Staff",
  [UserRole.BOARD_MEMBER]: "Board Member",
};
