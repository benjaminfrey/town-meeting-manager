# Town Meeting Manager — Production Deployment

Self-hosted deployment on a single dedicated server, serving a small number of
Maine towns (≈3 for beta) from one Supabase stack isolated by Row Level
Security. Per [advisory 3.2](advisory-resolutions/3.2-supabase-hosting.md).

All configuration lives in [`infrastructure/`](../infrastructure):

| File | Purpose |
|------|---------|
| `docker-compose.production.yml` | Full stack: Supabase services + Fastify API + Nginx |
| `nginx/nginx.conf` | Reverse proxy (app, api, supabase, studio, portal) |
| `scripts/ssl-setup.sh` | Wildcard TLS via Let's Encrypt (DNS-01) |
| `scripts/deploy.sh` · `rollback.sh` · `migrate.sh` | Release automation |
| `scripts/backup.sh` · `restore.sh` | Database backup / restore |
| `scripts/health-check.sh` | Monitoring (containers, API, disk, backups) |
| `../.env.production.example` | Every required secret, documented |

> **How this differs from a generic Supabase deploy** (intentional, grounded in
> the code):
> - **Database name is `postgres`**, not `town_meeting_manager`. The
>   `supabase/postgres` image initializes its roles and schemas in `postgres`,
>   and every file in `supabase/migrations/` assumes it.
> - **Puppeteer runs in-process** inside the API container
>   (`packages/api/src/services/puppeteer.ts`) — there is no separate Puppeteer
>   service. PDF memory is bounded by the API container's `mem_limit` and
>   `NODE_OPTIONS=--max-old-space-size=512`.
> - **`supabase.townmeetingmanager.com` is a public API host** (Kong) — it is
>   what the browser's `supabase-js` talks to (`VITE_SUPABASE_URL`), protected
>   by JWT + RLS. **Studio** is a *separate*, IP-restricted host.

---

## 1. Server requirements

- Ubuntu 22.04+ (or any Docker host), 4+ CPU cores, 8+ GB RAM, 100+ GB SSD
- Public IPv4, ports 80/443 open
- A registered domain (examples below use `townmeetingmanager.com`)

## 2. Install prerequisites

```bash
# Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker

# Node 20 + pnpm + certbot (with the Cloudflare DNS plugin)
sudo apt-get install -y nodejs npm git python3-certbot-dns-cloudflare
sudo corepack enable && corepack prepare pnpm@9.15.4 --activate
```

## 3. Clone

```bash
sudo mkdir -p /opt/town-meeting-manager && sudo chown "$USER" /opt/town-meeting-manager
git clone <repo-url> /opt/town-meeting-manager
cd /opt/town-meeting-manager
```

## 4. DNS records

Point all of these at the server's IP:

| Record | Type | Host |
|--------|------|------|
| `townmeetingmanager.com` | A | server IP |
| `app` | A | server IP — admin / board UI |
| `api` | A | server IP — Fastify API |
| `supabase` | A | server IP — **public** Supabase API (Kong) |
| `studio` | A | server IP — admin DB UI (IP-restricted at Nginx) |
| `*` | A | server IP — per-town public portals |

## 5. Secrets & environment

```bash
cp .env.production.example .env.production
```

Generate the secrets, then paste them into `.env.production`:

```bash
openssl rand -base64 32      # JWT_SECRET
openssl rand -base64 48      # SECRET_KEY_BASE
openssl rand -hex 32         # APP_SECRET
npx web-push generate-vapid-keys   # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

Generate the Supabase **anon** and **service_role** keys (JWTs signed with
`JWT_SECRET`) per the
[self-hosting API-keys guide](https://supabase.com/docs/guides/self-hosting#api-keys),
and set `VITE_SUPABASE_ANON_KEY = ANON_KEY`.

Set `SMTP_*` to a real relay (Postmark SMTP works: host `smtp.postmarkapp.com`,
port 587, user = pass = your Postmark server token). The `VITE_*` values are
**build-time** — they bake into the static web bundle and must equal the public
URLs above.

## 6. TLS certificate (wildcard)

```bash
./infrastructure/scripts/ssl-setup.sh
```

This obtains `*.townmeetingmanager.com` via DNS-01 and installs an auto-renew
hook that reloads Nginx. (Wildcards cannot use HTTP-01.)

## 7. First deploy

```bash
# Bring up the Supabase stack + Nginx first
docker compose --env-file .env.production \
  -f infrastructure/docker-compose.production.yml up -d

# Build, migrate, publish web, (re)start API, reload Nginx
./infrastructure/scripts/deploy.sh
```

`deploy.sh` runs `migrate.sh`, which applies every file in
`supabase/migrations/` exactly once (tracked in a `schema_migrations` table).

## 8. First admin account

Create the initial admin via Studio (`https://studio.townmeetingmanager.com`,
from an allowed IP) or with the service-role key:

```bash
curl -X POST https://supabase.townmeetingmanager.com/auth/v1/admin/users \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourtown.gov","password":"<temp>","email_confirm":true}'
```

Then sign in at `https://app.townmeetingmanager.com` and run the onboarding
wizard.

## 9. Verify

```bash
./infrastructure/scripts/health-check.sh
curl -fsS https://api.townmeetingmanager.com/api/health   # {"status":"ok",...}
```

Open `https://app.townmeetingmanager.com` and a town portal
(`https://<town>.townmeetingmanager.com`).

## 10. Scheduled jobs

```cron
# Backups — daily at 02:00
0 2 * * * cd /opt/town-meeting-manager && ./infrastructure/scripts/backup.sh >> /var/log/tmm-backup.log 2>&1
# Health — every 5 minutes
*/5 * * * * cd /opt/town-meeting-manager && ./infrastructure/scripts/health-check.sh >> /var/log/tmm-health.log 2>&1
```

## 11. Postmark sender domain

In Postmark, verify the sending domain and add the SPF, DKIM, and DMARC DNS
records it provides, so meeting-notice and minutes emails are not spam-filtered.

---

## Upgrades

```bash
cd /opt/town-meeting-manager
./infrastructure/scripts/deploy.sh        # pull → build → migrate → release
```

If a release misbehaves:

```bash
./infrastructure/scripts/rollback.sh <previous_commit>
# If the schema moved forward incompatibly, restore a backup:
./infrastructure/scripts/restore.sh /var/backups/postgres/tmm_<ts>.dump
```

## Backup & restore

```bash
./infrastructure/scripts/backup.sh                              # manual backup
./infrastructure/scripts/restore.sh /var/backups/postgres/tmm_<ts>.dump
```

Backups keep `BACKUP_RETENTION_DAYS` (default 30) of compressed custom-format
dumps **and** plain-SQL fallbacks. `backup.sh` verifies each new dump with
`pg_restore --list`.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| A service won't start | `docker compose -f infrastructure/docker-compose.production.yml logs <svc>` |
| Browser can't reach Supabase | DNS for `supabase.*`; that `VITE_SUPABASE_URL` matches it; cert covers it |
| Realtime not updating | WebSocket upgrade on the `supabase.*` Nginx block; `wal_level=logical` |
| Auth emails missing | `SMTP_*` values; Postmark activity log |
| PDF generation fails | API container memory; `docker compose logs api` for Chromium errors |
| TLS renew failed | `CLOUDFLARE_API_TOKEN`; `sudo certbot renew --dry-run` |
| Studio 403 | add your IP to the `allow` lines in `nginx/nginx.conf`, reload Nginx |

View logs: `docker compose -f infrastructure/docker-compose.production.yml logs -f <service>`
Direct DB access: `docker exec -it tmm-db psql -U postgres`
