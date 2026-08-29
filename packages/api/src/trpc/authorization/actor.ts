/**
 * Stage 1, Task D1 — who is asking.
 *
 * An `Actor` is everything the authorization rules are allowed to consult, and
 * nothing else. Every field on it is derived from the database inside the
 * caller's own tenant context — never from anything the client sent — so a
 * rule cannot be tricked by a forged body or a crafted header, and a reviewer
 * checking that property only has to read this file.
 *
 * There are exactly two ways to make one:
 *
 *   `loadActor(tx, tenant)`  — a signed-in member of a town.
 *   `anonymousActor(townId)` — the public portal, which has no account.
 *
 * The anonymous case is a first-class value rather than `null` or an empty
 * object. Rules take an `Actor`, so a portal path cannot forget to pass one
 * and get `undefined?.role` semantics; and `resolvePermission` refuses it by
 * an explicit branch rather than by its matrix happening to be empty.
 */

import { sql } from "drizzle-orm";
import type { TenantTx } from "../../db/with-tenant.js";
import { toRows } from "../../db/rows.js";

export type ActorRole = "sys_admin" | "admin" | "staff" | "board_member";

/**
 * The permissions JSONB exactly as the database stores it: keyed by ACTION
 * CODE (`A2`), not by action name (`edit_agenda`). See `permission.ts` for
 * why the distinction is the whole reason this phase exists.
 */
export interface PermissionMatrixByCode {
  global?: Record<string, boolean | null>;
  board_overrides?: Array<{
    board_id: string;
    permissions?: Record<string, boolean | null>;
  }>;
}

export interface Actor {
  /** `"anonymous"` is the public portal. It is never a signed-in identity. */
  readonly kind: "user" | "anonymous";
  /** The tenant this actor is acting inside. Always set — RLS requires it. */
  readonly townId: string;
  readonly role: ActorRole | null;
  /**
   * The PERSON, which is what subscriptions and board seats key on. Distinct
   * from `userAccountId`; conflating the two is how one person ends up
   * reading another's notification history (Phase B report §4b, rule 18).
   */
  readonly personId: string | null;
  readonly userAccountId: string | null;
  readonly permissions: PermissionMatrixByCode;
}

const VALID_ROLES: readonly string[] = ["sys_admin", "admin", "staff", "board_member"];

/** The portal's actor: inside a town, holding nothing. */
export function anonymousActor(townId: string): Actor {
  return {
    kind: "anonymous",
    townId,
    role: null,
    personId: null,
    userAccountId: null,
    permissions: {},
  };
}

export interface ActorTenant {
  townId: string;
  personId: string;
  userAccountId: string;
}

interface AccountRow {
  role: string;
  permissions: unknown;
}

/**
 * Read the actor's role and permissions matrix from `user_account`.
 *
 * `tx` must already be inside the tenant's context — this is called from
 * within `withTenant`, so the read is scoped by RLS as well as by the `id`
 * predicate. Both matter: the `id` narrows to one row, and RLS is what makes
 * a wrong id from another town return nothing rather than another town's
 * permissions.
 *
 * Throws when the row is missing or its role is unrecognised. Returning a
 * permissionless actor instead would be the quiet failure this codebase keeps
 * finding: every check would refuse, the application would look broken in an
 * unexplainable way, and the eventual "fix" would be to remove the check.
 */
export async function loadActor(tx: TenantTx, tenant: ActorTenant): Promise<Actor> {
  const rows = toRows<AccountRow>(
    await tx.execute(sql`
      SELECT role::text AS role, permissions
      FROM user_account
      WHERE id = ${tenant.userAccountId}
        AND town_id = ${tenant.townId}
        AND archived_at IS NULL
    `),
    (message) => new Error(`loadActor: ${message}`),
  );

  if (rows.length !== 1) {
    throw new Error(
      `loadActor: user_account ${tenant.userAccountId} resolved to ${rows.length} rows ` +
        `inside town ${tenant.townId} (expected exactly 1). The account was archived or ` +
        "moved since the session was resolved. Refusing rather than continuing with an " +
        "actor that holds nothing, which would refuse every action for a reason no log " +
        "line would explain.",
    );
  }

  const row = rows[0]!;
  if (!VALID_ROLES.includes(row.role)) {
    throw new Error(
      `loadActor: user_account ${tenant.userAccountId} has role ${JSON.stringify(row.role)}, ` +
        `which is not one of ${VALID_ROLES.join(", ")}.`,
    );
  }

  return {
    kind: "user",
    townId: tenant.townId,
    role: row.role as ActorRole,
    personId: tenant.personId,
    userAccountId: tenant.userAccountId,
    permissions: toPermissionMatrixByCode(row.permissions),
  };
}

/**
 * Coerce whatever the driver handed back into the matrix shape.
 *
 * `postgres.js` parses `jsonb` into an object; a `text`-typed column or a
 * different driver hands back a string. Both are accepted; anything else
 * becomes an empty matrix, which denies. Deliberately NOT throwing here: an
 * account whose matrix is `null` is a real and legitimate state (every board
 * member has one), and it means "holds nothing", not "the database is broken".
 *
 * Exported because `plugins/auth.ts` reads the same column on the legacy
 * Fastify path and must reach the same value from the same bytes. It used to
 * carry its own copy of this, and the copy had drifted into declaring the
 * result NAME-keyed when the column is frequently code-keyed — which is the
 * whole of Task D1c. One coercion, one shape, two readers.
 */
export function toPermissionMatrixByCode(value: unknown): PermissionMatrixByCode {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const candidate = parsed as PermissionMatrixByCode;
  return {
    global:
      candidate.global && typeof candidate.global === "object" && !Array.isArray(candidate.global)
        ? candidate.global
        : {},
    board_overrides: Array.isArray(candidate.board_overrides) ? candidate.board_overrides : [],
  };
}
