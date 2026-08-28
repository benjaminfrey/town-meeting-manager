#!/usr/bin/env bash
# Apply database migrations to the production Postgres container.
#
# Idempotent: tracks applied files in a schema_migrations table and skips
# anything already applied, so it is safe to re-run on every deploy.
#
# INOPERATIVE as of Stage 1 Task B2. It loops supabase/migrations/*.sql,
# which is no longer applied by anything and no longer CAN be: that corpus
# depends on Supabase GoTrue's `auth` schema and aborts at file 4 of 58 on
# plain Postgres. The schema now lives in packages/api/drizzle/ and is
# applied by scripts/build-db-from-repo.sh. This script also targets the
# legacy Docker Compose deploy, and Docker was removed from the VM.
#
# Left in place rather than deleted because Task G2 owns decommissioning the
# whole Docker deployment path in one piece; running it today would fail
# loudly at the first migration, not corrupt anything.
#
# Run from the repository root.
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker compose --env-file .env.production -f infrastructure/docker-compose.production.yml"
PSQL="$COMPOSE exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1"

echo "==> Ensuring schema_migrations tracking table exists"
$PSQL -q -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);"

applied=0
skipped=0
# Single source of truth. docker/migrations/ was merged into this directory
# on 2026-08-26 — it had never been read by this script. Do not add a second
# migration directory; tooling reads only this one.
for file in supabase/migrations/*.sql; do
  name="$(basename "$file")"
  already="$($PSQL -tAq -c "SELECT 1 FROM public.schema_migrations WHERE filename = '$name'" || true)"
  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "==> Applying $name"
  $PSQL < "$file"
  $PSQL -q -c "INSERT INTO public.schema_migrations (filename) VALUES ('$name')"
  applied=$((applied + 1))
done

echo "==> Migrations complete: $applied applied, $skipped already present"
