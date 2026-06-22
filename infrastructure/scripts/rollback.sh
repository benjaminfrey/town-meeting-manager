#!/usr/bin/env bash
# Roll the application back to a previous commit and redeploy.
# Does NOT reverse database migrations — review those manually if needed.
#
# Usage:  ./infrastructure/scripts/rollback.sh <commit_hash>
set -euo pipefail

cd "$(dirname "$0")/../.."

COMMIT="${1:-}"
if [ -z "$COMMIT" ]; then
  echo "Usage: $0 <commit_hash>"
  echo "Recent commits:"
  git log --oneline -10
  exit 1
fi

COMPOSE="docker compose --env-file .env.production -f infrastructure/docker-compose.production.yml"
WEB_ROOT="$(grep -E '^WEB_ROOT=' .env.production | cut -d= -f2-)"
WEB_ROOT="${WEB_ROOT:-/var/www/townmeetingmanager/web}"

echo "==> Rolling back to $COMMIT"
git checkout "$COMMIT"

pnpm install --frozen-lockfile
set -a; . ./.env.production; set +a
pnpm turbo run build

sudo rsync -a --delete packages/web/build/client/ "$WEB_ROOT/"
$COMPOSE build api
$COMPOSE up -d api
$COMPOSE exec nginx nginx -s reload

echo "==> Rollback complete."
echo "    NOTE: database migrations are NOT auto-reversed. If the rolled-back"
echo "    code is incompatible with a newer schema, restore a DB backup with"
echo "    ./infrastructure/scripts/restore.sh"
