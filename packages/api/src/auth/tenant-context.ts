/**
 * Stage 1, Task C1 — THE TENANT BRIDGE.
 *
 * Phase B made every table in `public` unreadable and unwritable until
 * `app.town_id` is set, and proved that model holds. Nothing set it. This file
 * is the one place a session becomes a tenant.
 *
 * ─── The single behaviour this file exists to get right ───────────────────
 *
 * **A session that resolves to no town THROWS. It never returns.**
 *
 * `get_current_town_id()` is
 * `nullif(current_setting('app.town_id', true), '')::uuid`. Unset or empty it
 * is NULL; `town_id = NULL` evaluates to NULL, not false; so every policy
 * matches nothing and every query returns zero rows **with no error anywhere**.
 * An authenticated user in that state gets a fully working application in
 * which their town appears to contain no meetings, no boards, no minutes and
 * no people — and there is nothing in a log, a status code or a query plan to
 * distinguish that from a town that genuinely has no data yet. It is the most
 * expensive failure this codebase can produce, because it looks like a
 * product question rather than a bug.
 *
 * `withTenant` already refuses a malformed `townId` for this reason. The step
 * in front of it has to refuse just as hard, because it is the step that can
 * *produce* an absent town.
 *
 * ─── How resolution works, and why it is two reads and not one ────────────
 *
 * 1. **The door-opener.** `better_auth.user_tenant` maps an identity to a
 *    town. It lives outside RLS because of a circularity: to scope a query by
 *    town you need `app.town_id`; to know the town you must resolve the
 *    session; to resolve the session you must read a table. Something has to
 *    be readable first, and this table — one identity, one town id, nothing
 *    else — is the smallest thing that can be.
 *
 * 2. **The verification.** The value from step 1 is treated as a HINT, never
 *    as the answer. `resolveTenant` opens a transaction scoped to it and
 *    re-reads `user_account` *through RLS*, joined to `person`. If the account
 *    was deleted, archived, or moved to a different town since the hint was
 *    written, that read returns zero rows inside the hinted town's context and
 *    this function throws.
 *
 * That is what keeps a denormalised copy from being a second source of truth.
 * `public.user_account.town_id` stays authoritative; the copy in
 * `better_auth.user_tenant` can only be right or be caught. It cannot quietly
 * win.
 *
 * The cost is one extra round trip per request. That is the correct trade: the
 * alternative — trusting the hint — is a table outside RLS that can silently
 * point a session at the wrong town, which is a cross-tenant disclosure in a
 * system holding executive-session minutes.
 */

import { sql, type SQL } from "drizzle-orm";
import { withTenant, type TenantContext, type TenantTx } from "../db/with-tenant.js";
import { toRows as normaliseRows } from "../db/rows.js";

/** What a resolved session is allowed to touch. */
export interface ResolvedTenant extends TenantContext {
  readonly townId: string;
  readonly personId: string;
  readonly userAccountId: string;
}

/**
 * Raised when an authenticated session cannot be mapped to exactly one town.
 *
 * A distinct type rather than a plain `Error` so callers can tell "this
 * session is authenticated but belongs nowhere" (a 403, and a loud log line)
 * apart from "the database is down" (a 500). The two need different responses
 * and, historically, get conflated into a generic handler that swallows both.
 */
