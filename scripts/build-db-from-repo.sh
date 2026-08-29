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

# ─── The connecting role is part of what this gate proves ────────────────
#
# A superuser (or any role with BYPASSRLS) is exempt from every row-level
# security policy in the corpus. That makes a build as such a role strictly
# weaker than a production migration: statements that abort for `tmm_owner`
# succeed silently, and the script reports a green build for a corpus that
# cannot be applied.
#
# This is not hypothetical. `0002_invitation_tenant_bootstrap.sql` used
# `SET row_security = off` for its backfill, which raises `query would be
# affected by row-level security policy for table "invitation"` for anything
# that is not BYPASSRLS. It aborted this script at migration 3 of 4 as
# `tmm_owner` — and passed for months as a superuser, here and in CI (whose
# DATABASE_URL is `postgres`). Nothing after it was ever applied on a
# production-shaped role.
#
# So: refuse. The remedy is one-time cluster setup, printed below. The escape
# hatch exists because a developer poking at a scratch database has a real
# reason to skip it, but it has to be typed — which is the whole point, since
# the defect above hid precisely in nobody thinking about the role at all.
privileges=$(psql "$DB_URL" -tAc \
  "SELECT current_user || ' ' || rolsuper::text || ' ' || rolbypassrls::text
     FROM pg_roles WHERE rolname = current_user")
read -r connected_role is_super is_bypassrls <<<"$privileges"

if [ -z "${connected_role:-}" ]; then
  echo "ERROR: could not determine the connecting role from $DB_URL" >&2
  exit 1
fi

if [ "$is_super" = "true" ] || [ "$is_bypassrls" = "true" ]; then
  if [ "${ALLOW_SUPERUSER_BUILD:-}" = "1" ]; then
    echo "WARNING: building as '$connected_role', which bypasses row-level security." >&2
    echo "         ALLOW_SUPERUSER_BUILD=1 is set, so this build is proceeding — but it" >&2
    echo "         does NOT prove the corpus applies in production. Re-run as a" >&2
    echo "         non-superuser, non-BYPASSRLS owner before trusting the result." >&2
  else
    echo "ERROR: connected as '$connected_role' (superuser=$is_super, bypassrls=$is_bypassrls)." >&2
    echo "       This gate exists to prove the repository can build the production" >&2
    echo "       database. A role that bypasses RLS cannot prove that: every policy in" >&2
    echo "       the corpus is inert for it, so migrations that abort in production" >&2
    echo "       succeed here. Run as the schema owner instead:" >&2
    echo "" >&2
    echo "         CREATE ROLE tmm_owner LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;" >&2
    echo "         CREATE DATABASE <db> OWNER tmm_owner;" >&2
    echo "         GRANT tmm_app TO tmm_owner;   -- if tmm_app already exists" >&2
    echo "         $0 postgres://tmm_owner@<host>/<db>" >&2
    echo "" >&2
    echo "       To build anyway, knowing the result proves less: ALLOW_SUPERUSER_BUILD=1" >&2
    exit 1
  fi
else
  echo "==> Connecting role: $connected_role (superuser=$is_super, bypassrls=$is_bypassrls)"
fi

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

# `better_auth` is reset alongside `public` (Stage 1, Task C1). It holds Better
# Auth's four tables and the identity->town mapping, deliberately outside
# `public` and outside RLS — see packages/api/drizzle/
# 0001_better_auth_and_tenant_bridge.sql § 1. Resetting only `public` would
# leave that schema behind, and the second run of this script would abort on
# `CREATE SCHEMA better_auth` — turning "the repo can rebuild the database" into
# "the repo can rebuild the database exactly once". CASCADE also removes the
# cross-schema foreign key public.user_account.auth_user_id -> better_auth.user,
# which is why the drop order does not matter.
echo "==> Resetting public and better_auth schemas"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS better_auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

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
