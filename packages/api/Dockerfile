# Nothing in this repository builds this image today. The Docker Compose
# file that used to (repo-root `docker-compose.yml`) was deleted in Phase F
# along with the rest of the Supabase-based local/production stack. Whether
# a future deployment runs the API in a container at all — and if so, from
# this Dockerfile or a rewritten one — is owned by the Stage 2 deploy spec,
# not decided here. This file is kept because the Chromium/Puppeteer setup
# below is knowledge worth keeping regardless of how that's decided.
#
# ─── IF YOU DEPLOY FROM THIS FILE, READ THIS FIRST (backlog 21) ────────────
#
# This image runs the API as root and says nothing about groups, which is
# fine for building and fatal for serving. `packages/api/src/storage/store.ts`
# writes documents and seals GROUP-READABLE on purpose: nginx serves them, its
# workers run unprivileged (`user nginx;` in infrastructure/nginx/nginx.conf),
# and they are a different Linux user from this process. Group-readable only
# helps if the two share a group.
#
# The deleted Docker Compose deployment supplied that half by running this
# container as `user: "${TMM_ASSET_UID:-0}:${TMM_ASSET_GID:-101}"` — 101 being
# the `nginx` uid/gid in `nginx:*-alpine` — so every file this process created
# was already group-owned by nginx, with no `chown` anywhere. Phase F deleted
# that deployment; nothing in the repository encodes the relationship now.
#
# Re-establish it however the Stage 2 deployment is built (a container `user:`,
# systemd `SupplementaryGroups=`, a `chgrp`), and pin it in
# `packages/api/src/storage/__tests__/deployment-group-pin.test.ts`, which
# fails until an artefact that starts the API mentions how it is done.
#
# The symptom of skipping it is not an error: nginx returns 403 for every
# document and seal, and this application's logs stay clean. That is how the
# bug presented the first time.
FROM node:20-slim

# Install Chromium dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY tsconfig.base.json ./

# Build shared package first, then API
RUN pnpm --filter @town-meeting/shared build && pnpm --filter @town-meeting/api build

# Bound Puppeteer/Node memory (PDF generation) and run in production mode.
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "packages/api/dist/index.js"]