export class TenantResolutionError extends Error {
  override readonly name = "TenantResolutionError";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** The minimum a session has to be for resolution to be attempted. */
export interface SessionLike {
  user: { id: string };
}

/**
 * The database surface this module needs: `withTenant`'s, plus a top-level
 * `execute` for the one read that must happen outside any tenant context.
 */
export interface TenantResolverDb {
  execute(query: SQL): Promise<unknown>;
  transaction<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
}

interface TenantHintRow {
  town_id: string;
}

interface AccountRow {
  user_account_id: string;
  person_id: string;
  town_id: string;
}

/**
 * Normalise a driver result into rows.
 *
 * The implementation moved to `db/rows.ts` in Task G1, because `plugins/auth.ts`
 * now performs the same kind of read and must not be mistaken for "no rows"
 * for the same reasons. See that file for the invariant; the only thing local
 * to this module is which error type a wrong shape raises.
 */
function toRows<T>(result: unknown): T[] {
  return normaliseRows<T>(result, (message) => new TenantResolutionError(message));
}

/**
 * Map an authenticated Better Auth session to exactly one town.
 *
 * @throws {TenantResolutionError} if the session is absent or malformed, if
 * the identity is not mapped to a town, or if the mapping disagrees with the
 * authoritative `user_account` row. It never returns a partial or empty
 * context — see this file's header for why that matters more than anything
 * else here.
 */
export async function resolveTenant(
  db: TenantResolverDb,
  session: SessionLike | null | undefined,
): Promise<ResolvedTenant> {
  const authUserId = session?.user?.id;
  if (typeof authUserId !== "string" || authUserId.length === 0) {
    throw new TenantResolutionError(
      "resolveTenant was called without a session. Callers must decide what an " +
        "unauthenticated request means — the public portal serves them, " +
        "authenticated routes reject them — and must not ask for a tenant to " +
        "find out.",
    );
  }

  // Step 1: the door-opener. Outside any tenant context, by necessity.
  const hints = toRows<TenantHintRow>(
    await db.execute(
      sql`SELECT town_id FROM better_auth.user_tenant WHERE auth_user_id = ${authUserId}`,
    ),
  );

  if (hints.length === 0) {
    throw new TenantResolutionError(
      `session for auth user ${authUserId} is not mapped to any town: no row in ` +
        "better_auth.user_tenant. The identity is authenticated but belongs to no " +
        "tenant — most likely sign-up completed and onboarding did not. Refusing " +
        "rather than continuing with no tenant context, which would silently " +
        "return zero rows from every table.",
    );
  }
  if (hints.length > 1) {
    // Unreachable while `auth_user_id` is the primary key. Asserted anyway: if
    // a future migration drops that key, "exactly one town" would silently
    // become "whichever row the planner returned first".
    throw new TenantResolutionError(
      `session for auth user ${authUserId} maps to ${hints.length} towns in ` +
        "better_auth.user_tenant, which its primary key should make impossible. " +
        "The schema has changed underneath this code.",
    );
  }

  const townId = String(hints[0]!.town_id);

  // Step 2: verify the hint against the authoritative, RLS-scoped truth.
  return withTenant(db, { townId }, async (tx) => {
    const accounts = toRows<AccountRow>(
      await tx.execute(sql`
        SELECT ua.id AS user_account_id, ua.person_id, ua.town_id
        FROM user_account ua
        JOIN person p ON p.id = ua.person_id
        WHERE ua.auth_user_id = ${authUserId}
          AND ua.archived_at IS NULL
      `),
    );

    if (accounts.length !== 1) {
      throw new TenantResolutionError(
        `session for auth user ${authUserId} claims town ${townId}, but that town ` +
          `has ${accounts.length} live user_account rows for it (expected exactly 1). ` +
          "The account was deleted, archived, or moved to another town since the " +
          "mapping in better_auth.user_tenant was written. Refusing rather than " +
          "handing back a context that reads as an empty town.",
      );
    }

    const row = accounts[0]!;

    // Belt and braces: RLS already guarantees this, since the query ran inside
    // `townId`'s context. Asserted so that a future policy change which widened
    // visibility could not turn this function into a cross-tenant read.
    if (String(row.town_id) !== townId) {
      throw new TenantResolutionError(
        `user_account ${row.user_account_id} resolved inside town ${townId} but ` +
          `reports town ${row.town_id}. Row level security should have made this ` +
          "impossible; the tenancy policy on user_account has changed.",
      );
    }

    return {
      townId,
      personId: String(row.person_id),
      userAccountId: String(row.user_account_id),
    };
  });
}
