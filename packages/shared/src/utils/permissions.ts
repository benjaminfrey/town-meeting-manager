/**
 * Permission resolution utilities.
 *
 * normalisePermissionsMatrix — accepts a matrix keyed by action CODE, by
 * action NAME, or both, and returns one keyed by NAME. Both spellings are in
 * the database; see its own comment for why, and for the conflict rule.
 *
 * hasPermission — resolves effective permission for an action on a board,
 * checking board_overrides first, then falling back to global. It takes an
 * ALREADY-NORMALISED matrix: pass a raw database row through
 * normalisePermissionsMatrix first, or half the accounts in the system
 * silently resolve to no permissions at all.
 *
 * checkRoleMutualExclusivity — checks if a target role conflicts with an
 * existing role (staff/board_member are mutually exclusive per Maine law).
 */

import type { UserRole } from "../constants/enums.js";
import type { PermissionAction, PermissionsMatrix } from "../constants/permissions.js";
import {
  ADMIN_ONLY_ACTIONS,
  BOARD_MEMBER_ALWAYS_ACTIONS,
  PERMISSIONS,
} from "../constants/permissions.js";
import { areRolesMutuallyExclusive, ROLE_LABELS } from "../constants/roles.js";

// ─── normalisePermissionsMatrix ───────────────────────────────────────

/**
 * Accept a permissions matrix keyed by action CODE, by action NAME, or both,
 * and return one keyed by NAME — the shape `hasPermission` resolves.
 *
 * ─── Why this has to exist ────────────────────────────────────────────────
 *
 * The same thirty actions have two spellings, and BOTH are in the database
 * right now, written by different parts of this product:
 *
 *   - `supabase/seed.sql:116` writes CODES:  `{"global": {"A2": true}}`
 *   - `StaffAccountFlow.tsx` builds the matrix with
 *     `buildPermissionsFromTemplate()`, which returns
 *     `Record<PermissionAction, boolean>` — NAMES — and
 *     `AddPersonDialog.tsx:117` / `AddMemberDialog.tsx:423` persist it
 *     verbatim. So every staff account created through the product is
 *     name-keyed.
 *
 * A reader that understands only one spelling silently resolves the other to
 * an empty matrix and denies everything. That is fail-closed and therefore not
 * a disclosure — but it is a total, silent outage of whichever half of the
 * data it does not speak, and it has now been shipped in BOTH directions: the
 * removed `has_permission()` SQL was code-only, and the API's first
 * authorization layer was code-only too, which would have denied every staff
 * account the product itself created.
 *
 * Accepting both is a widening of the READER only. It cannot grant anything
 * that was not written as a grant, because a key still has to name a real
 * action in one of the two spellings to count for anything.
 *
 * ─── The conflict rule, and why it is an AND ──────────────────────────────
 *
 * A matrix can contain both spellings of one action, and they can disagree —
 * `{"A2": false, "edit_agenda": true}`. Taking "the last one wins" would make
 * the answer depend on JSON key order, which is a coin flip that decides an
 * authorization question. So every spelling present must agree to grant: one
 * `false` in either spelling denies. Order-independent, and it errs toward
 * refusing.
 *
 * Keys matching neither spelling are dropped rather than passed through.
 */
export function normalisePermissionsMatrix(
  matrix:
    | {
        global?: Record<string, boolean | null | undefined> | null;
        board_overrides?: Array<{
          board_id: string;
          permissions?: Record<string, boolean | null | undefined> | null;
        }> | null;
      }
    | null
    | undefined,
): PermissionsMatrix {
  const empty = { global: {} as Record<PermissionAction, boolean>, board_overrides: [] };
  if (!matrix || typeof matrix !== "object") return empty;

  return {
    global: translateKeys(matrix.global),
    board_overrides: Array.isArray(matrix.board_overrides)
      ? matrix.board_overrides
          .filter((o) => o && typeof o === "object")
          .map((o) => ({
            board_id: String(o.board_id),
            permissions: translateKeys(o.permissions),
          }))
      : [],
  };
}

/** Every accepted spelling of every action, mapped to its canonical NAME. */
const ACTION_BY_KEY: Record<string, PermissionAction> = (() => {
  const map: Record<string, PermissionAction> = {};
  for (const [code, name] of Object.entries(PERMISSIONS)) {
    map[code] = name as PermissionAction;
    map[name] = name as PermissionAction;
  }
  return map;
})();

function translateKeys(
  source: Record<string, boolean | null | undefined> | null | undefined,
): Record<PermissionAction, boolean> {
  const out = {} as Record<PermissionAction, boolean>;
  if (!source || typeof source !== "object") return out;
  for (const [key, value] of Object.entries(source)) {
    const action = ACTION_BY_KEY[key];
    if (!action) continue;
    const granted = value === true;
    // AND, not assignment — see the conflict rule above.
    out[action] = action in out ? out[action]! && granted : granted;
  }
  return out;
}

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
    const override = permissions.board_overrides.find((o) => o.board_id === boardId);
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
