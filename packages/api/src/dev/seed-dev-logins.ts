/**
 * Give each seeded `user_account` a Better Auth identity.
 *
 * `packages/api/drizzle/seed/seed.sql` creates towns, people and accounts but no
 * logins — it never did, and the logins developers actually used lived in the
 * Supabase stack's `docker/volumes/db/data`, which Phase F retires. This is
 * their replacement.
 *
 * The sequence is the one `POST /api/invitations/accept` performs, for the same
 * reason: an identity that is created but not linked authenticates and is then
 * refused on every request by the tenant bridge.
 *
 *   1. sign up            — OUTSIDE any tenant transaction (Better Auth owns it)
 *   2. mark verified      — no invitation email exists to click here
 *   3. link the account   — user_account.auth_user_id, inside withTenant
 *   4. bridge the tenant  — better_auth.user_tenant, inside the same transaction
 *
 * ─── `townId` is required, not discovered ──────────────────────────────────
 *
 * `public.user_account` and `public.person` are under FORCE ROW LEVEL
 * SECURITY (`0000_baseline.sql` § 3), which binds the table OWNER too, so
 * there is no way to find "every account with no login yet" by reading them
 * with no tenant context set — that read returns zero rows, silently, for
 * anyone who is not a superuser. An earlier version of this function tried to
 * work around that by toggling `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY`
 * for the length of the read. That is wrong: if anything between the two
 * ALTERs throws — a Better Auth sign-up failure, a duplicate email, a dropped
 * connection — FORCE stays off on both tables in that developer's database,
 * silently, with no error pointing at it; it also demands a table-owner
 * connection, a higher privilege than anything else in this codebase needs
 * outside a migration; and `db/__tests__/schema-invariants.test.ts` pins
 * FORCE on every table in `public`, so a bug that leaves it off surfaces as a
 * confusing failure in an unrelated suite.
 *
 * The fix is to not need cross-tenant discovery at all: `townId` is a
 * required parameter, and the discovery read runs inside `withTenant`, scoped
 * to it, exactly like the linking writes already are. No privilege beyond
 * what `resolveTenant()` itself needs (the `tmm_app` runtime role) is ever
 * required.
 *
 * Dev-only. Never import this from application code.
 */
import { sql } from "drizzle-orm";
import { withTenant } from "../db/with-tenant.js";
import type { TenantResolverDb } from "../auth/tenant-context.js";
import { toRows } from "../db/rows.js";
import type { createAuth } from "../auth/auth.js";

/**
 * The one town `packages/api/drizzle/seed/seed.sql` creates (Newcastle, ME).
 * Callers pass whichever town id they want logins seeded for; this is the
 * one this repository's seed actually creates.
 */
export const SEED_TOWN_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

export interface SeededLogin {
  email: string;
  userAccountId: string;
  authUserId: string;
}

interface PendingRow {
  user_account_id: string;
  email: string;
  name: string;
}

export async function seedDevLogins(
  db: TenantResolverDb,
  auth: ReturnType<typeof createAuth>,
  password: string,
  townId: string,
): Promise<SeededLogin[]> {
  // Accounts in `townId` with no identity yet. Scoped by a real tenant
  // transaction — see the header for why this cannot be a cross-tenant read.
  const pending = await withTenant(db, { townId }, async (tx) =>
    toRows<PendingRow>(
      await tx.execute(sql`
        SELECT ua.id AS user_account_id, p.email, p.name
          FROM user_account ua
          JOIN person p ON p.id = ua.person_id
         WHERE ua.auth_user_id IS NULL
           AND p.email IS NOT NULL
         ORDER BY p.email
      `),
      (message) => new Error(`seedDevLogins: ${message}`),
    ),
  );

  const seeded: SeededLogin[] = [];

  for (const row of pending) {
    const created = await auth.api.signUpEmail({
      body: { email: row.email, password, name: row.name },
    });
    const authUserId = created.user.id;

    try {
      await withTenant(db, { townId }, async (tx) => {
        await tx.execute(
          sql`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${authUserId}`,
        );
        const linked = toRows<{ id: string }>(
          await tx.execute(sql`
            UPDATE user_account
               SET auth_user_id = ${authUserId}, email = ${row.email}
             WHERE id = ${row.user_account_id}::uuid
               AND auth_user_id IS NULL
            RETURNING id
          `),
          (message) => new Error(`seedDevLogins: ${message}`),
        );
        if (linked.length !== 1) {
          throw new Error(
            `seedDevLogins: expected to link exactly 1 user_account, matched ${linked.length} ` +
              `for ${row.email}. An identity now exists that nothing points at.`,
          );
        }
        await tx.execute(sql`
          INSERT INTO better_auth.user_tenant (auth_user_id, town_id)
          VALUES (${authUserId}, ${townId}::uuid)
        `);
      });
    } catch (err) {
      // ─── The compensating delete ─────────────────────────────────────
      //
      // Mirrors `POST /api/invitations/accept` (routes/invitations.ts). The
      // transaction rolled back, so `user_account` is untouched — but the
      // Better Auth identity created above is OUTSIDE it and survives. Left
      // alone, a re-run of this script would rediscover the same pending
      // `user_account` row, call `signUpEmail` for the same email again, and
      // get `USER_ALREADY_EXISTS` — a stack trace naming a duplicate email
      // and nothing about the real, underlying failure, with no way out but
      // hand-editing the database.
      //
      // Deleting it puts the world back where it was. It is safe precisely
      // because it is unreachable: nothing links to it (that is what just
      // failed), it has never been signed into, and `user_account.auth_user_id`
      // is ON DELETE SET NULL so no historical record could be taken with it.
      await db
        .execute(sql`DELETE FROM better_auth."user" WHERE id = ${authUserId}`)
        .catch((cleanupErr: unknown) => {
          console.error(
            `seedDevLogins: could not remove the orphaned identity ${authUserId} for ` +
              `${row.email} after a failed link; a retry will report the email as ` +
              "already registered until it is deleted by hand.",
            cleanupErr,
          );
        });

      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `seedDevLogins: failed to link user_account ${row.user_account_id} (${row.email}): ` +
          `${message}`,
        { cause: err },
      );
    }

    seeded.push({ email: row.email, userAccountId: row.user_account_id, authUserId });
  }

  return seeded;
}
