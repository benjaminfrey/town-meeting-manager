#!/usr/bin/env bash
# Town Meeting Manager — production deployment.
# Pull → install → build → migrate → publish web → rebuild API → reload Nginx → verify.
#
# Run from the repository root on the production server.
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker compose --env-file .env.production -f infrastructure/docker-compose.production.yml"

# WEB_ROOT is where Nginx serves the static SPA from (see .env.production).
WEB_ROOT="$(grep -E '^WEB_ROOT=' .env.production | cut -d= -f2-)"
WEB_ROOT="${WEB_ROOT:-/var/www/townmeetingmanager/web}"

echo "=== Town Meeting Manager deployment — $(date) ==="

echo "==> 1/7 Pulling latest code"
git pull --ff-only origin main

echo "==> 2/7 Installing dependencies"
pnpm install --frozen-lockfile

echo "==> 3/7 Building all packages"
# VITE_* build-time vars are read from the shell env; source them so the
# web bundle is built against the production Supabase/API URLs.
set -a; . ./.env.production; set +a
pnpm turbo run build

echo "==> 4/7 Running database migrations"
./infrastructure/scripts/migrate.sh

echo "==> 5/7 Publishing web build to $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete packages/web/build/client/ "$WEB_ROOT/"

echo "==> 6/7 Rebuilding & restarting the API container"
$COMPOSE build api
$COMPOSE up -d api

echo "==> 7/7 Reloading Nginx"
$COMPOSE exec nginx nginx -s reload

echo "==> Verifying API health"
sleep 5
if $COMPOSE exec -T api node -e "require('http').get('http://localhost:3001/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"; then
  echo "    API healthy."
else
  echo "    WARNING: API health check failed — inspect: $COMPOSE logs api" >&2
fi

echo "=== Deployment completed — $(date) ==="
