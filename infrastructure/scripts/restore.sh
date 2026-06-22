#!/usr/bin/env bash
# Restore the production database from a custom-format dump created by backup.sh.
# DESTRUCTIVE — replaces current data.
#
# Usage:  ./infrastructure/scripts/restore.sh /var/backups/postgres/tmm_YYYYMMDD_HHMMSS.dump
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker compose --env-file .env.production -f infrastructure/docker-compose.production.yml"
BACKUP_FILE="${1:-}"
BACKUP_DIR="$(grep -E '^BACKUP_PATH=' .env.production | cut -d= -f2- || true)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file.dump>"
  echo "Available backups:"
  ls -la "$BACKUP_DIR"/tmm_*.dump 2>/dev/null || echo "  (none in $BACKUP_DIR)"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "WARNING: this will REPLACE the current database with:"
echo "  $BACKUP_FILE"
read -r -p "Type 'yes' to continue: " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Cancelled."; exit 0; }

echo "==> Stopping the API (keeps DB up)"
$COMPOSE stop api

echo "==> Restoring database"
# --clean --if-exists drops existing objects before recreating them.
$COMPOSE exec -T db pg_restore -U postgres -d postgres --clean --if-exists --no-owner \
  < "$BACKUP_FILE"

echo "==> Restarting services"
$COMPOSE up -d

echo "==> Restore complete. Verify with ./infrastructure/scripts/health-check.sh"
