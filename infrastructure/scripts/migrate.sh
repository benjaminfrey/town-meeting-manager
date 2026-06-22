#!/usr/bin/env bash
# Apply database migrations to the production Postgres container.
#
# Idempotent: tracks applied files in a schema_migrations table and skips
# anything already applied, so it is safe to re-run on every deploy.
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
