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
import { PERMISSIONS, type PermissionAction } from "@town-meeting/shared";
import { toRows } from "../db/rows.js";
import {
  toPermissionMatrixByCode,
  type Actor,
  type PermissionMatrixByCode,
} from "../trpc/authorization/actor.js";
import {
  isAdmin,
  resolvePermission,
  type PermissionCode,
} from "../trpc/authorization/permission.js";

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
  /**
   * The matrix EXACTLY as `user_account.permissions` stores it — which is
   * keyed by action CODE (`A2`) for every account the seed wrote and by
   * action NAME (`edit_agenda`) for every account the product itself created.
   *
   * It used to be typed `PermissionsMatrix`, i.e. name-keyed, which was a
   * claim the column does not honour: a code-keyed row reached `hasPermission`
   * as a matrix with no recognisable keys and resolved to `false` for all
   * thirty actions. The type now says what the bytes are, so the translation
   * has to happen at the point of resolution — `resolvePermission` — and
   * cannot be skipped by a caller who mistakes one shape for the other.
   */
  permissions: PermissionMatrixByCode;
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
      permissions: toPermissionMatrixByCode(row.permissions),
    };
  });
});

// ─── Permission checks ───────────────────────────────────────────────

/**
 * Build the `Actor` the authorization layer resolves against.
 *
 * Every field comes from `request.user`, which `verifyAuth` filled from
 * `user_account` inside the caller's own tenant transaction — so nothing here
 * is derived from anything the client sent, and the legacy Fastify path feeds
 * `resolvePermission` exactly the same inputs the tRPC path does.
 */
function actorFromRequestUser(user: RequestUser): Actor {
  return {
    kind: "user",
    townId: user.townId,
    role: user.role,
    personId: user.personId,
    userAccountId: user.id,
    permissions: user.permissions,
  };
}

/** Action NAME → action CODE. `resolvePermission` is keyed on the code. */
const CODE_BY_ACTION = new Map<PermissionAction, PermissionCode>(
  (Object.entries(PERMISSIONS) as Array<[PermissionCode, PermissionAction]>).map(
    ([code, action]) => [action, code],
  ),
);

/**
 * Creates a preHandler that checks a specific permission.
 *
 * ─── Task D1c: this now answers what the authorization layer answers ──────
 *
 * The five surviving Fastify route files (`documents.ts`, `minutes.ts`,
 * `notifications.ts`, `invitations.ts`, `portal.ts`) authorize through here,
 * and until this commit it decided two things differently from
 * `trpc/authorization/permission.ts`, which is the layer Phase E migrates them
 * onto:
 *
 *   1. It short-circuited `admin || sys_admin` to ALLOW. The removed
 *      `has_permission()` denied `sys_admin` ON PURPOSE — its own comment said
 *      "sys_admin has no meeting management permissions" — and
 *      `resolvePermission` denies it as an explicit branch. A platform
 *      operator held every permission these routes guard, confined to their
 *      own town but including `requireAdmin("approving minutes")`, which is
 *      adopting a town's minutes.
 *
 *   2. It took an action NAME and resolved it against a matrix that was passed
 *      through verbatim — and `user_account.permissions` is code-keyed for
 *      every account `supabase/seed.sql` wrote. So for every non-admin it
 *      answered `false` unconditionally. That failed closed and was never a
 *      disclosure, but it meant the route's stated policy and its actual
 *      policy differed, and that the short-circuit in (1) was the WHOLE of the
 *      authorization on these routes.
 *
 * Both are now one call to `resolvePermission`, which is the same function the
 * tRPC procedures use: it denies `sys_admin`, and it normalises BOTH spellings
 * of the stored matrix before resolving. Two paths, one algorithm — so
 * migrating a route in Phase E cannot silently change who may call it.
 *
 * The action stays typed as `PermissionAction`, so a string that is not one of
 * the thirty governable actions still does not compile. It used to:
 * `minutes.ts` guarded minutes approval with `requirePermission(
 * "approve_minutes")`, which no template can grant, so only the admin
 * short-circuit could satisfy it. See `requireAdmin` for what replaced it.
 *
 * ─── What this deliberately does NOT do ──────────────────────────────────
 *
 * It performs a GLOBAL check — no board id, because a Fastify preHandler runs
 * before any body parsing this API does and has no board to scope to. For
 * A6/R1/R2/R3 — four of the five codes these routes guard — that is not
 * fail-closed: the shipped `designated_boards` permission templates grant
 * those codes per board with global all-false, so a global check ignores an
 * override that REVOKES one for a board, and allows a caller who should be
 * refused. `trpc/trpc.ts` refuses a board-scoped code at module load for
 * exactly this reason; this path cannot, because it has nowhere to get the
 * board from. Recorded here rather than fixed here: giving these routes a
 * board id is the route migration, not a change to the guard.
 */
export function requirePermission(action: PermissionAction) {
  const code = CODE_BY_ACTION.get(action);
  if (!code) {
    // Unreachable through the type, so this is a guard against `PERMISSIONS`
    // and `PermissionAction` drifting apart rather than against a caller.
    throw new Error(
      `requirePermission(${JSON.stringify(action)}) is not one of the thirty governable ` +
        "actions in PERMISSIONS. Refusing to build a check that can never be satisfied.",
    );
  }

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      return reply.unauthorized("Not authenticated");
    }

    if (!resolvePermission(actorFromRequestUser(user), code)) {
      return reply.forbidden(`Missing permission: ${action}`);
    }
  };
}

/**
 * Creates a preHandler that admits only the town `admin` role.
 *
 * For operations that are genuinely not delegable and have no matching entry
 * in the thirty governable actions. `reason` is required so the route says why
 * it is admin-only at the point where that is decided, rather than in a
 * comment that can drift away from it.
 *
 * `sys_admin` is NOT admitted, and was until Task D1c. The removed `is_admin()`
 * was strictly `role = 'admin'` and `assertAdmin` in the authorization layer
 * mirrors it exactly; a platform operator administers the deployment and is
 * not an officer of any town.
 */
export function requireAdmin(reason: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      return reply.unauthorized("Not authenticated");
    }
    if (!isAdmin(actorFromRequestUser(user))) {
      return reply.forbidden(`Administrators only: ${reason}`);
    }
  };
}
