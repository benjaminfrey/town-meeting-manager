/**
 * Vitest global teardown: drops the four Supabase/GoTrue shim roles that
 * scripts/dev/auth-shim.sql creates (`anon`, `authenticated`,
 * `service_role`, `supabase_auth_admin`) after the entire test run
 * completes.
 *
 * Roles are cluster-scoped, not database-scoped: `withTestDb`'s
 * `DROP DATABASE ... WITH (FORCE)` in db-harness.ts removes each per-test
 * database, but does NOT remove roles created inside it. Left alone, these
 * four roles accumulate on whatever Postgres cluster the tests ran
 * against, and the shim's `CREATE ROLE ... EXCEPTION WHEN duplicate_object
 * THEN NULL` guard means a stale (or previously mutated) role is silently
 * reused on the next run rather than surfaced — so a "clean" local run can
 * rest on role state that was never actually clean. This is the same class
 * of leak that, one stage earlier, masked a real failure mode: a
 * `GRANT ... TO authenticated` in the migration corpus succeeds on a
 * polluted cluster and would fail on a genuinely clean one.
 *
 * This runs ONCE, after the whole run finishes — deliberately NOT inside
 * `withTestDb` itself. Dropping the roles mid-run would break any other
 * test file executing concurrently that still needs them to apply
 * auth-shim.sql for its own `withTestDb` calls.
 *
 * TODO(B2): delete this file along with scripts/dev/auth-shim.sql once the
 * Drizzle baseline (Task B2) drops the migration corpus's dependency on
 * Supabase's auth/storage schemas — these roles will no longer be created
 * in the first place.
 */

import postgres from "postgres";

// Matches db-harness.ts's own default — see that file for why.
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres";

const SHIM_ROLES = ["anon", "authenticated", "service_role", "supabase_auth_admin"] as const;

export async function teardown(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    // IF EXISTS: tolerant of the roles not existing at all (a cluster that
    // never ran the shim, or a rerun after this teardown already dropped
    // them). No CASCADE / DROP OWNED BY: this harness and the migration
    // corpus only ever GRANT privileges to these roles inside per-test
    // databases that are already gone by the time this runs — the roles
    // themselves never own anything — so a plain DROP ROLE is tolerant of
    // that "owns nothing" case too, with nothing extra to clean up first.
    await admin.unsafe(`DROP ROLE IF EXISTS ${SHIM_ROLES.join(", ")}`);
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
      `[db-harness] global teardown could not drop shim roles (${SHIM_ROLES.join(", ")}):`,
      err,
    );
  } finally {
    await admin.end();
  }
}
