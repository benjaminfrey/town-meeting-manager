/**
 * Stage 1, Task C1 — invariants of the `better_auth` schema.
 *
 * The counterpart to `db/__tests__/schema-invariants.test.ts`, which asserts
 * the shape of the tenant-scoped model in `public` and is deliberately left
 * BYTE-IDENTICAL by this task. Every query in that file is scoped to
 * `nspname = 'public'`, so putting the auth tables in their own schema means
 * its exact 27-table set stays exact and its "every table has RLS and FORCE"
 * assertion keeps meaning what it said. This file covers what that one now
 * does not reach, rather than widening it to reach here — a widened invariant
 * is an invariant with a hole, and the hole is the thing the next table walks
 * through.
 *
 * The decision these tests encode is: Better Auth's tables get no RLS,
 * because they have no tenant and cannot be given one without making login
 * impossible (see section 1 of
 * `packages/api/drizzle/0001_better_auth_and_tenant_bridge.sql`). What
 * protects them instead is the grant surface — so the grant surface is what is
 * asserted, mechanically, on every run.
 */

import { describe, it, expect } from "vitest";
import { withTestDb } from "../../test/db-harness.js";

// `invitation_tenant` is Task D1c's addition, and it is here for the same
// reason `user_tenant` is: it answers a question that has to be answered
// BEFORE a tenant exists, which is the one thing a table in `public` cannot
// do. `user_tenant` maps an identity to a town; `invitation_tenant` maps
// sha256(invitation token) to a town, so invitation acceptance — which runs
// for someone with no person row, no account and no session — can open a
// `withTenant` transaction at all.
//
// The decision this list exists to force, made explicitly: it is unprotected
// by RLS, like everything else here, and that is acceptable because it holds
// no secret and confers no access. The key is a one-way digest, so reading the
// whole table yields no usable token; the value is a town id that is only ever
// a HINT, verified by RLS when the invitation is actually read
// (`db/invitation-bootstrap.ts`). A wrong or tampered row denies service to
// one token; it cannot disclose another town's row.
const EXPECTED_TABLES = [
  "account",
  "invitation_tenant",
  "session",
  "user",
  "user_tenant",
  "verification",
];

