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

  it("cleans up the identity instead of stranding it when the link fails", async () => {
    await withTestDb(async (owner) => {
      await owner.file(SEED);
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const realAuth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:5173",
          sendAuthEmail: async () => {},
        });

        // Force the `auth_user_id IS NULL` guard inside `withTenant` to match
        // no row for exactly one account — David Chen, first alphabetically
        // (`ORDER BY p.email`), so nothing else has been processed yet when
        // this happens. The moment Better Auth's sign-up succeeds for his
        // email — but before seedDevLogins's own linking transaction runs —
        // link that user_account to the identity out from under it, exactly
        // as a concurrent invitation acceptance or a second seed run would.
        // seedDevLogins's guard must then see the row is already spoken for.
        const targetEmail = "dchen@newcastle.me.us";
        const spiedAuth = {
          ...realAuth,
          api: {
            ...realAuth.api,
            signUpEmail: async (args: {
              body: { email: string; password: string; name: string };
            }) => {
              const result = await realAuth.api.signUpEmail(args);
              if (args.body.email === targetEmail) {
                await owner`
                  UPDATE user_account SET auth_user_id = ${result.user.id}
                   WHERE person_id = (SELECT id FROM person WHERE email = ${targetEmail})`;
              }
              return result;
            },
          },
        } as unknown as ReturnType<typeof createAuth>;

        await expect(seedDevLogins(db, spiedAuth, PASSWORD, SEED_TOWN_ID)).rejects.toThrow(
          /dchen@newcastle\.me\.us/,
        );

        // Nothing succeeded before David Chen (he sorts first), and his own
        // identity — created, then immediately orphaned by the guard failure
        // above — was deleted rather than left stranded. Net change: zero.
        const rows = await owner<{ n: number }[]>`
          SELECT count(*)::int AS n FROM better_auth."user"`;
        expect(rows[0]!.n).toBe(0);

        // Deleting that identity also reverted the account this test
        // sabotaged — `user_account.auth_user_id` is `ON DELETE SET NULL` —
        // so a subsequent run finds all six accounts pending again and
        // succeeds for every one of them, David Chen included.
        const seeded = await seedDevLogins(db, realAuth, PASSWORD, SEED_TOWN_ID);
        expect(seeded).toHaveLength(6);
      } finally {
        await app.end();
      }
    });
  });
});
