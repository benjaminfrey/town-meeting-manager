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
#   3. grants tmm_app to the owner role on the ADMIN connection, and verifies
#      the grant actually works by SET ROLE-ing as the owner — see the
#      comment above that step for why this can't be skipped or left as a
#      warning
#   4. creates a Better Auth login for every seeded account
#   5. prints what was built, both connection strings, and what to sign in as
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

# `0000_baseline.sql` § 4 tries this same GRANT for itself, from the OWNER
# connection, as a courtesy — and on a bootstrap-built cluster it can't
# succeed: granting a role requires ADMIN OPTION on that role (or superuser),
# which the owner does not have. The migration only WARNs and moves on
# (`could not GRANT tmm_app TO tmm_owner`), because failing the whole build
# over a grant that a superuser can also apply out of band would be wrong —
# but a warning nobody reads is exactly how this got missed before, so this
# script does not repeat that mistake. It runs the grant here, on the ADMIN
# connection, which — unlike the owner — is a superuser and can always do it.
echo "==> Granting tmm_app to ${OWNER_ROLE} (admin connection)"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "GRANT tmm_app TO ${OWNER_ROLE}"

# Prove the grant actually works, rather than trusting that GRANT succeeding
# means SET ROLE will too. This is the runtime shape the API depends on
# (`options=-c role=tmm_app` on every connection) — if it's broken, every
# other passing check in this script is beside the point.
echo "==> Verifying ${OWNER_ROLE} can SET ROLE tmm_app"
if set_role_check=$(psql "$OWNER_URL" -v ON_ERROR_STOP=1 -qAt \
  -c "SET ROLE tmm_app" -c "SELECT current_user" 2>&1); then
  echo "    OK — SET ROLE tmm_app succeeds; current_user reports '${set_role_check}'"
else
  echo "ERROR: ${OWNER_ROLE} still cannot SET ROLE tmm_app after GRANT tmm_app TO ${OWNER_ROLE}." >&2
  echo "       The runtime connection string the API uses (DATABASE_URL with" >&2
  echo "       options=-c role=tmm_app) depends on exactly this working. psql said:" >&2
  echo "$set_role_check" | sed 's/^/       /' >&2
  exit 1
fi

echo "==> Creating development logins"
DATABASE_URL="$OWNER_URL" DEV_PASSWORD="$DEV_PASSWORD" \
  pnpm --filter @town-meeting/api exec tsx src/dev/seed-dev-logins-cli.ts

# The runtime role connects as the owner and asks Postgres to SET ROLE at
# connection start (`options=-c role=tmm_app`) — tmm_app is NOLOGIN by design
# (0000_baseline.sql § 4), so it can never be connected to directly. Encoded
# exactly like packages/api/.env.example already documents this trick.
RUNTIME_URL="postgres://${OWNER_ROLE}@localhost:5432/${DB_NAME}?options=-c%20role%3Dtmm_app"

echo
echo "Database    : ${DB_NAME} (owner ${OWNER_ROLE})"
echo "Owner URL   : ${OWNER_URL}                 (tooling / migrations — bypasses RLS, never the API)"
echo "Runtime URL : ${RUNTIME_URL}   (what the API should use — non-owner, RLS-bound)"
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
echo "  DATABASE_URL=${RUNTIME_URL}"
