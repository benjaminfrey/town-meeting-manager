#!/usr/bin/env bash
# One-time wildcard TLS setup with Let's Encrypt (DNS-01 challenge).
#
# A wildcard cert (*.townmeetingmanager.com) cannot use HTTP-01 — it requires
# DNS-01, so certbot needs API access to your DNS provider. This script assumes
# Cloudflare; swap the plugin/credentials for Route53/etc. as needed.
#
# Reads CERTBOT_EMAIL and CLOUDFLARE_API_TOKEN from .env.production.
set -euo pipefail

cd "$(dirname "$0")/../.."
set -a; . ./.env.production; set +a

DOMAIN=townmeetingmanager.com
CREDS=/etc/certbot/cloudflare.ini

echo "==> Writing Cloudflare credentials to $CREDS"
sudo mkdir -p "$(dirname "$CREDS")"
echo "dns_cloudflare_api_token = ${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN in .env.production}" | sudo tee "$CREDS" > /dev/null
sudo chmod 600 "$CREDS"

echo "==> Requesting wildcard certificate for $DOMAIN and *.$DOMAIN"
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials "$CREDS" \
  --dns-cloudflare-propagation-seconds 30 \
  -d "$DOMAIN" \
  -d "*.$DOMAIN" \
  --agree-tos --non-interactive \
  --email "${CERTBOT_EMAIL:?set CERTBOT_EMAIL in .env.production}"

echo "==> Installing auto-renewal hook (reloads the Nginx container after renewal)"
HOOK=/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo mkdir -p "$(dirname "$HOOK")"
sudo tee "$HOOK" > /dev/null <<EOF
#!/usr/bin/env bash
cd $(pwd)
docker compose --env-file .env.production -f infrastructure/docker-compose.production.yml exec nginx nginx -s reload
EOF
sudo chmod +x "$HOOK"

echo "==> Done. Certs live at /etc/letsencrypt/live/$DOMAIN/"
echo "    certbot's systemd timer (or 'certbot renew') handles renewal automatically."
