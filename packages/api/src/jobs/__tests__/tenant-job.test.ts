/**
 * Stage 1, Task D1c — the job-tenancy gate.
 *
 * The claim this file has to earn is narrow and specific:
 *
 *   A BACKGROUND JOB WITH NO TENANT FAILS RATHER THAN READING ACROSS TOWNS.
 *
 * It is worth being precise about why that needs a test at all, because the
 * failure it guards against is the quiet kind. Before this task, background
 * work took the service-role Supabase client, which bypasses row level
 * security. A job that forgot `.eq("town_id", …)` did not error — it returned
 * every town's rows and looked like it had worked. There is no assertion you
 * can add to such a job that catches its own omission.
 *
 * The fix is structural rather than diligent: `TenantJob` is the only database
 * handle a job gets, and it cannot be constructed without a town. So the two
 * halves proved here are:
 *
 *   1. Construction refuses — eagerly, at the line that builds the job, not
 *      at whatever query happens to run first (and not at all, if the branch
 *      taken happens to run none).
 *   2. The database is the backstop. Even supposing the type were subverted,
 *      a query run with no `app.town_id` set reads nothing as `tmm_app` —
 *      measured here rather than assumed, on a connection with real rows in
 *      it.
 *
 * (2) is not redundant with (1). (1) is a TypeScript guarantee and TypeScript
 * is not present at runtime; (2) is what the guarantee rests on.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { listJobTenants, tenantJob } from "../tenant-job.js";

describe("tenantJob", () => {
  it("refuses to build a job that does not name its town", () => {
    // `db` is never touched — the refusal happens before anything is asked of
    // it, which is the point: the mistake is at the call site, so that is
    // where the stack should start.
    const unusable = {
      execute: () => {
        throw new Error("the database must not be reached by a job with no tenant");
      },
      transaction: () => {
        throw new Error("the database must not be reached by a job with no tenant");
      },
    };

    for (const missing of [undefined, null, "", "   ", "not-a-uuid", "town-1"]) {
      expect(() => tenantJob(unusable as never, missing as never)).toThrow(/must name its town/i);
    }
  });

  it("accepts a uuid and scopes its transactions to that town", async () => {
    await withTestDb(async (owner) => {
      const townA = randomUUID();
      const townB = randomUUID();

      await owner.begin(async (tx) => {
        await tx`SELECT set_config('app.town_id', ${townA}, true)`;
        await tx`INSERT INTO town (id, name, subdomain) VALUES (${townA}, 'Alpha', 'alpha')`;
      });
      await owner.begin(async (tx) => {
        await tx`SELECT set_config('app.town_id', ${townB}, true)`;
        await tx`INSERT INTO town (id, name, subdomain) VALUES (${townB}, 'Beta', 'beta')`;
      });

      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const job = tenantJob(db, townA);
        expect(job.townId).toBe(townA);

        const seen = await job.run(async (tx) => {
          const result = (await tx.execute(sql`SELECT name FROM town`)) as { name: string }[];
          return result.map((r) => r.name);
        });

        // Alpha only. Beta exists and is invisible — not filtered out by this
        // query, which has no WHERE clause at all, but absent from it.
        expect(seen).toEqual(["Alpha"]);
      } finally {
        await app.end();
      }
    });
  });

  it("reads nothing at all when no tenant is set — the backstop under the type", async () => {
    await withTestDb(async (owner) => {
      const townId = randomUUID();
      await owner.begin(async (tx) => {
        await tx`SELECT set_config('app.town_id', ${townId}, true)`;
        await tx`INSERT INTO town (id, name, subdomain) VALUES (${townId}, 'Alpha', 'alpha')`;
      });

      const app = await connectAsAppRole(owner);
      try {
        // The same query a tenant-less job would run. No `app.town_id`, so
        // `get_current_town_id()` is NULL, every policy matches nothing, and
        // the answer is zero rows — with no error. That silence is exactly
        // why the refusal above has to happen in TypeScript: the database
        // will not tell a job it forgot something.
        const rows = await app`SELECT id FROM town`;
        expect(rows).toHaveLength(0);

        // And to be sure the row is really there and this is RLS talking
        // rather than an empty database:
        const asOwner = await owner`SELECT id FROM town`;
        expect(asOwner).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });
});

describe("listJobTenants", () => {
  it("returns each town that has an identity, once", async () => {
    await withTestDb(async (owner) => {
      const townA = randomUUID();
      const townB = randomUUID();
      const users = [randomUUID(), randomUUID(), randomUUID()];

      for (const [i, userId] of users.entries()) {
        await owner`
          INSERT INTO better_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
          VALUES (${userId}, ${`User ${i}`}, ${`user${i}@example.gov`}, true, now(), now())
        `;
      }
      await owner.begin(async (tx) => {
        await tx`SELECT set_config('app.town_id', ${townA}, true)`;
        await tx`INSERT INTO town (id, name, subdomain) VALUES (${townA}, 'Alpha', 'alpha')`;
      });
      await owner.begin(async (tx) => {
        await tx`SELECT set_config('app.town_id', ${townB}, true)`;
        await tx`INSERT INTO town (id, name, subdomain) VALUES (${townB}, 'Beta', 'beta')`;
      });

      // Two identities in town A, one in town B — so "once per town, not once
      // per identity" is actually under test.
      await owner`INSERT INTO better_auth.user_tenant (auth_user_id, town_id) VALUES (${users[0]!}, ${townA})`;
      await owner`INSERT INTO better_auth.user_tenant (auth_user_id, town_id) VALUES (${users[1]!}, ${townA})`;
      await owner`INSERT INTO better_auth.user_tenant (auth_user_id, town_id) VALUES (${users[2]!}, ${townB})`;

      const app = await connectAsAppRole(owner);
      try {
        const tenants = await listJobTenants(drizzle(app));
        expect([...tenants].sort()).toEqual([townA, townB].sort());
      } finally {
        await app.end();
      }
    });
  });
});
