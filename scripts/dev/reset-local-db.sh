#!/usr/bin/env bash
#
# Build a local development database from the repository, end to end.
#
# Replaces `pnpm supabase:up` and the nine-container Supabase stack, which
# Phase F retired. The database is a plain Postgres — the schema needs no
# extensions, and CI has always run `postgres:17`.
#
# What it does, in order:
#   1. creates the owner role and the database (dropping any previous one)
#   2. applies the migration corpus + seed via scripts/build-db-from-repo.sh,
#      which refuses to run as a superuser — that refusal is the point: the
#      corpus must apply as a production-shaped role
#   3. creates a Better Auth login for every seeded account
#   4. prints what was built and what to sign in as
#
# Usage:  scripts/dev/reset-local-db.sh [dbname]
#         ADMIN_URL   maintenance connection (default postgres://$USER@localhost:5432/postgres)
#
set -euo pipefail

DB_NAME="${1:-tmm_dev}"
OWNER_ROLE="tmm_owner"
ADMIN_URL="${ADMIN_URL:-postgres://$USER@localhost:5432/postgres}"
DEV_PASSWORD="${DEV_PASSWORD:-TownMeeting!Dev1}"
SEED_TOWN_ID="${SEED_TOWN_ID:-a1b2c3d4-e5f6-7890-abcd-ef1234567890}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qAt <<SQL
DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
    CREATE ROLE ${OWNER_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END \$\$;
CREATE DATABASE ${DB_NAME} OWNER ${OWNER_ROLE};
SQL

OWNER_URL="postgres://${OWNER_ROLE}@localhost:5432/${DB_NAME}"

echo "==> Building schema and seed as ${OWNER_ROLE}"
./scripts/build-db-from-repo.sh "$OWNER_URL"

echo "==> Creating development logins"
DATABASE_URL="$OWNER_URL" DEV_PASSWORD="$DEV_PASSWORD" \
  pnpm --filter @town-meeting/api exec tsx src/dev/seed-dev-logins-cli.ts

echo
echo "Database : ${DB_NAME} (owner ${OWNER_ROLE})"
echo "Connect  : ${OWNER_URL}"
# `town` and `user_account` are under FORCE ROW LEVEL SECURITY, which binds the
# owner too: a bare count reads 0 with no tenant set. Set the seed's town for
# the length of this one session so the numbers are the real ones.
psql "$OWNER_URL" -qAt \
  -c "SELECT set_config('app.town_id', '${SEED_TOWN_ID}', false)" \
  -c "SELECT 'towns: ' || count(*) FROM town" \
  -c "SELECT 'accounts: ' || count(*) FROM user_account" \
  | grep -v '^a1b2c3d4'
# better_auth has no RLS by design, so this one needs no tenant.
psql "$OWNER_URL" -qAt -c "SELECT 'logins: ' || count(*) FROM better_auth.\"user\""
echo
echo "Put this in packages/api/.env:"
echo "  DATABASE_URL=${OWNER_URL}"
