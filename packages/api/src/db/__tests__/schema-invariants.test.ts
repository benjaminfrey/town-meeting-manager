/**
 * Stage 1, Task B2 — invariants of the baseline schema.
 *
 * These are not tests of behaviour; they are tests of the *shape* of the
 * security model, and they exist because every one of them protects a
 * property that can be lost silently.
 *
 * Silently is the operative word. A table added without RLS returns rows to
 * every tenant and raises no error. A `SECURITY DEFINER` function without an
 * explicit `search_path` is hijackable and looks identical to one that is not.
 * A policy that regains a `has_permission()` predicate goes on passing a
 * tenancy test for the wrong reason. None of these show up as a failure
 * anywhere else, which is why they are asserted mechanically here rather than
 * left to review.
 *
 * Every list below is DERIVED from the live catalog, never hand-copied — a
 * table, function or policy added later is picked up automatically instead of
 * being quietly exempt.
 */

import { describe, it, expect } from "vitest";
import { withTestDb } from "../../test/db-harness.js";

// The single policy in the schema that is not a `<table>_tenant_isolation`
// policy, and why it is allowed to exist. Anything else must fail.
const EXTRA_POLICIES: Record<string, string> = {
  permission_template_system_defaults_readable:
    "permission_template holds five system-default rows with town_id IS NULL " +
    "that every town reads and no town may write. Read-only, SELECT only.",
};

// Every table the baseline creates, in `ORDER BY relname`. Deliberately
// enumerated rather than counted: adding a table means adding it here, which is
// the moment to ask whether it needs a tenancy policy. See the first test.
const EXPECTED_TABLES = [
  "agenda_item",
  "agenda_item_transition",
  "agenda_template",
  "audit_log",
  "board",
  "board_member",
  "executive_session",
  "exhibit",
  "future_item_queue",
  "guest_speaker",
  "invitation",
  "meeting",
  "meeting_attendance",
  "minutes_addendum",
  "minutes_document",
  "minutes_section",
  "motion",
  "notification_delivery",
  "notification_event",
  "permission_template",
  "person",
  "push_subscription",
  "subscriber_notification_preference",
  "town",
  "town_notification_config",
  "user_account",
  "vote_record",
];

