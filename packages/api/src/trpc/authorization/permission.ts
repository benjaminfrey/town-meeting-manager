/**
 * Stage 1, Task D1 — permission resolution, keyed on ACTION CODES.
 *
 * ─── Why codes, and why that is the whole bug ─────────────────────────────
 *
 * There are two representations of the same thirty governable actions:
 *
 *   the CODE   `A2`          — what the database stores
 *   the NAME   `edit_agenda` — what the shared TypeScript resolves
 *
 * `supabase/seed.sql` writes `{"global": {"A1": true, "A2": true, …}}`, and so
 * does the permissions UI. `packages/shared/src/utils/permissions.ts` takes a
 * `PermissionAction`, which is the NAME. Feed a code-keyed matrix to a
 * name-keyed lookup and every answer is `false` — or, if a caller "fixes" it
 * by passing the name through to a code-keyed matrix, every answer is `false`
 * again. Authorization that always says no looks like authorization that
 * works, right up until someone notices nothing is ever allowed and removes
 * the check.
 *
 * The removed RLS helpers (`supabase/migrations/20260308000027_…`) were
 * code-keyed and correct. So this module is code-keyed too, and the
 * translation to the shared resolver happens in exactly one place —
 * `toNameKeyedMatrix` below — with a test on it.
 *
 * ─── Why it delegates to the shared resolver instead of reimplementing ────
 *
 * `packages/web` decides which controls to render with the shared
 * `hasPermission`. If the API resolved permissions by a second algorithm, the
 * two would drift, and the drift would show up as a control the user can see
 * and click that answers 403 — or, worse, a control the UI hides that the API
 * would have allowed, which is a permission the town believes it granted and
 * cannot use. One algorithm, one place, two callers.
 *
 * What this module adds on top is what the shared function does not cover,
 * each stated explicitly rather than left to fall through:
 *
 *   - **anonymous** — the public portal has no account at all. It resolves to
 *     `false` for every code, and it is a distinct branch rather than "an
 *     actor whose matrix happens to be empty", because an empty matrix that
 *     someone later defaults to `{}` would silently start granting.
 *   - **sys_admin** — the shared function handles `admin` and stops, so a
 *     sys_admin falls into the staff branch and is denied by accident. The
 *     removed `has_permission()` denied sys_admin ON PURPOSE (a platform
 *     operator is not a town clerk), and "denied on purpose" and "denied
 *     because nobody thought about it" are the same behaviour today and
 *     different behaviours the moment someone edits either one.
 *
 * ─── The board argument, and why passing `undefined` is not fail-closed ───
 *
 * `resolvePermission` takes an optional `boardId` and uses it. An override
 * can GRANT (board-specific staff, who hold nothing globally) or REVOKE
 * (a clerk barred from one board). Dropping the board id ignores both:
 * the first caller is wrongly refused, the second is wrongly ALLOWED. So a
 * board-scoped rule must supply the board, and `rules.ts` is written so that
 * the board-scoped guards cannot be called without one.
 */

import {
  PERMISSIONS,
  type PermissionAction,
  type PermissionsMatrix,
  hasPermission,
} from "@town-meeting/shared";
import type { Actor, PermissionMatrixByCode } from "./actor.js";

/** The thirty action codes, in advisory 1.2's order. */
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export type PermissionCode = keyof typeof PERMISSIONS;

/** Codes a board member holds by virtue of the role, never by configuration. */
const BOARD_MEMBER_ALWAYS_CODES: readonly PermissionCode[] = ["A4", "A7", "M8"];

/**
 * Raised when a caller is refused.
 *
 * A named type, not a bare `Error`, for the same reason `TenantResolutionError`
 * is: a refusal is a 403 and a log line a support person can act on, while a
 * driver error is a 500. Conflating them produces an application that answers
 * "something went wrong" to a misconfigured permission, which is the single
 * hardest class of bug for a town clerk to report usefully.
 */
export class AuthorizationError extends Error {
  override readonly name = "AuthorizationError";
  /** The action code that was required, when the rule is code-keyed. */
  readonly permissionCode?: PermissionCode;
  /** The board the check was scoped to, when it was board-scoped. */
  readonly boardId?: string;

  constructor(message: string, options: { code?: PermissionCode; boardId?: string } = {}) {
    super(message);
    this.permissionCode = options.code;
    this.boardId = options.boardId;
  }
}

/** True only for the town `admin` role — mirrors the removed `is_admin()`. */
export function isAdmin(actor: Actor): boolean {
  return actor.role === "admin";
}

