/**
 * usePermission — RBAC permission resolution hooks and utilities.
 *
 * Resolution order (per advisory 1.2):
 *  1. admin / sys_admin  → always allowed
 *  2. V1–V5 (view actions) → always allowed for all authenticated users
 *  3. board_member        → fixed actions (A4, A7, M8, R6) + configurable R4
 *                           + any additional JSONB permissions granted by admin
 *  4. staff               → board-specific override first, then global JSONB
 *  5. All other cases     → denied
 *
 * Action codes are the short codes (e.g. "A2", "M8", "V1") that map to the
 * permission action strings defined in @town-meeting/shared.
 */

import { useMemo } from "react";
import {
  PERMISSIONS,
  VIEW_ACTIONS,
  BOARD_MEMBER_ALWAYS_ACTIONS,
  ADMIN_ONLY_ACTIONS,
  type PermissionAction,
  type PermissionsMatrix,
} from "@town-meeting/shared";
import { useCurrentUser, type CurrentUser } from "./useCurrentUser";
import { useAuth } from "@/providers/AuthProvider";

// ─── Action code lookup maps ──────────────────────────────────────────

/** All action codes → action value strings (A1-A7, M1-M8, R1-R6, C1-C5, T1-T4, V1-V5) */
const ALL_ACTION_MAP: Record<string, PermissionAction | string> = {
  ...(PERMISSIONS as Record<string, string>),
  ...(VIEW_ACTIONS as Record<string, string>),
};

/** Set of view action values (always allowed) */
const VIEW_ACTION_VALUES = new Set<string>(Object.values(VIEW_ACTIONS));

/** Set of view action codes (V1-V5) */
const VIEW_ACTION_CODES = new Set<string>(Object.keys(VIEW_ACTIONS));

/** Set of admin-only action values (T1-T4) */
const ADMIN_ONLY_VALUES = new Set<string>(ADMIN_ONLY_ACTIONS);

/** Set of board_member always-allowed action values (A4, A7, M8) */
const BM_ALWAYS_VALUES = new Set<string>(BOARD_MEMBER_ALWAYS_ACTIONS);

/** R4 action value — configurable for board_member, default Y */
const R4_ACTION = PERMISSIONS.R4 as string;

/** R6 action value — always allowed for board_member (approved-only constraint is UI-level) */
const R6_ACTION = PERMISSIONS.R6 as string;

// ─── Core resolution logic ────────────────────────────────────────────

/**
 * Resolves whether a given action is allowed for a CurrentUser.
 * Pure function — no hooks, safe to call in clientLoaders.
 */
export function checkPermission(
  currentUser: CurrentUser | null,
  actionCode: string,
  boardId?: string,
): boolean {
  if (!currentUser) return false;

  const { role, permissions } = currentUser;

  // 1. Admins bypass all checks
  if (role === "admin" || role === "sys_admin") return true;

  // Resolve action code → action value
  const actionValue = ALL_ACTION_MAP[actionCode];
  if (!actionValue) return false; // Unknown action code → deny

  // 2. V1–V5: always allowed for authenticated users
  if (VIEW_ACTION_CODES.has(actionCode) || VIEW_ACTION_VALUES.has(actionValue)) {
    return true;
  }

  // T1–T4: admin-only, never granted to others
  if (ADMIN_ONLY_VALUES.has(actionValue)) return false;

  // 3. Board member logic
  if (role === "board_member") {
    // Fixed always-allowed actions: A4, A7, M8
    if (BM_ALWAYS_VALUES.has(actionValue)) return true;

    // R6 (export minutes) — always allowed (approved-only is a UI constraint)
    if (actionValue === R6_ACTION) return true;

    // R4 (view draft minutes) — configurable, default Y
    if (actionValue === R4_ACTION) {
      return permissions?.global?.[actionValue as PermissionAction] ?? true;
    }

    // All other actions: check JSONB (admin may have granted extras like A2, M5)
    return permissions?.global?.[actionValue as PermissionAction] ?? false;
  }

  // 4. Staff: check board-specific override first, then global
  if (role === "staff") {
    if (!permissions) return false;

    const action = actionValue as PermissionAction;

    // Board-specific override takes precedence
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

  return false;
}

// ─── Hooks ────────────────────────────────────────────────────────────

/**
 * Check a single permission. Returns { allowed, loading }.
 *
 * @param actionCode  Short action code, e.g. "A2", "M8", "V1"
 * @param boardId     Optional board UUID for board-scoped permission checks
 */
export function usePermission(
  actionCode: string,
  boardId?: string,
): { allowed: boolean; loading: boolean } {
  const { isLoading } = useAuth();
  const currentUser = useCurrentUser();

  const allowed = useMemo(
    () => checkPermission(currentUser, actionCode, boardId),
    [currentUser, actionCode, boardId],
  );

  return { allowed, loading: isLoading };
}

/**
 * Check multiple permissions at once.
 * Returns a Record mapping each action code to its allowed boolean.
 *
 * @param actionCodes  Array of action codes, e.g. ["A1", "A2", "M1"]
 * @param boardId      Optional board UUID for board-scoped checks
 */
export function usePermissions(
  actionCodes: string[],
  boardId?: string,
): Record<string, boolean> {
  const { isLoading } = useAuth();
  const currentUser = useCurrentUser();

  return useMemo(() => {
    // While loading, return all false to avoid premature renders
    if (isLoading) {
      return Object.fromEntries(actionCodes.map((code) => [code, false]));
    }
    return Object.fromEntries(
      actionCodes.map((code) => [code, checkPermission(currentUser, code, boardId)]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, boardId, isLoading, actionCodes.join(",")]);
}
