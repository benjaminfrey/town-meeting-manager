#!/usr/bin/env bash
# Daily PostgreSQL backup — custom-format dump (selective restore) + plain SQL
# (emergency recovery), with retention pruning. Database name is `postgres`
# (self-hosted Supabase initializes everything there).
#
# Schedule via cron (low-activity hour for Maine town halls):
#   0 2 * * * /opt/town-meeting-manager/infrastructure/scripts/backup.sh \
#             >> /var/log/tmm-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker compose --env-file .env.production -f infrastructure/docker-compose.production.yml"

BACKUP_DIR="$(grep -E '^BACKUP_PATH=' .env.production | cut -d= -f2- || true)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
RETENTION_DAYS="$(grep -E '^BACKUP_RETENTION_DAYS=' .env.production | cut -d= -f2- || true)"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup -> $BACKUP_DIR"

# Custom format (-Fc), max compression (-Z 9) — restore with pg_restore.
$COMPOSE exec -T db pg_dump -U postgres -Fc -Z 9 postgres \
  > "$BACKUP_DIR/tmm_${TIMESTAMP}.dump"

# Plain SQL fallback for emergency recovery.
$COMPOSE exec -T db pg_dump -U postgres --clean --if-exists postgres \
  | gzip > "$BACKUP_DIR/tmm_${TIMESTAMP}.sql.gz"

# Prune old backups.
find "$BACKUP_DIR" -name 'tmm_*.dump'   -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'tmm_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

SIZE="$(du -sh "$BACKUP_DIR/tmm_${TIMESTAMP}.dump" | cut -f1)"
echo "[$(date)] Backup completed: tmm_${TIMESTAMP}.dump ($SIZE)"

# Sanity-check the dump is a valid archive.
if ! $COMPOSE exec -T db pg_restore --list - < "$BACKUP_DIR/tmm_${TIMESTAMP}.dump" > /dev/null 2>&1; then
  echo "[$(date)] WARNING: pg_restore could not read the new dump!" >&2
  exit 1
fi
