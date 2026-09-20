/**
 * `seedDevLogins` gives each seeded `user_account` a Better Auth identity, so a
 * developer can sign in after a bootstrap. It replaces the GoTrue accounts that
 * lived in `docker/volumes/db/data`, which no seed ever recreated.
 *
 * The assertion that matters is the last one: a real sign-in. Linking rows
 * without a working sign-in is the failure this test exists to catch.
 *
 * Runs `seedDevLogins` on the `tmm_app` connection (`connectAsAppRole`), the
 * same runtime role `resolveTenant()` uses for a real request — not the
 * schema-owner connection. `seedDevLogins` no longer needs any privilege
 * beyond that: its discovery read is scoped by `withTenant(townId)`, exactly
 * like its linking writes, so there is nothing left that needs a superuser or
 * table-owner connection to pass. A test on the owner connection could pass
 * with the tenancy model switched off entirely; this one cannot.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { seedDevLogins, SEED_TOWN_ID } from "../seed-dev-logins.js";

// Task 1 moved the seed to `drizzle/seed/seed.sql` (beside the schema it
// seeds), not `drizzle/seed.sql`.
const SEED = path.join(process.cwd(), "drizzle", "seed", "seed.sql");
const PASSWORD = "TownMeeting!Dev1";

describe("seedDevLogins", () => {
  it("links every seeded account and leaves it able to sign in", async () => {
    await withTestDb(async (owner) => {
      await owner.file(SEED);
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const auth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:5173",
          sendAuthEmail: async () => {},
        });

        const seeded = await seedDevLogins(db, auth, PASSWORD, SEED_TOWN_ID);

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
      } finally {
        await app.end();
      }
    });
  });

  it("is safe to run twice", async () => {
    await withTestDb(async (owner) => {
      await owner.file(SEED);
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const auth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:5173",
          sendAuthEmail: async () => {},
        });

        await seedDevLogins(db, auth, PASSWORD, SEED_TOWN_ID);
        const second = await seedDevLogins(db, auth, PASSWORD, SEED_TOWN_ID);

        // Nothing left to do the second time, and no duplicate identities.
        expect(second).toHaveLength(0);
        const rows = await owner<{ n: number }[]>`
          SELECT count(*)::int AS n FROM better_auth."user"`;
        expect(rows[0]!.n).toBe(6);
      } finally {
        await app.end();
      }
    });
  });
});