describe("baseline schema invariants", () => {
  it("has RLS enabled AND forced on every table in public", async () => {
    await withTestDb(async (sql) => {
      const rows = await sql<{ relname: string; enabled: boolean; forced: boolean }[]>`
        SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname
      `;

      // The exact set, not `>= 27`. A count assertion cannot tell a dropped
      // table from a renamed one, and cannot fail at all if a table disappears
      // while another is added — and a table that vanishes from the schema is
      // exactly as much a defect as one that arrives without RLS.
      expect(rows.map((r) => r.relname)).toEqual(EXPECTED_TABLES);

      // ENABLE without FORCE is the dangerous middle state: policies exist, so
      // the schema reads as protected, but the table owner — which is the role
      // that runs migrations and the one most likely to end up in an
      // application connection string by mistake — bypasses all of them with
      // no error and no warning.
      expect(rows.filter((r) => !r.enabled).map((r) => r.relname)).toEqual([]);
      expect(rows.filter((r) => !r.forced).map((r) => r.relname)).toEqual([]);
    });
  });

  it("gives every table exactly one FOR ALL tenancy policy", async () => {
    await withTestDb(async (sql) => {
      const tables = await sql<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname
      `;
      const policies = await sql<
        {
          tablename: string;
          policyname: string;
          cmd: string;
          qual: string | null;
          with_check: string | null;
        }[]
      >`
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = 'public'
      `;

      for (const { relname } of tables) {
        const own = policies.filter((p) => p.tablename === relname);
        const tenancy = own.filter((p) => p.policyname === `${relname}_tenant_isolation`);

        expect(tenancy, `${relname} has no <table>_tenant_isolation policy`).toHaveLength(1);

        // ALL covers SELECT, INSERT, UPDATE and DELETE in one statement, so
        // there is no command a future reader has to notice was left out. The
        // historical corpus had no DELETE policy on 22 of 26 tables.
        expect(tenancy[0]!.cmd, relname).toBe("ALL");
        // Both halves: USING alone would let a row be written into another
        // tenant even though it could never be read back.
        expect(tenancy[0]!.qual, relname).toBeTruthy();
        expect(tenancy[0]!.with_check, relname).toBeTruthy();

        for (const extra of own.filter((p) => p.policyname !== `${relname}_tenant_isolation`)) {
          expect(
            EXTRA_POLICIES[extra.policyname],
            `unexplained extra policy ${extra.policyname} on ${relname}`,
          ).toBeTruthy();
        }
      }
    });
  });

  it("keeps authorization out of RLS entirely", async () => {
    await withTestDb(async (sql) => {
      const rows = await sql<{ policyname: string; expr: string }[]>`
        SELECT policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
        FROM pg_policies WHERE schemaname = 'public'
      `;

      // RLS enforces tenancy; the 30-action permission matrix lives in
      // TypeScript (Task D1). A policy that reads
      // `town_id = get_current_town_id() AND has_permission('R4')` denies every
      // row when app.user_account_id is unset — which is indistinguishable from
      // a working tenancy check, so the isolation gate would pass on a table
      // whose tenancy was broken. See task-5-report.md for the itemised list of
      // every rule that used to live here and where it went.
      const offenders = rows.filter((r) =>
        /has_permission|has_board_permission|is_admin|auth\.uid|auth\.jwt|request\.jwt/.test(
          r.expr,
        ),
      );
      expect(offenders.map((o) => o.policyname)).toEqual([]);
    });
  });

  it("pins search_path on every function in public", async () => {
    await withTestDb(async (sql) => {
      const rows = await sql<{ sig: string; secdef: boolean; config: string | null }[]>`
        SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
               p.prosecdef AS secdef,
               array_to_string(p.proconfig, ',') AS config
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY 1
      `;

      expect(rows.length).toBeGreaterThan(0);

      // A SECURITY DEFINER function with a mutable search_path runs as its
      // owner against whatever objects an attacker can shadow in an
      // earlier-resolving schema. The SECURITY INVOKER ones are pinned too, so
      // that "every function has one" is a property a query can check rather
      // than a per-function judgement call that rots as functions are added.
      const unpinned = rows.filter((r) => !r.config?.includes("search_path="));
      expect(unpinned.map((r) => r.sig)).toEqual([]);
    });
  });

  it("has no dependency on Supabase's auth or storage schemas", async () => {
    await withTestDb(async (sql) => {
      const schemas = await sql<{ nspname: string }[]>`
        SELECT nspname FROM pg_namespace WHERE nspname IN ('auth', 'storage')
      `;
      expect(schemas).toEqual([]);

      // Not just "the schemas are gone" — nothing may reference them either,
      // which is what would break a build on a cluster that happens to have an
      // `auth` schema for unrelated reasons.
      // `prosrc` (the raw body) rather than pg_get_functiondef(): the latter
      // raises on aggregates, and the planner is free to evaluate it before the
      // nspname filter has excluded pg_catalog's, which makes this query fail
      // for a reason that has nothing to do with what it is testing.
      const refs = await sql<{ proname: string }[]>`
        SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosrc ~ '(auth[.](uid|jwt|users)|storage[.])'
      `;
      expect(refs.map((r) => r.proname)).toEqual([]);
    });
  });

  it("grants tmm_app DML on every table and nothing more", async () => {
    await withTestDb(async (sql) => {
      const [role] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'tmm_app'
      `;
      // Either of these would silently defeat every policy above.
      expect(role, "tmm_app role was not created by the baseline").toBeTruthy();
      expect(role!.rolsuper).toBe(false);
      expect(role!.rolbypassrls).toBe(false);

      const owned = await sql<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relowner = 'tmm_app'::regrole
      `;
      // Owners bypass RLS unless FORCEd; "tmm_app owns nothing" is a security
      // property, not tidiness.
      expect(owned.map((o) => o.relname)).toEqual([]);

      const grants = await sql<{ relname: string; privs: string }[]>`
        SELECT c.relname,
               (SELECT string_agg(p, ',' ORDER BY p)
                  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
                 WHERE has_table_privilege('tmm_app', c.oid, p)) AS privs
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname
      `;
      // Exactly DML. No TRUNCATE (bypasses DELETE policies entirely), no
      // REFERENCES, no TRIGGER, no DDL.
      const wrong = grants.filter((g) => g.privs !== "DELETE,INSERT,SELECT,UPDATE");
      expect(wrong.map((g) => `${g.relname}: ${g.privs}`)).toEqual([]);
    });
  });
});
