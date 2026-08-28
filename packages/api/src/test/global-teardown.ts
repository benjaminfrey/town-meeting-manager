/**
 * Vitest global teardown: drops the cluster-scoped role the baseline migration
 * creates (`tmm_app`) after the entire test run completes.
 *
 * Roles are cluster-scoped, not database-scoped: `withTestDb`'s
 * `DROP DATABASE ... WITH (FORCE)` in db-harness.ts removes each per-test
 * database, but does NOT remove roles created inside it. Left alone the role
 * accumulates on whatever Postgres cluster the tests ran against, and — worse
 * than untidy — a stale or previously-mutated role is silently reused on the
 * next run rather than surfaced, so a "clean" local run can rest on role state
 * that was never actually clean. That is the same class of leak that, one
 * stage earlier, masked a real failure mode: a `GRANT ... TO authenticated` in
 * the migration corpus succeeded on a polluted cluster and would have failed
 * on a genuinely clean one.
 *
 * This runs ONCE, after the whole run finishes — deliberately NOT inside
 * `withTestDb` itself. Dropping the role mid-run would break any other test
 * file executing concurrently whose own `withTestDb` call is granting to it.
 *
 * ─── Why the drop is allowed to fail (Task B2) ────────────────────────────
 *
 * `tmm_app` is a real production role, not test-only scaffolding: the baseline
 * grants it DML on every table because the application connects as it. On a
 * developer's machine it may therefore also be referenced by a database
 * `scripts/build-db-from-repo.sh` built and did not drop, and Postgres refuses
 * to drop a role that still holds privileges anywhere in the cluster. That
 * refusal is correct and is not a test failure — it is warned, not thrown.
 * The four Supabase/GoTrue shim roles this file used to drop
 * (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`) are gone
 * along with scripts/dev/auth-shim.sql, which no longer exists.
 */

import postgres from "postgres";

// Matches db-harness.ts's own default — see that file for why.
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres";

// Roles the baseline migration creates that outlive the per-test databases
// they were created in. See packages/api/drizzle/0000_baseline.sql § 4.
const CLUSTER_ROLES = ["tmm_app"] as const;

export async function teardown(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    // IF EXISTS: tolerant of the role not existing at all (a cluster where no
    // withTestDb call ever got far enough to apply the baseline, or a rerun
    // after this teardown already dropped it). No CASCADE / DROP OWNED BY:
    // the role owns nothing — the baseline only ever GRANTs to it — and a
    // forced cleanup would be exactly the wrong response to the legitimate
    // case where a non-test database still uses it. See the header.
    await admin.unsafe(`DROP ROLE IF EXISTS ${CLUSTER_ROLES.join(", ")}`);
  } catch (err) {
    // Deliberately swallowed, not rethrown: this is cleanup for state that
    // db-harness.ts's own withTestDb() only ever creates AFTER a
    // successful connection. If DATABASE_URL is unset/unreachable, no
    // withTestDb() call could have gotten far enough to create these
    // roles in the first place, so there is nothing to clean up — and
    // this connection failure is the identical one withTestDb() already
    // reported with actionable guidance. Letting it throw here would
    // print a second, unguided, uncaught driver error underneath that
    // clear message and undermine the whole point of adding it. A real,
    // unexpected DROP ROLE failure (connection worked, something else
    // went wrong) is still visible — just as a warning, not a crash —
    // since global teardown failing outright would be a confusing way to
    // report a problem that isn't about the tests that just ran.
    console.warn(
      `[db-harness] global teardown could not drop cluster role(s) ` +
        `(${CLUSTER_ROLES.join(", ")}) — harmless if another database on this ` +
        `cluster still grants to them:`,
      err,
    );
  } finally {
    await admin.end();
  }
}
