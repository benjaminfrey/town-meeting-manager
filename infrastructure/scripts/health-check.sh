#!/usr/bin/env bash
# Production health check — container health, API endpoint, Nginx, disk, and
# backup freshness. Exits non-zero if anything fails, so cron/external monitors
# can alert.
#
#   */5 * * * * /opt/town-meeting-manager/infrastructure/scripts/health-check.sh \
#               >> /var/log/tmm-health.log 2>&1
set -uo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker compose --env-file .env.production -f infrastructure/docker-compose.production.yml"
FAIL=0
ok()   { echo "  [ OK ] $1"; }
warn() { echo "  [WARN] $1"; }
fail() { echo "  [FAIL] $1"; FAIL=1; }

echo "=== TMM health check — $(date) ==="

echo "-- Containers --"
for c in tmm-db tmm-kong tmm-auth tmm-rest tmm-realtime tmm-storage tmm-meta tmm-api tmm-nginx; do
  state="$(docker inspect --format '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo missing)"
  if [ "$state" != "running" ]; then
    fail "$c ($state)"
  elif [ "$health" = "unhealthy" ]; then
    fail "$c unhealthy"
  else
    ok "$c ($state${health:+/$health})"
  fi
done

echo "-- API --"
if $COMPOSE exec -T api node -e "require('http').get('http://localhost:3001/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
  ok "API /api/health → 200"
else
  fail "API /api/health not healthy"
fi

echo "-- Nginx --"
if curl -fsS -o /dev/null http://localhost/healthz; then
  ok "Nginx :80 responding"
else
  fail "Nginx not responding on :80"
fi

echo "-- Disk --"
AVAIL_GB="$(df -P / | awk 'NR==2 {printf "%d", $4/1024/1024}')"
if [ "${AVAIL_GB:-0}" -lt 10 ]; then
  warn "Only ${AVAIL_GB}GB free on / (threshold 10GB)"
else
  ok "${AVAIL_GB}GB free on /"
fi

echo "-- Backups --"
BACKUP_DIR="$(grep -E '^BACKUP_PATH=' .env.production | cut -d= -f2- || true)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
LATEST="$(ls -t "$BACKUP_DIR"/tmm_*.dump 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  warn "No backups found in $BACKUP_DIR"
else
  AGE_H=$(( ( $(date +%s) - $(date -r "$LATEST" +%s) ) / 3600 ))
  if [ "$AGE_H" -gt 25 ]; then
    warn "Latest backup is ${AGE_H}h old: $(basename "$LATEST")"
  else
    ok "Latest backup ${AGE_H}h old: $(basename "$LATEST")"
  fi
fi

echo "=== Result: $([ $FAIL -eq 0 ] && echo HEALTHY || echo DEGRADED) ==="
exit $FAIL
