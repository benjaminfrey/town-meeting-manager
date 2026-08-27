/**
 * Postgres-backed integration test harness.
 *
 * `withTestDb(fn)` provisions a fresh, uniquely-named database, applies the
 * full migration corpus to it, hands `fn` a live `postgres.js` client, and
 * drops the database again in a `finally` — so a thrown assertion still
 * tears down and never leaks a database on the target server.
 *
 * ─── Where the test database lives, and why (Task A2, Step 3) ─────────────
 *
 * Two options were considered:
 *
 *   (a) A `postgres:17` service container in CI; developers tunnel to the
 *       project's dev VM (192.168.1.162) locally, or run Postgres locally.
 *   (b) The dev VM for both CI and local runs — one code path.
 *
 * (b) is not just less convenient than (a), it is impossible: GitHub-hosted
 * runners execute on GitHub's own network and have no route to a private
 * LAN address like 192.168.1.162. There is no tunnel a workflow step can
 * open to reach it — that would require a self-hosted runner, which this
 * repo does not have. So the VM cannot serve CI at all, independent of
 * preference. (a) also sidesteps concurrent test runs contending over one
 * shared database on a machine other people use.
 *
 * So: CI provisions a throwaway `postgres:17` service (see
 * `.github/workflows/ci.yml`) and sets `DATABASE_URL` to point at it. This
 * file only ever reads `DATABASE_URL` — it has no VM-specific or
 * CI-specific branches. Locally, a developer points `DATABASE_URL` at
 * whatever Postgres they like: a local install, or an SSH tunnel to the VM
 * (`ssh -f -N -L 15432:127.0.0.1:5432 ben@192.168.1.162
 * -o ExitOnForwardFailure=yes` and then
 * `DATABASE_URL=postgres://postgres:postgres@localhost:15432/postgres`).
 * The default below matches the CI service's own credentials purely so
 * `pnpm test` works with zero setup inside CI; it is not a claim that the
 * VM is reachable from anywhere by default.
 *
 * ─── Why `postgres.js` and not `pg` ─────────────────────────────────────
 *
 * The project standardizes on both `postgres` (postgres.js) and `pg`
 * depending on use case — `pg` is expected to back the dedicated `LISTEN`
 * connection later. For this harness, `postgres.js` is the simpler choice
 * for two concrete reasons: its tagged-template query API
 * (`` sql`SELECT ...` ``) is exactly what test code should be able to write
 * against the client this harness hands back, and its `sql.file(path)`
 * applies a whole multi-statement `.sql` file (including `DO $$ ... $$`
 * blocks) in one call, which is what applying the auth shim and each
 * migration file needs. Using `pg` here would mean either building a
 * template-tag wrapper by hand or hand-rolling multi-statement file
 * execution — extra code for no benefit, since nothing about database
 * provisioning needs `pg`'s feature set.
 */

import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/api/src/test -> repo root
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");

const AUTH_SHIM_PATH = path.join(REPO_ROOT, "scripts", "dev", "auth-shim.sql");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

// Matches the CI `postgres:17` service defined in .github/workflows/ci.yml.
// Not a claim that this resolves anywhere outside CI — see the file header.
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres";

/**
 * Migration files this harness is known NOT to be able to apply cleanly,
 * and why. Both are pre-existing, previously-documented defects in the
 * migration corpus itself (see scripts/build-db-from-repo.sh's own header
 * comment and .superpowers/sdd/2026-08-26-tmm-revival-master-plan/task-7-report.md)
 * — not bugs in this harness. Tolerating them here is a deliberate,
 * narrow allowance: matched by BOTH the exact migration filename AND the
 * expected error text, so an unrelated failure in either file still
 * aborts the harness instead of being silently swallowed.
 */
const TOLERATED_MIGRATION_FAILURES: ReadonlyArray<{
  file: string;
  messageIncludes: string;
  reason: string;
}> = [
  {
    file: "20260311000003_session_0603_storage_bucket.sql",
    messageIncludes: "storage.foldername",
    reason:
      "The auth shim deliberately does not implement storage.foldername() " +
      "(scripts/dev/auth-shim.sql's header explains why: a stub that faked " +
      "it would misrepresent how much of the corpus is actually proven).",
  },
  {
    file: "20260826000001_merge_notification_system.sql",
    messageIncludes: "postmark_message_id",
    reason:
      "Known notification-schema collision in the migration corpus itself " +
      "(a later migration's column reference outruns this one's shape). " +
      "Not introduced by, or fixable from, this harness.",
  },
];

function generateTestDbName(): string {
  // Lowercase alphanumeric + underscore only, well under Postgres's 63-byte
  // identifier limit, and generated by us (never from external input), so
  // it is safe to interpolate directly into DDL below.
  const suffix = randomBytes(6).toString("hex");
  return `tmm_test_${Date.now().toString(36)}_${suffix}`;
}

/**
 * Provision an isolated Postgres database, apply the migration corpus to
 * it, run `fn` against a live client, and drop the database afterward —
 * even if `fn` throws.
 */
export async function withTestDb<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const dbName = generateTestDbName();

  // Maintenance connection: whatever database DATABASE_URL points at
  // (typically the server's default "postgres" database). Used only to
  // CREATE/DROP the per-test database — never to run application queries.
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    // CREATE DATABASE cannot run inside a transaction block; a bare
    // postgres.js query outside `sql.begin()` is not wrapped in one, so
    // this is safe as a single statement.
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);

    let sql: postgres.Sql | undefined;
    try {
      // Same connection details as `databaseUrl`, pointed at the new
      // database instead of the maintenance one.
      sql = postgres(databaseUrl, { database: dbName, max: 1, onnotice: () => {} });

      // TODO(B2): remove this call once the Drizzle baseline (Task B2)
      // drops the migration corpus's dependency on Supabase GoTrue's
      // `auth` schema and Storage's `storage` schema. Until then, every
      // fresh database needs the same auth.uid()/auth.jwt() stubs and
      // storage.buckets/storage.objects tables that
      // scripts/build-db-from-repo.sh's header documents as missing on
      // plain Postgres. This is temporary scaffolding with a named
      // removal point, not a permanent dependency of this harness.
      await sql.file(AUTH_SHIM_PATH);

      await applyMigrations(sql);

      return await fn(sql);
    } finally {
      await sql?.end();
    }
  } finally {
    // WITH (FORCE) drops connections to the target database first, so a
    // leaked client from `fn` throwing before `sql.end()` above still
    // cannot block teardown. Postgres has supported this since v13.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
}

async function applyMigrations(sql: postgres.Sql): Promise<void> {
  // Same file list, same order, that scripts/build-db-from-repo.sh uses —
  // both read supabase/migrations/*.sql sorted lexicographically (the
  // migration filenames are zero-padded timestamps, so lexicographic order
  // is chronological order), so this harness and the Stage 0 gate can
  // never quietly diverge on which migrations exist or what order they
  // apply in.
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    try {
      await sql.file(path.join(MIGRATIONS_DIR, file));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const tolerated = TOLERATED_MIGRATION_FAILURES.find(
        (t) => t.file === file && message.includes(t.messageIncludes),
      );

      if (!tolerated) {
        throw err;
      }

      // Deliberate, not debug noise: records exactly which known failure
      // was tolerated and why, so a harness run is never silently missing
      // part of the corpus.
      console.warn(`[db-harness] tolerating known failure in ${file}: ${tolerated.reason}`);
    }
  }
}
