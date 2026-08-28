/**
 * `verifyAuth` and `requirePermission` — the route-level identity decorators.
 *
 * ─── Task G1: what changed here, and why it had to ────────────────────────
 *
 * Until this commit there were TWO authorities in one process on the question
 * "which town does this request belong to":
 *
 *   1. This file, which took `town_id`, `role` and `permissions` out of a
 *      base64-decoded JWT payload. `decodeJwtPayload` split the token on dots
 *      and JSON-parsed the middle segment. It verified NOTHING about that
 *      segment. The Supabase call above it proved the token was a real token;
 *      it proved nothing about the claims, which anyone holding any valid
 *      token could rewrite. `routes/invitations.ts` then authorised on the
 *      result — `if (inv.town_id !== user.townId) return reply.forbidden()` —
 *      which is a cross-tenant check settled by an attacker-editable field.
 *
 *   2. `auth/tenant-context.ts`, which resolves the same facts from Better
 *      Auth's session and then RE-READS them through row level security, so a
 *      stale or forged mapping resolves to nothing rather than to the wrong
 *      town.
 *
 * Two answers to that question is the thing G1 exists to end, so the first one
 * is gone: `decodeJwtPayload` is deleted, along with the `Authorization:
 * Bearer` path and the Supabase `auth.getUser` call. `verifyAuth` now reads
 * `request.tenant` — established by the C1 preHandler in `auth/fastify.ts`,
 * which is the only remaining way a request acquires a town — and loads role
 * and permissions from `user_account` INSIDE that tenant's context, so the
 * database itself is the thing that says what the row is.
 *
 * Nothing on `request.user` is now derived from anything the client sent.
 *
 * ─── Why `verifyAuth` still exists at all ─────────────────────────────────
 *
 * Since G1 the global preHandler already refuses every unmarked route without
 * a session, so `verifyAuth` is no longer what stands between an anonymous
 * request and a handler. What it still does is populate `request.user` —
 * `role` and `permissions`, which `requirePermission` needs and which tenant
 * resolution has no reason to fetch on requests that will never consult them.
 * It is a loader with an authentication assertion in front of it, kept under
 * the old name because seventeen call sites read clearly as-is and renaming
 * them would bury this change inside a diff about spelling.
 *
 * It is also, deliberately, still a guard and not just a loader: if a future
 * refactor makes `isPublicRoute` return true somewhere it should not, a route
 * with `verifyAuth` in its preHandler chain fails closed instead of running
 * with `request.user` undefined and a `!` assertion turning that into a crash
 * or, worse, into `undefined !== townId` passing a tenancy check.
 *
 * ─── The identity read is one query, inside the tenant transaction ────────
 *
 * `request.withTenant` opens a transaction with `app.town_id` already set, so
 * the `user_account` row comes back through the same RLS policy that guards
 * every other read. A row belonging to another town cannot be returned here
 * even if `userAccountId` were somehow wrong.
 */

