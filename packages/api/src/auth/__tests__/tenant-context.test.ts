/**
 * Stage 1, Task C1 — THE TENANT BRIDGE.
 *
 * Phase B built a security model in which nothing is readable until
 * `app.town_id` is set, and Phase B's own gate proved that model holds. It
 * did not, and could not, say where `app.town_id` comes from. This file does.
 *
 * ─── Why the second test is the one that matters ─────────────────────────
 *
 * `get_current_town_id()` is
 * `nullif(current_setting('app.town_id', true), '')::uuid`. Unset or empty, it
 * is NULL; `town_id = NULL` is NULL, not false; so every policy matches
 * nothing and every query returns zero rows **with no error anywhere**. A
 * session that resolves to no town and is allowed to proceed therefore
 * produces a working-looking application in which a real town's staff see an
 * empty dashboard, and nothing — not a log line, not a 500, not a failing
 * query — distinguishes that from a town that genuinely has no meetings yet.
 *
 * So the bridge must fail loudly instead. `withTenant` already refuses a
 * non-UUID `townId` for exactly this reason; the resolution step in front of
 * it has to refuse just as hard, because it is the step that can *produce* an
 * absent town.
 *
 * ─── Why these run as `tmm_app` ──────────────────────────────────────────
 *
 * `withTestDb` hands back the database owner, which is a superuser in every
 * supported setup and bypasses RLS outright — a bridge test on that
 * connection would pass with row-level security switched off entirely. Every
 * assertion below that touches tenant data goes through `connectAsAppRole`,
 * which is the role the application actually connects as. See
 * `../../test/db-harness.ts`.
 */

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant } from "../../db/with-tenant.js";
import { resolveTenant, TenantResolutionError } from "../tenant-context.js";

const TOWN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TOWN_B = "bbbbbbbb-0000-4000-8000-000000000001";

interface Seeded {
  townId: string;
  personId: string;
  userAccountId: string;
  authUserId: string;
}

/**
 * Create one town, one person, one `user_account`, and the Better Auth
 * identity that maps to it — the whole chain a real session traverses.
 *
 * Written as `tmm_app` inside that town's own tenant context, which makes the
 * seed itself a positive control: if `WITH CHECK` were wrong, or the runtime
 * role were missing a grant on the new `better_auth` tables, this fails here
 * rather than leaving the assertions to pass against an empty database.
 */
async function seed(app: postgres.Sql, townId: string, label: string): Promise<Seeded> {
  const lower = label.toLowerCase();
  const personId = townId.replace(/1$/, "2");
  const userAccountId = townId.replace(/1$/, "3");
  const authUserId = `auth-user-${lower}`;

  await app.begin(async (tx) => {
    // Better Auth's own tables are NOT tenant-scoped (see the migration's
    // header): an identity exists before any town is known, and the session
    // lookup that finds the town has to happen before `app.town_id` can be
    // set. So this insert deliberately happens outside any tenant context.
    await tx`INSERT INTO better_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
             VALUES (${authUserId}, ${`User ${label}`}, ${`user-${lower}@example.gov`}, true, now(), now())`;

    await tx`SELECT set_config('app.town_id', ${townId}, true)`;

    await tx`INSERT INTO town (id, name, subdomain)
             VALUES (${townId}, ${`Town ${label}`}, ${`town-${lower}`})`;
    await tx`INSERT INTO person (id, town_id, name, email)
             VALUES (${personId}, ${townId}, ${`Person ${label}`}, ${`person-${lower}@example.gov`})`;
    await tx`INSERT INTO user_account (id, person_id, town_id, role, auth_user_id)
             VALUES (${userAccountId}, ${personId}, ${townId}, 'admin', ${authUserId})`;
  });

  // The door-opener row. Written after the tenant work, in its own statement,
  // because it lives outside RLS and must not be able to hide behind it.
  await app`INSERT INTO better_auth.user_tenant (auth_user_id, town_id)
            VALUES (${authUserId}, ${townId})`;

  return { townId, personId, userAccountId, authUserId };
}

function session(authUserId: string) {
  return { user: { id: authUserId } };
}

