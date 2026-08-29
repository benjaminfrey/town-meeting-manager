/**
 * Stage 1, Task D1c — the one pre-tenant read in the invitation path.
 *
 * ─── Why a pre-tenant read exists at all ──────────────────────────────────
 *
 * Every other read in this application happens inside `withTenant`, which sets
 * `app.town_id` and lets row level security decide what is visible. Invitation
 * acceptance cannot start there: the caller has no `person` row, no
 * `user_account`, no session and therefore no town. The town is a property of
 * THE INVITATION BEING ACCEPTED, and the invitation is identified by a token.
 * So something has to turn a token into a town before any tenant context can
 * be opened, and that something is the security-critical part of this file.
 *
 * The shape is not new. `auth/tenant-context.ts` has the same problem for
 * sessions — it cannot read `user_account` before it knows a town — and solves
 * it by reading a hint out of `better_auth.user_tenant` (a schema with no RLS,
 * deliberately) and then verifying the hint inside `withTenant`. This is that,
 * for invitation tokens.
 *
 * ─── What this function guarantees ────────────────────────────────────────
 *
 *   1. It returns a TOWN ID AND NOTHING ELSE — never the invitation, the
 *      person, the email, the role or the status. Those are read afterwards,
 *      inside `withTenant`, where RLS is what decides.
 *
 *   2. It cannot be enumerated. `better_auth.invitation_tenant` is keyed on
 *      `sha256(token)`, so possessing the table is worth nothing, and the only
 *      lookup this module performs is equality on a full 32-byte digest. There
 *      is no prefix, range, wildcard or "list" form of this query, and adding
 *      one would be a visible change to this file.
 *
 *   3. It CANNOT GRANT ACCESS. This is the property that matters most, and it
 *      is why the two above are enough. The value returned here is a hint that
 *      is then USED, not trusted: the caller opens `withTenant(townId)` and
 *      reads `SELECT ... FROM invitation WHERE token = $1`. If the hint names
 *      the wrong town, RLS returns zero rows and the route answers 404. A
 *      corrupted or tampered hint table can therefore deny service to a
 *      specific token; it cannot disclose another town's row.
 *
 *   4. A token with no row resolves to `null`, and the caller stops. Absence
 *      is a refusal, not a fall-through to an unscoped query.
 *
 * ─── What this replaces ───────────────────────────────────────────────────
 *
 * `routes/invitations.ts` used to do this lookup through the service-role
 * Supabase client: `supabase.from("invitation").select(<every column>)
 * .eq("token", token)`, with RLS bypassed entirely. That is a general
 * cross-tenant read of a whole table, reachable from a public route, and the
 * only thing keeping it narrow was the filter the calling code happened to
 * write. `.eq("token", …)` and `.eq("town_id", …)` are the same API; a
 * one-word edit widened it. There is no such edit here — widening this means
 * changing the SQL below, the migration that grants the table, or both.
 */

import { sql } from "drizzle-orm";
import { toRows } from "./rows.js";

/**
 * The database surface this module needs: a top-level `execute`, outside any
 * transaction and outside any tenant context. Deliberately NOT the full
 * `TenantResolverDb` — nothing here opens a transaction, and a type that could
 * would invite someone to do the rest of the work in it.
 */
export interface InvitationBootstrapDb {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/**
 * Raised when the hint table answers with something impossible.
 *
 * Distinct from "no such token", which is `null` and an ordinary 404. This is
 * "the schema changed underneath this code" and must not be mistaken for a bad
 * token.
 */
export class InvitationBootstrapError extends Error {
  override readonly name = "InvitationBootstrapError";
}

interface HintRow {
  town_id: string;
}

/**
 * Resolve an invitation token to the town that issued it.
 *
 * Returns `null` when the token matches nothing — an unknown token, or one
 * whose invitation has been deleted. Callers must treat `null` as "no such
 * invitation" and stop; there is no wider query to fall back to.
 *
 * The token is hashed IN THE DATABASE rather than here, so the digest
 * convention lives in exactly one place — the trigger in
 * `drizzle/0002_invitation_tenant_bootstrap.sql` writes rows with
 * `sha256(convert_to(token,'UTF8'))` and this reads them with the same
 * expression. A mismatch between the two would silently resolve nothing, which
 * is the failure mode most worth designing out.
 */
export async function resolveInvitationTown(
  db: InvitationBootstrapDb,
  token: string,
): Promise<string | null> {
  // An empty token would hash to the digest of the empty string, which is a
  // perfectly good lookup key — and would match any invitation whose token was
  // somehow stored as "". Refusing here means that row, if it ever existed,
  // could not be reached by presenting nothing.
  if (typeof token !== "string" || token.length === 0) return null;

  const hints = toRows<HintRow>(
    await db.execute(sql`
      SELECT town_id
        FROM better_auth.invitation_tenant
       WHERE token_sha256 = sha256(convert_to(${token}, 'UTF8'))
    `),
    (message) => new InvitationBootstrapError(`invitation bootstrap: ${message}`),
  );

  if (hints.length === 0) return null;
  if (hints.length > 1) {
    // Unreachable while `token_sha256` is the primary key. Asserted anyway: if
    // a future migration drops that key, "exactly one town" would silently
    // become "whichever row the planner returned first", and this function
    // would start proposing a town at random.
    throw new InvitationBootstrapError(
      `invitation bootstrap: a token resolved to ${hints.length} towns, which the ` +
        "primary key on better_auth.invitation_tenant should make impossible. The " +
        "schema has changed underneath this code.",
    );
  }

  return String(hints[0]!.town_id);
}
