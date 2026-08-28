/**
 * The application's database handle.
 *
 * ─── Why this is here and not in a general `db/client.ts` ─────────────────
 *
 * `db/with-tenant.ts` takes `db` as a parameter precisely because no
 * connection module existed and Task D1 owns creating the real one — its shape
 * depends on pool sizing and credential-source decisions that have not been
 * made. This file is the minimum needed to make Task C1 run: Better Auth needs
 * a Drizzle instance, and so does the tenant bridge. It is deliberately small
 * and deliberately not exported as "the" client, so D1 can replace it without
 * unpicking anything.
 *
 * ─── Which role this connects as ──────────────────────────────────────────
 *
 * `tmm_app`, always, in production — the non-owner runtime role with DML and
 * nothing else. Connecting as the owner would silently defeat the entire
 * security model, because owners bypass their own policies unless FORCEd, and
 * the whole point of FORCE is that misconfiguring this connection string is
 * the most likely way to lose tenancy. That is a property of the URL supplied,
 * which this file cannot check by itself — but the isolation gate
 * (`db/__tests__/tenant-isolation.test.ts`) measures the difference, and the
 * gap is stark: with no tenant context the owner sees every town's rows and
 * `tmm_app` sees none.
 *
 * `postgres.js` rather than `pg`: the test harness already uses it, so tests
 * drive the same driver the application does, and Better Auth's Drizzle
 * adapter is driver-agnostic.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

export type AppDb = ReturnType<typeof drizzle>;

export interface AppDbHandle {
  db: AppDb;
  client: postgres.Sql;
  close(): Promise<void>;
}

/**
 * Open a pool and wrap it in Drizzle.
 *
 * Throws rather than defaulting when `DATABASE_URL` is unset. A default here
 * would mean a misconfigured deployment silently connecting somewhere
 * plausible-looking instead of failing at boot.
 */
export function createAppDb(connectionString = process.env.DATABASE_URL): AppDbHandle {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. It must point at the application role (tmm_app), " +
        "not the schema owner: owners bypass row level security unless FORCEd, and " +
        "every tenancy guarantee in this system assumes a non-owner connection.",
    );
  }

  const client = postgres(connectionString, { onnotice: () => {} });
  return {
    client,
    db: drizzle(client),
    close: () => client.end(),
  };
}