/**
 * True for the `board_member` role.
 *
 * Three of the restored rules turn on the ROLE rather than on any code
 * (`exhibit_select`'s board_only tier, `exhibit_insert`, `vote_record_insert`),
 * exactly as `get_current_role() = 'board_member'` did in the policies.
 */
export function isBoardMember(actor: Actor): boolean {
  return actor.role === "board_member";
}

/**
 * Translate a code-keyed matrix into the name-keyed shape the shared resolver
 * expects.
 *
 * Unknown keys are DROPPED rather than passed through. A matrix that already
 * contained names, or that contained a typo, would otherwise arrive at the
 * shared resolver looking authoritative; dropping means the answer is `false`,
 * which is the safe direction and is also what the database did with an
 * unrecognised code.
 */
export function toNameKeyedMatrix(matrix: PermissionMatrixByCode): PermissionsMatrix {
  const translate = (
    source: Record<string, boolean | null | undefined> | undefined,
  ): Record<PermissionAction, boolean> => {
    const out = {} as Record<PermissionAction, boolean>;
    if (!source) return out;
    for (const [code, value] of Object.entries(source)) {
      const name = PERMISSIONS[code as PermissionCode] as PermissionAction | undefined;
      if (!name) continue;
      out[name] = value === true;
    }
    return out;
  };

  return {
    global: translate(matrix.global),
    board_overrides: (matrix.board_overrides ?? []).map((override) => ({
      board_id: String(override.board_id),
      permissions: translate(override.permissions),
    })),
  };
}

/**
 * Does `actor` hold `code` — for `boardId`, when the rule is board-scoped?
 *
 * Mirrors the removed `has_board_permission(code, board)`: admin yes,
 * sys_admin no, then the board override for that board if it names the code,
 * then the global grant.
 */
export function resolvePermission(
  actor: Actor,
  code: PermissionCode,
  boardId?: string,
): boolean {
  // The public portal. No account, so no permission — stated as its own
  // branch so that it can never become "an actor with an empty matrix".
  if (actor.kind === "anonymous") return false;

  // Admin short-circuits, including the four non-delegable T-codes.
  if (actor.role === "admin") return true;

  // The explicit branch the shared resolver lacks. A platform operator
  // administers the deployment; they are not a clerk of any town and hold no
  // operational permission in one. `has_permission()` said so; saying it here
  // keeps a future edit to the shared function from silently changing it.
  if (actor.role === "sys_admin") return false;

  // Board members hold three codes by role and nothing by configuration. The
  // database fell through to the (normally empty) matrix here; resolving from
  // the role instead is both what the product means and the narrower of the
  // two, since a board member with a stray staff grant in their JSONB is
  // refused rather than allowed.
  if (actor.role === "board_member") {
    return BOARD_MEMBER_ALWAYS_CODES.includes(code);
  }

  const action = PERMISSIONS[code] as PermissionAction | undefined;
  if (!action) return false;

  // Only `staff` reaches here: admin, sys_admin, board_member and anonymous
  // all returned above. Anything else is a role this file has not been taught
  // about, and the safe answer to an unknown role is no.
  if (actor.role !== "staff") return false;

  return hasPermission(toNameKeyedMatrix(actor.permissions), action, boardId, actor.role);
}

/** Throw unless `actor` holds `code`. */
export function assertPermission(
  actor: Actor,
  code: PermissionCode,
  options: { boardId?: string; action?: string } = {},
): void {
  if (resolvePermission(actor, code, options.boardId)) return;
  const scope = options.boardId ? ` for board ${options.boardId}` : "";
  const what = options.action ? ` ${options.action}` : "";
  throw new AuthorizationError(
    `This account does not have permission${what}. It requires ${code} ` +
      `(${PERMISSIONS[code]})${scope}. A town administrator can grant it under ` +
      "Settings → People.",
    { code, boardId: options.boardId },
  );
}

/** Throw unless `actor` is a town administrator. */
export function assertAdmin(actor: Actor, action: string): void {
  if (isAdmin(actor)) return;
  throw new AuthorizationError(
    `Only a town administrator can ${action}. This is one of the governance ` +
      "actions (T1–T4) that cannot be delegated to a staff account.",
  );
}

/** Throw unless `actor` is a signed-in member of the town. */
export function assertSignedIn(actor: Actor, action: string): void {
  if (actor.kind === "user") return;
  throw new AuthorizationError(`Signing in is required to ${action}.`);
}