import fp from "fastify-plugin";
import { sql } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@town-meeting/shared";
import { hasPermission, type PermissionAction, type PermissionsMatrix } from "@town-meeting/shared";
import { toRows } from "../db/rows.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface RequestUser {
  /**
   * `user_account.id` — NOT the auth provider's user id.
   *
   * Every call site already treated it that way (`invitations.ts` looks the
   * inviter up with `.eq("id", user.id)` against `user_account`;
   * `minutes.ts` writes it to `minutes_document.created_by`;
   * `notifications.ts` writes it to `push_subscription.user_account_id`). The
   * old implementation put the Supabase *auth* user id here, so all four were
   * relying on those two ids happening to coincide. They now cannot diverge,
   * because this is read from `user_account` itself.
   */
  id: string;
  personId: string | null;
  email: string;
  townId: string;
  role: UserRole;
  permissions: PermissionsMatrix;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: RequestUser;
  }
  interface FastifyInstance {
    verifyAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface UserAccountRow {
  id: string;
  person_id: string | null;
  role: string;
  permissions: unknown;
  email: string | null;
  person_email: string | null;
}

const VALID_ROLES = new Set<UserRole>(["sys_admin", "admin", "staff", "board_member"]);

const EMPTY_PERMISSIONS: PermissionsMatrix = {
  global: {} as PermissionsMatrix["global"],
  board_overrides: [],
};

/**
 * Coerce the `permissions` jsonb column into the shape `hasPermission` expects.
 *
 * The column defaults to `{"global": {}, "board_overrides": []}` and is NOT
 * NULL, but a row written before that default, or by a client that stored the
 * flat `{action: true}` shape the old JWT claim used, would otherwise reach
 * `hasPermission` as something it silently reads as "no permissions" or
 * crashes on. Anything unrecognised becomes an explicit empty matrix — deny —
 * rather than an optimistic guess.
 */
function toPermissionsMatrix(value: unknown): PermissionsMatrix {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_PERMISSIONS;
  const candidate = value as Partial<PermissionsMatrix>;
  return {
    global:
      candidate.global && typeof candidate.global === "object"
        ? candidate.global
        : EMPTY_PERMISSIONS.global,
    board_overrides: Array.isArray(candidate.board_overrides) ? candidate.board_overrides : [],
  };
}

// ─── Plugin ──────────────────────────────────────────────────────────

export const authPlugin = fp(async (fastify) => {
  fastify.decorate("verifyAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant;
    const runInTenant = request.withTenant;

    if (!tenant || !runInTenant) {
      // Reachable only if this route was marked public, or if the tenant
      // preHandler was not registered. Both are programming errors rather than
      // client errors, but answering 401 is the safe reading of either.
      return reply.unauthorized(
        "This endpoint requires a signed-in session with a resolved town. " +
          "If this route is marked `config: { ...PUBLIC_ROUTE }`, it must not " +
          "also use verifyAuth.",
      );
    }

    const rows = await runInTenant(async (tx) =>
      toRows<UserAccountRow>(
        await tx.execute(sql`
          SELECT ua.id,
                 ua.person_id,
                 ua.role::text AS role,
                 ua.permissions,
                 ua.email,
                 p.email AS person_email
          FROM user_account ua
          JOIN person p ON p.id = ua.person_id
          WHERE ua.id = ${tenant.userAccountId}
            AND ua.archived_at IS NULL
        `),
        (message) => new Error(`verifyAuth: ${message}`),
      ),
    );

    // `resolveTenant` already proved exactly one live account exists for this
    // session in this town, so zero rows here means the account was archived
    // between that read and this one. Refuse; do not fall back to a default.
    if (rows.length !== 1) {
      request.log.error(
        { userAccountId: tenant.userAccountId, townId: tenant.townId, found: rows.length },
        "verifyAuth found no live user_account for an already-resolved tenant",
      );
      return reply.unauthorized("Your account is no longer active.");
    }

    const row = rows[0]!;
    const role = row.role as UserRole;

    // An unknown role must not default to something permissive. The old code
    // fell back to "admin" when the JWT claim was missing, which meant a token
    // with no role claim was a full administrator.
    if (!VALID_ROLES.has(role)) {
      request.log.error(
        { userAccountId: row.id, role: row.role },
        "user_account.role is not a recognised role; refusing rather than assuming one",
      );
      return reply.forbidden("Your account has an unrecognised role.");
    }

    request.user = {
      id: String(row.id),
      personId: row.person_id === null ? null : String(row.person_id),
      email: row.email ?? row.person_email ?? "",
      townId: tenant.townId,
      role,
      permissions: toPermissionsMatrix(row.permissions),
    };
  });
});

// ─── Permission checks ───────────────────────────────────────────────

/**
 * Creates a preHandler that checks a specific permission.
 *
 * The action is typed as `PermissionAction`, so a string that is not one of
 * the thirty governable actions no longer compiles. It used to: `minutes.ts`
 * guarded minutes approval with `requirePermission("approve_minutes")`, which
 * is not an action any template can grant, so the check could only ever be
 * satisfied by the admin short-circuit. That failed closed and so was not a
 * hole, but it meant the route's stated policy and its actual policy differed
 * with nothing to catch it. See `requireAdmin` for what replaced it.
 *
 * Resolution is delegated to the shared `hasPermission`, which is what the web
 * client uses. The previous implementation did `user.permissions[action]` — a
 * flat lookup against a column whose shape is
 * `{global: {...}, board_overrides: [...]}`, so it read `undefined` for every
 * staff permission and never consulted a board override at all.
 */
export function requirePermission(action: PermissionAction) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      return reply.unauthorized("Not authenticated");
    }

    // `hasPermission` short-circuits `admin` but not `sys_admin`.
    if (user.role === "admin" || user.role === "sys_admin") {
      return;
    }

    if (!hasPermission(user.permissions, action, undefined, user.role)) {
      return reply.forbidden(`Missing permission: ${action}`);
    }
  };
}

/**
 * Creates a preHandler that admits only `admin` and `sys_admin`.
 *
 * For operations that are genuinely not delegable and have no matching entry
 * in the thirty governable actions. `reason` is required so the route says why
 * it is admin-only at the point where that is decided, rather than in a
 * comment that can drift away from it.
 */
export function requireAdmin(reason: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      return reply.unauthorized("Not authenticated");
    }
    if (user.role !== "admin" && user.role !== "sys_admin") {
      return reply.forbidden(`Administrators only: ${reason}`);
    }
  };
}
