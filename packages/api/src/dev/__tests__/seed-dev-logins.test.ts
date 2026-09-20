/**
 * `seedDevLogins` gives each seeded `user_account` a Better Auth identity, so a
 * developer can sign in after a bootstrap. It replaces the GoTrue accounts that
 * lived in `docker/volumes/db/data`, which no seed ever recreated.
 *
 * The assertion that matters is the last one: a real sign-in. Linking rows
 * without a working sign-in is the failure this test exists to catch.
 *
 * ─── Why this calls `seedDevLogins` on the OWNER connection, not `tmm_app` ──
 *
 * The brief this test was written from originally wired `seedDevLogins` up
 * through `connectAsAppRole()` (the `tmm_app` runtime role `resolveTenant()`
 * uses for real requests). That does not work, and cannot be made to: the
 * function's first job is finding every seeded account with no login yet
 * *before* any tenant context exists, which means reading `user_account`
 * joined to `person` with no `app.town_id` set. Both tables are under FORCE
 * ROW LEVEL SECURITY (`0000_baseline.sql` § 3), which binds the table OWNER
 * too, so that read returns zero rows for ANY role that is not a superuser —
 * verified directly against this schema, and independently documented for the
 * exact same shape of problem in
 * `packages/api/drizzle/0002_invitation_tenant_bootstrap.sql`'s backfill.
 * `seed-dev-logins.ts` fixes it the way that migration did: drop FORCE for the
 * length of the one read, then restore it — which needs table-OWNER
 * privilege, not `tmm_app`'s.
 *
 * That also matches how this script is actually meant to run:
 * `scripts/dev/reset-local-db.sh` (Phase F, Task 3) invokes it with
 * `DATABASE_URL` pointed at `tmm_owner`, never at the `tmm_app` credential a
 * live request authenticates as. `withTestDb`'s own connection stands in for
 * that owner role here — see its header for why it is a superuser locally and
 * in CI, and why that is fine for this test: the property this file checks is
 * "the sequence leaves a real, working sign-in", not tenant isolation, which
 * `db/__tests__/tenant-isolation.test.ts` already owns and already runs on the
 * `tmm_app` connection this test does not need.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { withTestDb } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { seedDevLogins } from "../seed-dev-logins.js";

// Task 1 moved the seed to `drizzle/seed/seed.sql` (beside the schema it
// seeds), not `drizzle/seed.sql`.
const SEED = path.join(process.cwd(), "drizzle", "seed", "seed.sql");
const PASSWORD = "TownMeeting!Dev1";

describe("seedDevLogins", () => {
  it("links every seeded account and leaves it able to sign in", async () => {
    await withTestDb(async (owner) => {
      await owner.file(SEED);
      const db = drizzle(owner);
      const auth = createAuth({
        db,
        secret: "0123456789abcdef0123456789abcdef",
        baseURL: "http://localhost:5173",
        sendAuthEmail: async () => {},
      });

      const seeded = await seedDevLogins(db, auth, PASSWORD);

      // Six accounts in the seed, every one linked.
      expect(seeded).toHaveLength(6);
      const rows = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM user_account WHERE auth_user_id IS NOT NULL`;
      expect(rows[0]!.n).toBe(6);

      // The tenant bridge row exists for each, or the account authenticates
      // and is then refused on every request.
      const tenants = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM better_auth.user_tenant`;
      expect(tenants[0]!.n).toBe(6);

      // The point of the whole script.
      const signedIn = await auth.api.signInEmail({
        body: { email: "mbragdon@newcastle.me.us", password: PASSWORD },
        asResponse: true,
      });
      expect(signedIn.status).toBe(200);
    });
  });

  it("is safe to run twice", async () => {
    await withTestDb(async (owner) => {
      await owner.file(SEED);
      const db = drizzle(owner);
      const auth = createAuth({
        db,
        secret: "0123456789abcdef0123456789abcdef",
        baseURL: "http://localhost:5173",
        sendAuthEmail: async () => {},
      });

      await seedDevLogins(db, auth, PASSWORD);
      const second = await seedDevLogins(db, auth, PASSWORD);

      // Nothing left to do the second time, and no duplicate identities.
      expect(second).toHaveLength(0);
      const rows = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM better_auth."user"`;
      expect(rows[0]!.n).toBe(6);
    });
  });
});