describe("better_auth schema invariants", () => {
  it("contains exactly the tables the migration creates", async () => {
    await withTestDb(async (sql) => {
      const rows = await sql<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'better_auth' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `;
      // The exact set, like Phase B's. A table appearing here without a
      // decision having been made about it is the failure mode this catches:
      // `better_auth` is the schema with no row level security, so anything
      // that lands in it by accident is unprotected by anything but grants.
      expect(rows.map((r) => r.relname)).toEqual(EXPECTED_TABLES);
    });
  });

  it("leaves Phase B's 27 tables in public untouched, all still RLS-forced", async () => {
    await withTestDb(async (sql) => {
      const rows = await sql<{ n: number; enabled: number; forced: number }[]>`
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE c.relrowsecurity)::int AS enabled,
               count(*) FILTER (WHERE c.relforcerowsecurity)::int AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      `;
      // Adding an auth layer must not have moved a single table out of the
      // protected set, and must not have added an unprotected one to it.
      expect(rows[0]).toEqual({ n: 27, enabled: 27, forced: 27 });
    });
  });

  it("deliberately has no row level security, and no policy pretending otherwise", async () => {
    await withTestDb(async (sql) => {
      const rls = await sql<{ relname: string; enabled: boolean; forced: boolean }[]>`
        SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'better_auth' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `;
      // Asserted in the negative on purpose. Turning RLS on here without a
      // usable policy would deny every read on `session` and lock every user
      // out; turning it on with `USING (true)` would make `pg_policies` claim
      // a protection that does not exist. Either change should be a decision
      // someone makes on purpose, with this test in front of them.
      expect(rls.filter((r) => r.enabled).map((r) => r.relname)).toEqual([]);
      expect(rls.filter((r) => r.forced).map((r) => r.relname)).toEqual([]);

      const policies = await sql<{ policyname: string }[]>`
        SELECT policyname FROM pg_policies WHERE schemaname = 'better_auth'
      `;
      expect(policies.map((p) => p.policyname)).toEqual([]);
    });
  });

  it("reaches the schema only through tmm_app and the owner", async () => {
    await withTestDb(async (sql) => {
      // Since there is no RLS here, the grant surface IS the protection. A
      // stray `GRANT ... TO PUBLIC` would expose password hashes and live
      // session tokens to every role on the cluster with nothing else in the
      // way.
      const [schema] = await sql<{ public_usage: boolean; app_usage: boolean }[]>`
        SELECT has_schema_privilege('public', 'better_auth', 'USAGE') AS public_usage,
               has_schema_privilege('tmm_app', 'better_auth', 'USAGE') AS app_usage
      `;
      expect(schema!.public_usage).toBe(false);
      expect(schema!.app_usage).toBe(true);
    });
  });

  it("grants tmm_app DML on every table here and nothing more", async () => {
    await withTestDb(async (sql) => {
      const owned = await sql<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'better_auth' AND c.relowner = 'tmm_app'::regrole
      `;
      // Owners bypass RLS unless FORCEd. There is no RLS here to bypass, but
      // ownership also carries DDL, and "tmm_app owns nothing anywhere" is
      // easier to verify and harder to erode than a per-schema exception.
      expect(owned.map((o) => o.relname)).toEqual([]);

      const grants = await sql<{ relname: string; privs: string }[]>`
        SELECT c.relname,
               (SELECT string_agg(p, ',' ORDER BY p)
                  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
                 WHERE has_table_privilege('tmm_app', c.oid, p)) AS privs
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'better_auth' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `;
      // Exactly DML — same bar as the baseline holds `public` to. No TRUNCATE,
      // no REFERENCES, no TRIGGER, no DDL.
      const wrong = grants.filter((g) => g.privs !== "DELETE,INSERT,SELECT,UPDATE");
      expect(wrong.map((g) => `${g.relname}: ${g.privs}`)).toEqual([]);
    });
  });

  it("matches what Better Auth itself expects, with nothing left to migrate", async () => {
    await withTestDb(async (sql) => {
      // The committed DDL is a transcription of Better Auth's own generator
      // output. Transcriptions rot. Rather than trusting the copy, run the
      // generator against the database this migration built and assert it
      // plans no further work — so a Better Auth upgrade that adds a column
      // fails here, in a test that names the column, instead of at runtime as
      // "column does not exist".
      const [current] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
      const db = current!.db;
      const databaseUrl = process.env.DATABASE_URL!;

      const { getMigrations } = await import("better-auth/db/migration");
      const pgMod = await import("pg");

      // The database name goes in the URL, not in a `database:` field.
      // node-postgres lets `connectionString` win over sibling options — the
      // opposite of postgres.js, which is what the harness uses — so passing
      // `database` here would silently introspect the wrong database and this
      // test would report "nothing to migrate" about a schema it never looked
      // at. Verified by measurement, not assumed.
      const url = new URL(databaseUrl);
      url.pathname = `/${db}`;

      const pool = new pgMod.default.Pool({
        connectionString: url.toString(),
        // Better Auth's migration planner resolves the target schema from the
        // first entry of `search_path`, so this is what points it at
        // `better_auth` instead of `public`.
        options: "-c search_path=better_auth",
      });

      try {
        const plan = await getMigrations({
          database: pool,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:3000",
          emailAndPassword: { enabled: true, requireEmailVerification: true },
        });

        expect(plan.toBeCreated.map((t) => t.table)).toEqual([]);
        expect(
          plan.toBeAdded.flatMap((t) => Object.keys(t.fields).map((f) => `${t.table}.${f}`)),
        ).toEqual([]);
        expect(plan.toBeAddedIndexes.map((i) => i.name)).toEqual([]);
      } finally {
        await pool.end();
      }
    });
  });
});