describe("the tenant bridge", () => {
  it("resolves a session to exactly one town, and sets it for the transaction", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const a = await seed(app, TOWN_A, "A");
        const b = await seed(app, TOWN_B, "B");

        const resolved = await resolveTenant(db, session(a.authUserId));

        expect(resolved.townId).toBe(a.townId);
        expect(resolved.townId).not.toBe(b.townId);
        expect(resolved.personId).toBe(a.personId);
        expect(resolved.userAccountId).toBe(a.userAccountId);

        // Resolution is only half of it: the point of resolving is that the
        // resulting context actually scopes the database. Positive AND
        // negative control — "sees none of B's rows" is also satisfied by a
        // database that returns nothing to anyone, which is what a dropped
        // policy produces.
        const seen = await withTenant(db, { townId: resolved.townId }, async (tx) => {
          const towns = await tx.execute<{ id: string }>(sql`SELECT id FROM town ORDER BY id`);
          const people = await tx.execute<{ id: string }>(sql`SELECT id FROM person ORDER BY id`);
          return { towns: [...towns].map((r) => r.id), people: [...people].map((r) => r.id) };
        });

        expect(seen.towns).toEqual([a.townId]);
        expect(seen.people).toEqual([a.personId]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a session with no identity mapping, rather than defaulting to one", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        await seed(app, TOWN_A, "A");

        // A Better Auth user who has signed up but never been attached to a
        // town: real, verified, authenticated — and belonging nowhere.
        await app`INSERT INTO better_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
                  VALUES ('auth-user-orphan', 'Orphan', 'orphan@example.gov', true, now(), now())`;

        await expect(resolveTenant(db, session("auth-user-orphan"))).rejects.toThrow(
          TenantResolutionError,
        );
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a session whose user_account was deleted mid-session", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const a = await seed(app, TOWN_A, "A");

        // Resolves cleanly to begin with — so the failure below is caused by
        // the deletion and not by the fixture never having worked.
        await expect(resolveTenant(db, session(a.authUserId))).resolves.toMatchObject({
          townId: a.townId,
        });

        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${a.townId}, true)`;
          await tx`DELETE FROM user_account WHERE id = ${a.userAccountId}`;
        });

        // The door-opener row in better_auth.user_tenant still says town A.
        // Without the verification step this would resolve happily and then
        // read an empty town.
        await expect(resolveTenant(db, session(a.authUserId))).rejects.toThrow(
          TenantResolutionError,
        );
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a session whose user_account is archived", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const a = await seed(app, TOWN_A, "A");

        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${a.townId}, true)`;
          await tx`UPDATE user_account SET archived_at = now() WHERE id = ${a.userAccountId}`;
        });

        await expect(resolveTenant(db, session(a.authUserId))).rejects.toThrow(
          TenantResolutionError,
        );
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a mapping that points at a town the account does not belong to", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const a = await seed(app, TOWN_A, "A");
        const b = await seed(app, TOWN_B, "B");

        // Drift: the identity layer says town B, the tenant-scoped truth says
        // town A. The verification runs inside town B's context, where A's
        // user_account is invisible, so this must throw rather than hand back
        // a context in which the user sees a town that is not theirs.
        await app`UPDATE better_auth.user_tenant SET town_id = ${b.townId}
                  WHERE auth_user_id = ${a.authUserId}`;

        await expect(resolveTenant(db, session(a.authUserId))).rejects.toThrow(
          TenantResolutionError,
        );
      } finally {
        await app.end();
      }
    });
  });

  it("never falls through to an empty context — the error names the cause", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        await app`INSERT INTO better_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
                  VALUES ('auth-user-orphan', 'Orphan', 'orphan@example.gov', true, now(), now())`;

        // A thrown error that says "not found" is only useful if a reader can
        // tell WHICH identity failed to resolve. This is the difference
        // between a five-minute and a five-hour diagnosis on a live system.
        await expect(resolveTenant(db, session("auth-user-orphan"))).rejects.toThrow(
          /auth-user-orphan/,
        );
      } finally {
        await app.end();
      }
    });
  });

  it("rejects a null or malformed session instead of resolving one", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        await expect(resolveTenant(db, null)).rejects.toThrow(TenantResolutionError);
        await expect(
          resolveTenant(db, { user: { id: "" } } as unknown as { user: { id: string } }),
        ).rejects.toThrow(TenantResolutionError);
      } finally {
        await app.end();
      }
    });
  });

  it("makes 'more than one town' impossible by schema, in both directions", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const a = await seed(app, TOWN_A, "A");
        const b = await seed(app, TOWN_B, "B");

        // Direction 1: the identity → town mapping is keyed by the auth user,
        // so one identity cannot name two towns.
        await expect(
          app`INSERT INTO better_auth.user_tenant (auth_user_id, town_id)
              VALUES (${a.authUserId}, ${b.townId})`,
        ).rejects.toMatchObject({ code: "23505" });

        // Direction 2: `user_account.auth_user_id` is UNIQUE, so one identity
        // cannot own accounts in two towns either. Asserted rather than
        // assumed, because a future migration that drops this constraint would
        // otherwise turn "exactly one town" into "whichever row came back
        // first" with nothing failing.
        await expect(
          app.begin(async (tx) => {
            await tx`SELECT set_config('app.town_id', ${b.townId}, true)`;
            await tx`INSERT INTO user_account (id, person_id, town_id, role, auth_user_id)
                     VALUES (gen_random_uuid(), ${b.personId}, ${b.townId}, 'admin', ${a.authUserId})`;
          }),
        ).rejects.toMatchObject({ code: "23505" });
      } finally {
        await app.end();
      }
    });
  });
});
