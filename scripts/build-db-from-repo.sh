#!/usr/bin/env bash
# Build a complete database from the repository alone.
# This is Stage 1's gate: if this fails, the repo is not the source of truth.
#
# Honesty contract: this script does not swallow errors to reach a green
# exit. `set -euo pipefail` plus `-v ON_ERROR_STOP=1` on every psql call
# means the first migration or seed statement that fails aborts the whole
# script with a non-zero exit and the real psql error on stderr — it never
# limps past a broken statement and reports success on a partial build.
# There is no tolerance list here, and there is no longer one in
# packages/api/src/test/db-harness.ts either.
#
# ─── What changed in Stage 1, Task B2 ────────────────────────────────────
#
# This script used to apply supabase/migrations/*.sql and could not reach a
# clean exit, because 4 of those 58 files reference Supabase GoTrue's `auth`
# schema and Storage's `storage` schema, which do not exist on plain
# PostgreSQL. The first of them (`user_account.auth_user_id REFERENCES
# auth.users`, 20260308000004:26) aborted the build at file 4 of 58.
#
# The schema now lives in packages/api/drizzle/, as a single squashed
# baseline with no auth.* or storage.* dependency of any kind. That is what
# this script applies. supabase/migrations/ stays in the repository,
# unmodified, purely as the historical record of how the schema got here —
# nothing applies it any more, and nothing can.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_URL="${1:?usage: build-db-from-repo.sh <postgres-url>}"

MIGRATIONS_DIR="packages/api/drizzle"
JOURNAL="$MIGRATIONS_DIR/meta/_journal.json"

# The journal is drizzle-kit's record of which migrations exist. Applying a
# sorted glob is simpler than parsing JSON in bash, but a sorted glob would
# also happily apply a stray .sql file nobody registered — so cross-check the
# two counts and refuse to build if they disagree. Same list, same order, that
# packages/api/src/test/db-harness.ts uses.
shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

journal_entries=$(grep -c '"tag"' "$JOURNAL")
if [ "${#migrations[@]}" -ne "$journal_entries" ]; then
  echo "ERROR: $MIGRATIONS_DIR has ${#migrations[@]} .sql file(s) but $JOURNAL records $journal_entries." >&2
  echo "       Refusing to build: an unregistered migration file is either a stray" >&2
  echo "       artifact or a migration that will never be applied in production." >&2
  exit 1
fi
if [ "${#migrations[@]}" -eq 0 ]; then
  echo "ERROR: no migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi

echo "==> Resetting public schema"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "==> Applying migrations in order"
for file in "${migrations[@]}"; do
  echo "    $(basename "$file")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "==> Applying seed"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

echo "==> Table count"
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"

# The security properties this build exists to establish. Reported, not just
# assumed: a build that produced 27 tables with RLS off would otherwise look
# exactly like a good one.
echo "==> RLS enabled / forced (must be equal, and equal to the table count)"
psql "$DB_URL" -tAc "SELECT count(*) FILTER (WHERE relrowsecurity) || ' enabled, ' || count(*) FILTER (WHERE relforcerowsecurity) || ' forced' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r';"
