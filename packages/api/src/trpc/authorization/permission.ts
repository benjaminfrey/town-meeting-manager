/**
 * Stage 1, Task D1 — permission resolution, keyed on ACTION CODES.
 *
 * ─── Two spellings, and why that was the whole bug ───────────────────────
 *
 * The same thirty governable actions are written two ways:
 *
 *   the CODE   `A2`
 *   the NAME   `edit_agenda`
 *
 * BOTH are in the database, written by different parts of this product:
 *
 *   - `supabase/seed.sql:116` writes CODES.
 *   - `StaffAccountFlow.tsx:86,104` builds the matrix with
 *     `buildPermissionsFromTemplate()`, which returns
 *     `Record<PermissionAction, boolean>` — NAMES — and
 *     `AddPersonDialog.tsx:117` / `AddMemberDialog.tsx:423` persist it
 *     verbatim. Every staff account created through the product is
 *     name-keyed. The shared `PermissionsMatrix` type declares names too.
 *
 * A reader that speaks one spelling resolves the other to an empty matrix and
 * denies everything. That is fail-closed and so never a disclosure — but it is
 * a silent, total outage of whichever half of the data it does not speak, and
 * this codebase has now shipped it in BOTH directions. The removed
 * `has_permission()` SQL was code-only. D1'''s first authorization layer was
 * code-only too, on the strength of the seed file alone, and would have denied
 * every staff account the product itself creates.
 *
 * So the reader accepts both, in ONE place — `normalisePermissionsMatrix` in
 * `packages/shared` — which both this module and the web client use. A matrix
 * carrying both spellings of one action in disagreement resolves to DENY,
 * because the alternative makes the answer depend on JSON key order. See that
 * function'''s own comment.
 *
 * Storage should eventually converge on one spelling; that is a data migration
 * plus a change to the writers, and it is deliberately not this task. Until it
 * happens, converging the READER is what keeps the two halves of the system
 * from disagreeing about who may do what.
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
  normalisePermissionsMatrix,
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
 * Normalise the stored matrix into the name-keyed shape the shared resolver
 * takes, accepting either spelling.
 *
 * A thin delegation on purpose: the mapping between the two spellings is a
 * fact about the product'''s data, not about this API, and the web client needs
 * exactly the same translation before it calls `hasPermission` to decide which
 * controls to render. Two copies would drift, and the drift shows up as a
 * control the UI hides that the API would have allowed.
 */
export function toNameKeyedMatrix(matrix: PermissionMatrixByCode): PermissionsMatrix {
  return normalisePermissionsMatrix(matrix);
}

/**
 * Does `actor` hold `code` — for `boardId`, when the rule is board-scoped?
 *
 * Mirrors the removed `has_board_permission(code, board)`: admin yes,
 * sys_admin no, then the board override for that board if it names the code,
 * then the global grant.
 */
export function resolvePermission(actor: Actor, code: PermissionCode, boardId?: string): boolean {
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

  // Board members hold three codes by role and nothing by configuration.
  //
  // This is NOT uniformly narrower than the database, and the earlier comment
  // here wrongly said it was. `has_permission()` fell through to the (normally
  // empty) matrix for a board member, so it returned false for all thirty
  // codes. For the other twenty-seven this branch is indeed narrower — a board
  // member with a stray staff grant in their JSONB is refused rather than
  // allowed. For A4, A7 and M8 it is WIDER: the database said no, this says
  // yes, matching `BOARD_MEMBER_ALWAYS_ACTIONS` and the product'''s stated
  // design that those three come with the seat.
  //
  // Nothing among the 21 rules consults A4, A7 or M8 — the policies that
  // needed them tested `get_current_role() = 'board_member'` directly, and so
  // do rules 14 and 15 — so the widening changes no current answer. It is
  // recorded rather than left implied because "wider than the thing you are
  // restoring" is exactly the claim that should never be silent.
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
