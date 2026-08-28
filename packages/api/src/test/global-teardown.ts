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

  // Only drop the role on a cluster this process actually provisioned test
  // databases on. `tmm_app` is a production role: on a staging or production
  // cluster it may hold a LOGIN attribute and a password set out of band, and
  // if it happens to hold no grants there the DROP would SUCCEED and destroy
  // them. pg_shdepend protects the common case and nothing protects that one.
  //
  // db-harness.ts refuses to run without a reachable DATABASE_URL, so a run
  // that created anything worth cleaning up had one. Requiring it here costs a
  // no-op teardown on a run that created nothing, and removes the only path by
  // which this file can touch a cluster the tests never used.
  if (!process.env.DATABASE_URL) {
    return;
  }

  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    // IF EXISTS: tolerant of the role not existing at all (a cluster where no
    // withTestDb call ever got far enough to apply the baseline, or a rerun
    // after this teardown already dropped it). No CASCADE / DROP OWNED BY:
    // the role owns nothing — the baseline only ever GRANTs to it — and a
    // forced cleanup would be exactly the wrong response to the legitimate
    // case where a non-test database still uses it. See the header.
    await admin.unsafe(`DROP ROLE IF EXISTS ${CLUSTER_ROLES.join(", ")}`);

    // Safety net for the isolation gate's FORCE test (Task B3), which creates
    // a uniquely-named `tmm_force_probe_*` role, takes ownership of the test
    // database's tables with it, and drops it again in its own `finally`. That
    // finally covers a failing assertion; it does not cover the process being
    // killed. These roles are cluster-scoped and would otherwise accumulate,
    // which is the leak this file exists to prevent.
    //
    // Safe to sweep unconditionally: unlike `tmm_app`, nothing outside that
    // test ever creates this prefix, and by the time teardown runs every
    // database that could have referenced one has been dropped. Roles still
    // holding privileges somewhere make DROP ROLE fail, which lands in the
    // warning below rather than deleting anything unexpected.
    const leaked = await admin<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname LIKE 'tmm\\_force\\_probe\\_%'
    `;
    for (const role of leaked) {
      await admin.unsafe(`DROP ROLE IF EXISTS "${role.rolname}"`);
    }
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
