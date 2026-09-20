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
 * `db` must be a connection that owns the tables it seeds — `tmm_owner` in
 * every real environment, matching `scripts/dev/reset-local-db.sh` — because
 * discovering which towns need logins (below) briefly drops FORCE ROW LEVEL
 * SECURITY on two tables, and only the table owner may do that. It is never
 * the `tmm_app` runtime role a real HTTP request authenticates as.
 *
 * Dev-only. Never import this from application code.
 */
import { sql } from "drizzle-orm";
import { withTenant } from "../db/with-tenant.js";
import type { TenantResolverDb } from "../auth/tenant-context.js";
import { toRows } from "../db/rows.js";
import type { createAuth } from "../auth/auth.js";

export interface SeededLogin {
  email: string;
  userAccountId: string;
  authUserId: string;
}

interface PendingRow {
  user_account_id: string;
  town_id: string;
  email: string;
  name: string;
}

export async function seedDevLogins(
  db: TenantResolverDb,
  auth: ReturnType<typeof createAuth>,
  password: string,
): Promise<SeededLogin[]> {
  // Accounts with no identity yet, across every town in the seed. There is no
  // tenant context to scope this by yet — discovering which towns exist is
  // the whole problem — and `public.user_account`/`public.person` are under
  // FORCE ROW LEVEL SECURITY (0000_baseline.sql § 3), which binds the table
  // OWNER too. A plain cross-tenant SELECT here is not "deliberately outside
  // a tenant context" the way reading `better_auth.user_tenant` is elsewhere
  // in this codebase (tenant-context.ts, invitation-bootstrap.ts) — those
  // tables carry no RLS at all. `person`/`user_account` do, so an unscoped
  // read of them returns zero rows for anyone but a superuser — verified
  // directly against this schema, and independently documented for the same
  // shape of problem in
  // `packages/api/drizzle/0002_invitation_tenant_bootstrap.sql`'s backfill
  // ("a plain SELECT here would read zero rows... the wrong answer, with
  // nothing to notice").
  //
  // The fix is that migration's own fix: drop FORCE for the length of this
  // one read and restore it immediately after, in a `finally` so a throw
  // mid-read cannot leave it off. That needs table-OWNER privilege — this
  // script is meant to run as `tmm_owner` (see `scripts/dev/reset-local-db.sh`
  // in the Phase F plan), never as the `tmm_app` runtime role a real request
  // authenticates as. A lesser role gets a loud `must be owner of table`
  // instead of a silent empty result, which is the correct failure here.
  await db.execute(sql`ALTER TABLE public.user_account NO FORCE ROW LEVEL SECURITY`);
  await db.execute(sql`ALTER TABLE public.person NO FORCE ROW LEVEL SECURITY`);
  let pending: PendingRow[];
  try {
    pending = toRows<PendingRow>(
      await db.execute(sql`
        SELECT ua.id AS user_account_id, ua.town_id, p.email, p.name
          FROM user_account ua
          JOIN person p ON p.id = ua.person_id
         WHERE ua.auth_user_id IS NULL
           AND p.email IS NOT NULL
         ORDER BY p.email
      `),
      (message) => new Error(`seedDevLogins: ${message}`),
    );
  } finally {
    await db.execute(sql`ALTER TABLE public.user_account FORCE ROW LEVEL SECURITY`);
    await db.execute(sql`ALTER TABLE public.person FORCE ROW LEVEL SECURITY`);
  }

  const seeded: SeededLogin[] = [];

  for (const row of pending) {
    const created = await auth.api.signUpEmail({
      body: { email: row.email, password, name: row.name },
    });
    const authUserId = created.user.id;

    await withTenant(db, { townId: row.town_id }, async (tx) => {
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
        VALUES (${authUserId}, ${row.town_id}::uuid)
      `);
    });

    seeded.push({ email: row.email, userAccountId: row.user_account_id, authUserId });
  }

  return seeded;
}
