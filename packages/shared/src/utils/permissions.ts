/**
 * Permission resolution utilities.
 *
 * hasPermission — resolves effective permission for an action on a board,
 * checking board_overrides first, then falling back to global.
 *
 * checkRoleMutualExclusivity — checks if a target role conflicts with an
 * existing role (staff/board_member are mutually exclusive per Maine law).
 */

import type { UserRole } from "../constants/enums.js";
import type {
  PermissionAction,
  PermissionsMatrix,
} from "../constants/permissions.js";
import {
  ADMIN_ONLY_ACTIONS,
  BOARD_MEMBER_ALWAYS_ACTIONS,
} from "../constants/permissions.js";
import { areRolesMutuallyExclusive, ROLE_LABELS } from "../constants/roles.js";

// ─── hasPermission ────────────────────────────────────────────────────

/**
 * Check whether a given action is allowed for a user.
 *
 * Resolution order:
 * 1. If role is 'admin' → always true (full access)
 * 2. If role is 'board_member' → check BOARD_MEMBER_ALWAYS_ACTIONS
 * 3. For staff: check board_overrides[boardId] first, then global
 */
export function hasPermission(
  permissions: PermissionsMatrix | null | undefined,
  action: PermissionAction,
  boardId?: string,
  role?: UserRole,
): boolean {
  // Admin always has full access
  if (role === "admin") return true;

  // Admin-only actions can never be granted to non-admins
  if (ADMIN_ONLY_ACTIONS.includes(action)) return false;

  // Board member fixed permissions
  if (role === "board_member") {
    return BOARD_MEMBER_ALWAYS_ACTIONS.includes(action);
  }

  // Staff: resolve from permissions matrix
  if (!permissions) return false;

  // Check board-specific override first
  if (boardId && permissions.board_overrides) {
    const override = permissions.board_overrides.find(
      (o) => o.board_id === boardId,
    );
    if (override && action in override.permissions) {
      return override.permissions[action] ?? false;
    }
  }

  // Fall back to global
  return permissions.global?.[action] ?? false;
}

// ─── checkRoleMutualExclusivity ───────────────────────────────────────

export interface RoleConflictResult {
  conflict: boolean;
  existingRole?: UserRole;
  targetRole?: UserRole;
  message?: string;
}

/**
 * Check if assigning targetRole would conflict with existingRole.
 * Staff and board_member are mutually exclusive per Maine law
 * (30-A M.R.S.A. §2605).
 */
export function checkRoleMutualExclusivity(
  existingRole: UserRole | null | undefined,
  targetRole: UserRole,
): RoleConflictResult {
  if (!existingRole) {
    return { conflict: false };
  }

  if (!areRolesMutuallyExclusive(existingRole, targetRole)) {
    return { conflict: false };
  }

  const existingLabel = ROLE_LABELS[existingRole] ?? existingRole;
  const targetLabel = ROLE_LABELS[targetRole] ?? targetRole;

  return {
    conflict: true,
    existingRole,
    targetRole,
    message:
      `This person currently has a ${existingLabel.toLowerCase()} account. ` +
      `Under Maine conflict-of-interest law (30-A M.R.S.A. §2605), a person ` +
      `cannot simultaneously serve as staff and a board member. ` +
      `To add this person as a ${targetLabel.toLowerCase()}, their ` +
      `${existingLabel.toLowerCase()} account must be archived first.`,
  };
}
