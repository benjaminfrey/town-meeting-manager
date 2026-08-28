/**
 * Stage 1, Task C1, step 8 — onboarding under FORCE ROW LEVEL SECURITY.
 *
 * The baseline's `complete_onboarding()` was broken and its own comment said
 * so: it inserted into `town` before any `app.town_id` existed, and `town`'s
 * policy is `WITH CHECK (id = get_current_town_id())`.
 *
 * It looked fine locally for one reason, and the first test below demonstrates
 * that reason rather than asserting it: the developer's role is a superuser,
 * `SECURITY DEFINER` inherited the superuser's RLS bypass, and the insert went
 * through. Every test in this file that matters runs as `tmm_app` — the role
 * production connects as, which owns nothing, is not a superuser, and has no
 * bypass to inherit. That is the difference between proving onboarding works
 * and proving it works on the one machine it was written on.
 */

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant } from "../../db/with-tenant.js";
import { completeOnboarding } from "../onboarding.js";

const AUTH_USER = "auth-user-onboarding";

/**
 * Unwrap the driver error Drizzle wraps.
 *
 * `db.execute()` failures arrive as a `DrizzleQueryError` whose own message is
 * the generic "Failed query: ..." and whose SQLSTATE lives on `.cause`.
 * Asserting on the wrapper would pass for ANY database error — including one
 * that has nothing to do with what the test is checking — so every assertion
 * here goes through the real `PostgresError` underneath.
 */
async function pgErrorOf(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint_name?: string; message: string }> {
  try {
    await work;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return (cause ?? err) as { code?: string; constraint_name?: string; message: string };
  }
  throw new Error("expected the operation to reject, but it resolved");
}

async function seedAuthUser(app: Awaited<ReturnType<typeof connectAsAppRole>>, id = AUTH_USER) {
  await app`INSERT INTO better_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES (${id}, 'Clerk', ${`${id}@example.gov`}, true, now(), now())`;
}

describe("onboarding under FORCE RLS", () => {
  it("shows the superuser bypass that hid the breakage", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        // As the OWNER — a superuser in every supported setup, which is what
        // a SECURITY DEFINER function inherited. No tenant context at all.
        await owner`INSERT INTO town (id, name, subdomain)
                    VALUES (gen_random_uuid(), 'Superuser Town', 'superuser-town')`;
        const asOwner = await owner`SELECT 1 FROM town WHERE subdomain = 'superuser-town'`;
        expect(asOwner).toHaveLength(1);

        // The identical statement as `tmm_app`. This is what production does,
        // and this is the failure the superuser path concealed.
        await expect(
          app`INSERT INTO town (id, name, subdomain)
              VALUES (gen_random_uuid(), 'App Town', 'app-town')`,
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await app.end();
      }
    });
  });

  it("creates a town as tmm_app, end to end", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        await seedAuthUser(app);

        const result = await completeOnboarding(db, {
          authUserId: AUTH_USER,
          townName: "Newcastle",
          state: "ME",
          boardName: "Select Board",
          memberCount: 5,
          additionalBoards: [{ name: "Planning Board", memberCount: 7 }],
          contactName: "Town Clerk",
          contactEmail: "clerk@newcastle.example.gov",
        });

        expect(result.townId).toMatch(/^[0-9a-f-]{36}$/);

        // Read back through RLS, as tmm_app, in the new town's context. If any
        // of this had been written by a bypass it would still be here; the
        // point is that it was written WITHOUT one.
        const seen = await withTenant(db, { townId: result.townId }, async (tx) => {
          const towns = await tx.execute<{ name: string }>(sql`SELECT name FROM town`);
          const boards = await tx.execute<{ name: string; is_governing_board: boolean }>(
            sql`SELECT name, is_governing_board FROM board ORDER BY name`,
          );
          const accounts = await tx.execute<{ id: string; auth_user_id: string; role: string }>(
            sql`SELECT id, auth_user_id, role FROM user_account`,
          );
          const people = await tx.execute<{ id: string; email: string }>(
            sql`SELECT id, email FROM person`,
          );
          return {
            towns: [...towns],
            boards: [...boards],
            accounts: [...accounts],
            people: [...people],
          };
        });

        expect(seen.towns.map((t) => t.name)).toEqual(["Newcastle"]);
        expect(seen.boards.map((b) => b.name)).toEqual(["Planning Board", "Select Board"]);
        expect(seen.boards.find((b) => b.name === "Select Board")!.is_governing_board).toBe(true);
        expect(seen.people.map((p) => p.email)).toEqual(["clerk@newcastle.example.gov"]);
        expect(seen.accounts).toHaveLength(1);
        expect(seen.accounts[0]).toMatchObject({
          id: result.userAccountId,
          auth_user_id: AUTH_USER,
          role: "admin",
        });

        // And the door-opener row, which lives outside RLS.
        const mapping = await app<{ town_id: string }[]>`
          SELECT town_id FROM better_auth.user_tenant WHERE auth_user_id = ${AUTH_USER}
        `;
        expect(mapping.map((m) => m.town_id)).toEqual([result.townId]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses to run without a tenant context, with an error that says what to do", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        // The old calling convention: call the function and hope. The
        // function now refuses before touching a table, so the caller gets an
        // instruction instead of "new row violates row-level security policy
        // for table town", which names neither the cause nor the fix.
        await expect(
          app`SELECT complete_onboarding(
                gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Nowhere')`,
        ).rejects.toThrow(/app\.town_id/);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a town id that disagrees with the tenant context", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        // Context set to one town, function asked to create another. Without
        // the guard this would fail as an opaque RLS denial partway through.
        const err = await pgErrorOf(
          withTenant(db, { townId: "11111111-1111-4111-8111-111111111111" }, (tx) =>
            tx.execute(
              sql`SELECT complete_onboarding(
                    '22222222-2222-4222-8222-222222222222'::uuid,
                    gen_random_uuid(), gen_random_uuid(), 'Mismatch')`,
            ),
          ),
        );
        expect(err.message).toMatch(/app\.town_id/);
        expect(err.message).toMatch(/22222222-2222-4222-8222-222222222222/);
      } finally {
        await app.end();
      }
    });
  });

  it("rolls the whole town back when the same identity onboards twice", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        await seedAuthUser(app);

        const first = await completeOnboarding(db, { authUserId: AUTH_USER, townName: "First" });

        const err = await pgErrorOf(
          completeOnboarding(db, { authUserId: AUTH_USER, townName: "Second" }),
        );
        // Unique indexes are not scoped by RLS, so this fires across towns —
        // which is the point. The in-function `SELECT 1 FROM user_account`
        // guard the baseline relied on could only ever see the current town,
        // so it could never have caught a second town at all.
        expect(err.code).toBe("23505");
        expect(err.constraint_name).toBe("user_account_auth_user_id_key");

        // The critical half: no half-built second town survives. A town with
        // no user_tenant row is a town nobody can ever sign in to, and nothing
        // in the application would ever surface it.
        const towns = await owner<{ name: string }[]>`SELECT name FROM town ORDER BY name`;
        expect(towns.map((t) => t.name)).toEqual(["First"]);

        const mappings = await app<{ town_id: string }[]>`
          SELECT town_id FROM better_auth.user_tenant
        `;
        expect(mappings.map((m) => m.town_id)).toEqual([first.townId]);
      } finally {
        await app.end();
      }
    });
  });
});
