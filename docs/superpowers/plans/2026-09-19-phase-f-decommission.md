# Phase F — Decommissioning Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Supabase from the running system and the repository's working surface, replacing the local development path it still provides, and close Stage 1 by verifying its exit criteria.

**Architecture:** Three units in order — replace, remove, close. Unit 1 is purely additive: a native-Postgres dev bootstrap and Better Auth dev logins, so local development keeps working at every commit. Unit 2 deletes the local and production Supabase stacks, the unapplied migration corpus, the unused dependency and the dead generated types. Unit 3 sweeps the prose those deletions falsify and verifies Stage 1's exit criteria, including a verify-and-report pass over the 21 permission rules.

**Tech Stack:** Postgres 17+ (native, no extensions), Drizzle 0.45 migrations as hand-written SQL, Better Auth, Fastify 5, tRPC 11, pnpm workspaces, vitest, bash.

**Spec:** `docs/superpowers/specs/2026-09-19-phase-f-decommission-design.md`

## Global Constraints

- The five CI gates must pass at every commit: `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm format:check`, `pnpm build`, `pnpm test`. Run tests as `DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force` and require `Tasks: 5 successful, 5 total` **and** exit code 0.
- Local development must work at every commit. Nothing in Unit 2 may be deleted before Unit 1's replacement is merged.
- The dev password is `TownMeeting!Dev1` and appears only in dev tooling and its tests. Never in application code.
- The seed's canonical ids are fixed and must not change: town `a1b2c3d4-e5f6-7890-abcd-ef1234567890` (Newcastle, subdomain `newcastle`); `user_account` ids `aaaa1111-…` through `aaaa6666-…`; person ids `11111111-…` through `66666666-…`.
- `supabase/seed.sql` is **not** idempotent: no `ON CONFLICT`, no `TRUNCATE`. Every bootstrap starts from an empty database.
- Migrations are hand-written SQL in `packages/api/drizzle/NNNN_name.sql` with a matching `meta/_journal.json` entry. Phase F adds no migration.
- The seed lives in the SUBDIRECTORY `packages/api/drizzle/seed/`. Never directly in `packages/api/drizzle/`: `db-harness.ts` and `build-db-from-repo.sh` both glob `*.sql` there and cross-check the list against the journal, so a seed beside the migrations makes every database build refuse (measured: 784 tests failed). Both globs are non-recursive, so a subdirectory is safe.
- Keep the reserved subdomain `"supabase"` in `packages/shared/src/utils/subdomain.ts`. It must stay reserved.
- `docs/` history (`workflow/`, `audit/`, `advisory-resolutions/`, `superpowers/`) is the historical record and is not rewritten by this plan. Four exceptions only: `docs/deployment.md`, `README.md`, Task 8 ticking the exit criteria in `docs/superpowers/plans/2026-08-26-stage-1-platform.md`, and Task 8 adding `docs/superpowers/plans/phase-f-stage-1-gate.md` plus `docs/backlog.md` entries.

## File Structure

**Created**

| Path                                                     | Responsibility                                                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/drizzle/seed/seed.sql`                     | The demo/dev dataset, moved from `supabase/seed.sql`, beside the schema it seeds                                                   |
| `packages/api/src/dev/seed-dev-logins.ts`                | `seedDevLogins()` — creates a Better Auth identity per seeded `user_account` and links it, the same way invitation acceptance does |
| `packages/api/src/dev/__tests__/seed-dev-logins.test.ts` | Proves a seeded account can sign in afterwards                                                                                     |
| `packages/api/src/dev/seed-dev-logins-cli.ts`            | Thin `tsx` entry point: builds the db handle and `auth`, calls `seedDevLogins()`, prints results                                   |
| `scripts/dev/reset-local-db.sh`                          | One command: role, database, schema, seed, logins, postconditions                                                                  |

**Modified**

| Path                                                                          | Change                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `scripts/build-db-from-repo.sh`                                               | Seed path follows the move                                      |
| `package.json`                                                                | `supabase:*` removed; `db:*` rewritten onto the new path        |
| `.github/workflows/ci.yml`                                                    | One new step running the bootstrap against the service Postgres |
| `.gitignore`, `.prettierignore`                                               | Drop `docker/` and `supabase/migrations` entries                |
| `infrastructure/nginx/nginx.conf`                                             | Remove the `supabase.*` and `studio.*` server blocks            |
| `.env.production.example`                                                     | Remove the Supabase secrets and `VITE_SUPABASE_*`               |
| `infrastructure/provision/README.md`, `docs/deployment.md`, `README.md`       | Corrected prose                                                 |
| ~30 source comments citing `supabase/migrations/…` or `supabase/seed.sql:116` | Rewritten                                                       |
| `docs/superpowers/plans/2026-08-26-stage-1-platform.md`                       | Exit criteria checked off with evidence                         |
| `docs/backlog.md`                                                             | Entries for any missing permission guard                        |

**Deleted**

`docker/`; `supabase/migrations/`; `supabase/tests/`; `supabase/seed.sql` (moved); `packages/shared/src/types/database.ts` and its re-export; `packages/api`'s `@supabase/supabase-js` dependency; `infrastructure/docker-compose.production.yml`; `infrastructure/scripts/{deploy,migrate,backup,restore,rollback,health-check,ssl-setup}.sh`.

---

# UNIT 1 — The replacement (additive)

### Task 1: Move the seed beside the schema

**Files:**

- Create: `packages/api/drizzle/seed/seed.sql` (git mv of `supabase/seed.sql`, 364 lines, content unchanged)
- Modify: `scripts/build-db-from-repo.sh:130`
- Modify: `package.json` (the `db:seed` script only)
- Modify: the comments that cite the old path (exact list in Step 4)

**Interfaces:**

- Consumes: nothing.
- Produces: the seed lives at `packages/api/drizzle/seed/seed.sql`. Tasks 2, 3 and 6 use that path.

- [ ] **Step 1: Move the file with git, so history follows**

```bash
git mv supabase/seed.sql packages/api/drizzle/seed/seed.sql
```

- [ ] **Step 2: Point the build script at it**

In `scripts/build-db-from-repo.sh`, line 130 currently reads:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
```

Replace with:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f packages/api/drizzle/seed/seed.sql
```

Also update the echo above it if it names the old path.

- [ ] **Step 3: Point `db:seed` at it**

In `package.json`, replace the `db:seed` line:

```json
"db:seed": "docker exec -i town-meeting-db psql -U postgres -d postgres < supabase/seed.sql",
```

with:

```json
"db:seed": "psql \"${DATABASE_URL:?set DATABASE_URL}\" -v ON_ERROR_STOP=1 -q -f packages/api/drizzle/seed/seed.sql",
```

- [ ] **Step 4: Rewrite the comments that cite the old path**

Find them:

```bash
git grep -n "supabase/seed.sql"
```

Every hit is a comment. Rewrite the path to `packages/api/drizzle/seed/seed.sql`. **Two of them also carry a wrong line number**: comments citing `supabase/seed.sql:116` say that line writes permission CODES. Line 116 is a town id; the code-keyed matrices are at lines 126 and 134 of the moved file. Cite `packages/api/drizzle/seed/seed.sql:126` instead. Known hits at the time of writing:

- `packages/api/src/plugins/__tests__/permission-guards.test.ts:19` and `:201`
- `packages/api/src/trpc/__tests__/fixtures.ts:13`
- `packages/api/src/trpc/authorization/permission.ts:13`
- `packages/shared/src/utils/__tests__/normalise-permissions.test.ts:7`
- `packages/api/src/db/with-tenant.ts:35`
- `packages/api/src/plugins/auth.ts:250`
- `eslint-rules/no-session-scoped-set-config.js:44`
- `e2e/fixtures.ts:56`

- [ ] **Step 5: Verify the build script still builds a database**

```bash
psql -U "$USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE tmm_seedcheck LOGIN NOSUPERUSER NOBYPASSRLS"
psql -U "$USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE tmm_seedcheck OWNER tmm_seedcheck"
./scripts/build-db-from-repo.sh "postgres://tmm_seedcheck@localhost:5432/tmm_seedcheck"
psql -U "$USER" -d tmm_seedcheck -Atc "SELECT count(*) FROM town"
psql -U "$USER" -d postgres -c "DROP DATABASE tmm_seedcheck WITH (FORCE)" -c "DROP ROLE tmm_seedcheck"
```

Expected: the script exits 0, prints its table count and `26 enabled, 26 forced`-style line, and the town count is `1`.

- [ ] **Step 6: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Move the seed beside the schema it seeds"
```

---

### Task 2: `seedDevLogins()` — Better Auth identities for seeded accounts

**Files:**

- Create: `packages/api/src/dev/seed-dev-logins.ts`
- Test: `packages/api/src/dev/__tests__/seed-dev-logins.test.ts`

**Interfaces:**

- Consumes: `packages/api/drizzle/seed/seed.sql` (Task 1); `createAuth` from `../auth/auth.js`; `withTenant` from `../db/with-tenant.js`.
- Produces:

```ts
export interface SeededLogin {
  email: string;
  userAccountId: string;
  authUserId: string;
}
export async function seedDevLogins(
  db: TenantResolverDb,
  auth: ReturnType<typeof createAuth>,
  password: string,
): Promise<SeededLogin[]>;
```

Task 3's CLI calls exactly this.

**Context the implementer needs:** the linking sequence is the one `POST /api/invitations/accept` performs. Sign-up happens **outside** any tenant transaction; the three linking writes happen **inside** `withTenant`. `user_account.auth_user_id` starts NULL for all six seeded accounts, and the email lives on `person`, not `user_account`.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/dev/__tests__/seed-dev-logins.test.ts`:

```ts
/**
 * `seedDevLogins` gives each seeded `user_account` a Better Auth identity, so a
 * developer can sign in after a bootstrap. It replaces the GoTrue accounts that
 * lived in `docker/volumes/db/data`, which no seed ever recreated.
 *
 * The assertion that matters is the last one: a real sign-in. Linking rows
 * without a working sign-in is the failure this test exists to catch.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { seedDevLogins } from "../seed-dev-logins.js";

const SEED = path.join(process.cwd(), "drizzle", "seed.sql");
const PASSWORD = "TownMeeting!Dev1";

describe("seedDevLogins", () => {
  it("links every seeded account and leaves it able to sign in", async () => {
    await withTestDb(async (owner) => {
      await owner.file(SEED);
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const auth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:5173",
          sendAuthEmail: async () => {},
        });

        const seeded = await seedDevLogins(db, auth, PASSWORD);

        // Six accounts in the seed, every one linked.
        expect(seeded).toHaveLength(6);
        const rows = await owner<{ n: number }[]>`
          SELECT count(*)::int AS n FROM user_account WHERE auth_user_id IS NOT NULL`;
        expect(rows[0]!.n).toBe(6);

        // The tenant bridge row exists for each, or the account authenticates
        // and is then refused on every request.
        const tenants = await owner<{ n: number }[]>`
          SELECT count(*)::int AS n FROM better_auth.user_tenant`;
        expect(tenants[0]!.n).toBe(6);

        // The point of the whole script.
        const signedIn = await auth.api.signInEmail({
          body: { email: "mbragdon@newcastle.me.us", password: PASSWORD },
          asResponse: true,
        });
        expect(signedIn.status).toBe(200);
      } finally {
        await app.end();
      }
    });
  });

  it("is safe to run twice", async () => {
    await withTestDb(async (owner) => {
      await owner.file(SEED);
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const auth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:5173",
          sendAuthEmail: async () => {},
        });

        await seedDevLogins(db, auth, PASSWORD);
        const second = await seedDevLogins(db, auth, PASSWORD);

        // Nothing left to do the second time, and no duplicate identities.
        expect(second).toHaveLength(0);
        const rows = await owner<{ n: number }[]>`
          SELECT count(*)::int AS n FROM better_auth."user"`;
        expect(rows[0]!.n).toBe(6);
      } finally {
        await app.end();
      }
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/api
DATABASE_URL="postgres://$USER@localhost:5432/postgres" npx vitest run src/dev/__tests__/seed-dev-logins.test.ts
```

Expected: FAIL — `Cannot find module '../seed-dev-logins.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/api/src/dev/seed-dev-logins.ts`:

```ts
/**
 * Give each seeded `user_account` a Better Auth identity.
 *
 * `packages/api/drizzle/seed/seed.sql` creates towns, people and accounts but no
 * logins — it never did, and the logins developers actually used lived in the
 * Supabase stack's `docker/volumes/db/data`, which Phase F retires. This is
 * their replacement.
 *
 * The sequence is the one `POST /api/invitations/accept` performs, for the same
 * reason: an identity that is created but not linked authenticates and is then
 * refused on every request by the tenant bridge.
 *
 *   1. sign up            — OUTSIDE any tenant transaction (Better Auth owns it)
 *   2. mark verified      — no invitation email exists to click here
 *   3. link the account   — user_account.auth_user_id, inside withTenant
 *   4. bridge the tenant  — better_auth.user_tenant, inside the same transaction
 *
 * Dev-only. Never import this from application code.
 */
import { sql } from "drizzle-orm";
import { withTenant, type TenantResolverDb } from "../db/with-tenant.js";
import { toRows } from "../db/rows.js";
import type { createAuth } from "../auth/auth.js";

export interface SeededLogin {
  email: string;
  userAccountId: string;
  authUserId: string;
}

interface PendingRow {
  user_account_id: string;
  town_id: string;
  email: string;
  name: string;
}

export async function seedDevLogins(
  db: TenantResolverDb,
  auth: ReturnType<typeof createAuth>,
  password: string,
): Promise<SeededLogin[]> {
  // Accounts with no identity yet. Read outside a tenant context deliberately:
  // this crosses every town in the seed, which no request ever does.
  const pending = toRows<PendingRow>(
    await db.execute(sql`
      SELECT ua.id AS user_account_id, ua.town_id, p.email, p.name
        FROM user_account ua
        JOIN person p ON p.id = ua.person_id
       WHERE ua.auth_user_id IS NULL
         AND p.email IS NOT NULL
       ORDER BY p.email
    `),
    (message) => new Error(`seedDevLogins: ${message}`),
  );

  const seeded: SeededLogin[] = [];

  for (const row of pending) {
    const created = await auth.api.signUpEmail({
      body: { email: row.email, password, name: row.name },
    });
    const authUserId = created.user.id;

    await withTenant(db, { townId: row.town_id }, async (tx) => {
      await tx.execute(
        sql`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${authUserId}`,
      );
      const linked = toRows<{ id: string }>(
        await tx.execute(sql`
          UPDATE user_account
             SET auth_user_id = ${authUserId}, email = ${row.email}
           WHERE id = ${row.user_account_id}::uuid
             AND auth_user_id IS NULL
          RETURNING id
        `),
        (message) => new Error(`seedDevLogins: ${message}`),
      );
      if (linked.length !== 1) {
        throw new Error(
          `seedDevLogins: expected to link exactly 1 user_account, matched ${linked.length} ` +
            `for ${row.email}. An identity now exists that nothing points at.`,
        );
      }
      await tx.execute(sql`
        INSERT INTO better_auth.user_tenant (auth_user_id, town_id)
        VALUES (${authUserId}, ${row.town_id}::uuid)
      `);
    });

    seeded.push({ email: row.email, userAccountId: row.user_account_id, authUserId });
  }

  return seeded;
}
```

- [ ] **Step 4: Run the test**

```bash
cd packages/api
DATABASE_URL="postgres://$USER@localhost:5432/postgres" npx vitest run src/dev/__tests__/seed-dev-logins.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Prove the sign-in assertion can fail**

Temporarily delete the `INSERT INTO better_auth.user_tenant` statement, re-run, and confirm a named test goes red. Restore it. Record the observed failure in the task report.

- [ ] **Step 6: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Add seedDevLogins: Better Auth identities for seeded accounts"
```

---

### Task 3: The bootstrap script, the pnpm scripts, and the CI step

**Files:**

- Create: `packages/api/src/dev/seed-dev-logins-cli.ts`
- Create: `scripts/dev/reset-local-db.sh`
- Modify: `package.json` (scripts block)
- Modify: `.github/workflows/ci.yml` (one new step after Build, before Test)

**Interfaces:**

- Consumes: `seedDevLogins()` (Task 2), `packages/api/drizzle/seed/seed.sql` (Task 1), `scripts/build-db-from-repo.sh`.
- Produces: `pnpm db:reset`, the command the README and CLAUDE.md will point at.

- [ ] **Step 1: Write the CLI entry point**

Create `packages/api/src/dev/seed-dev-logins-cli.ts`:

```ts
/**
 * `tsx src/dev/seed-dev-logins-cli.ts` — dev only.
 *
 * Wraps `seedDevLogins` with the database handle and Better Auth instance that
 * `scripts/dev/reset-local-db.sh` cannot build in bash. Prints one line per
 * login so a developer can see what to sign in as.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createAuth } from "../auth/auth.js";
import { seedDevLogins } from "./seed-dev-logins.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = process.env.DEV_PASSWORD ?? "TownMeeting!Dev1";

if (!DATABASE_URL) {
  console.error("seed-dev-logins: DATABASE_URL is required");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-0123456789abcdef0123456789",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
    sendAuthEmail: async () => {},
  });

  const seeded = await seedDevLogins(db, auth, PASSWORD);
  if (seeded.length === 0) {
    console.log("seed-dev-logins: every account already has a login; nothing to do");
  }
  for (const login of seeded) {
    console.log(`seed-dev-logins: ${login.email}  (password: ${PASSWORD})`);
  }
} finally {
  await client.end();
}
```

- [ ] **Step 2: Write the bootstrap script**

Create `scripts/dev/reset-local-db.sh`, executable (`chmod +x`):

```bash
#!/usr/bin/env bash
#
# Build a local development database from the repository, end to end.
#
# Replaces `pnpm supabase:up` and the nine-container Supabase stack, which
# Phase F retired. The database is a plain Postgres — the schema needs no
# extensions, and CI has always run `postgres:17`.
#
# What it does, in order:
#   1. creates the owner role and the database (dropping any previous one)
#   2. applies the migration corpus + seed via scripts/build-db-from-repo.sh,
#      which refuses to run as a superuser — that refusal is the point: the
#      corpus must apply as a production-shaped role
#   3. creates a Better Auth login for every seeded account
#   4. prints what was built and what to sign in as
#
# Usage:  scripts/dev/reset-local-db.sh [dbname]
#         ADMIN_URL   maintenance connection (default postgres://$USER@localhost:5432/postgres)
#
set -euo pipefail

DB_NAME="${1:-tmm_dev}"
OWNER_ROLE="tmm_owner"
ADMIN_URL="${ADMIN_URL:-postgres://$USER@localhost:5432/postgres}"
DEV_PASSWORD="${DEV_PASSWORD:-TownMeeting!Dev1}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qAt <<SQL
DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
    CREATE ROLE ${OWNER_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END \$\$;
CREATE DATABASE ${DB_NAME} OWNER ${OWNER_ROLE};
SQL

OWNER_URL="postgres://${OWNER_ROLE}@localhost:5432/${DB_NAME}"

echo "==> Building schema and seed as ${OWNER_ROLE}"
./scripts/build-db-from-repo.sh "$OWNER_URL"

echo "==> Creating development logins"
DATABASE_URL="$OWNER_URL" DEV_PASSWORD="$DEV_PASSWORD" \
  pnpm --filter @town-meeting/api exec tsx src/dev/seed-dev-logins-cli.ts

echo
echo "Database : ${DB_NAME} (owner ${OWNER_ROLE})"
echo "Connect  : ${OWNER_URL}"
psql "$OWNER_URL" -qAt -c "SELECT 'towns: ' || count(*) FROM town"
psql "$OWNER_URL" -qAt -c "SELECT 'logins: ' || count(*) FROM better_auth.\"user\""
echo
echo "Put this in packages/api/.env:"
echo "  DATABASE_URL=${OWNER_URL}"
```

- [ ] **Step 3: Check the script parses, then run it**

```bash
bash -n scripts/dev/reset-local-db.sh
chmod +x scripts/dev/reset-local-db.sh
./scripts/dev/reset-local-db.sh tmm_dev
```

Expected: `build-db-from-repo.sh` exits 0 (it prints the connecting role and confirms it is not a superuser), six login lines, `towns: 1`, `logins: 6`.

- [ ] **Step 4: Rewrite the pnpm scripts**

In `package.json`, delete all six `supabase:*` scripts and replace the three `db:*` with:

```json
"db:reset": "scripts/dev/reset-local-db.sh",
"db:migrate": "./scripts/build-db-from-repo.sh \"${DATABASE_URL:?set DATABASE_URL}\"",
"db:seed": "psql \"${DATABASE_URL:?set DATABASE_URL}\" -v ON_ERROR_STOP=1 -q -f packages/api/drizzle/seed/seed.sql",
```

- [ ] **Step 5: Add the CI step**

In `.github/workflows/ci.yml`, after the Build step (line 74-75) and before the Test step, add:

```yaml
# The dev bootstrap is a standing gate, not a one-time demonstration:
# it is the only path a new developer has to a working local database
# since Phase F retired the Supabase stack. CI's postgres role is a
# superuser, so build-db-from-repo.sh is given ALLOW_SUPERUSER_BUILD=1
# here — it still proves the corpus applies and the logins link, which
# is what this step is for. The non-superuser path is exercised by
# developers running scripts/dev/reset-local-db.sh.
- name: Dev bootstrap
  env:
    ALLOW_SUPERUSER_BUILD: "1"
  run: |
    ./scripts/build-db-from-repo.sh "$DATABASE_URL"
    pnpm --filter @town-meeting/api exec tsx src/dev/seed-dev-logins-cli.ts
```

- [ ] **Step 6: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Add the native-Postgres dev bootstrap and its CI step"
```

**Unit 1 exit:** a developer with no Docker reaches a working login with `pnpm db:reset`. Nothing has been deleted.

---

# UNIT 2 — Removal

### Task 4: Delete the local Supabase stack and the migration corpus

**Files:**

- Delete: `docker/` (entire directory — nine services, `volumes/`, `scripts/`, `templates/`)
- Delete: `supabase/migrations/` (60 files), `supabase/tests/`
- Modify: `.gitignore`, `.prettierignore`

**Interfaces:**

- Consumes: Unit 1 must be merged first — this removes the only other way to get a local database.
- Produces: `docker/` and `supabase/` no longer exist.

- [ ] **Step 1: Confirm nothing references the containers any more**

```bash
git grep -n "town-meeting-db\|docker compose\|docker exec" -- ':!docs/**' ':!*.md'
```

Expected: only `infrastructure/` (Task 6 deletes those) and `scripts/dev/new-agent-worktree.sh`'s comment. If a `package.json` script still matches, Task 3 was incomplete — fix it before deleting.

- [ ] **Step 2: Delete**

```bash
git rm -r --quiet docker supabase/migrations supabase/tests
rmdir supabase 2>/dev/null || true
```

- [ ] **Step 3: Drop the stale ignore entries**

In `.gitignore`, remove the `docker/volumes/db/data/`, `docker/volumes/storage/` and `docker/.env` lines. In `.prettierignore`, remove the `supabase/migrations` line and the comment paragraph that explains it.

- [ ] **Step 4: Verify**

```bash
test -e docker && echo "FAIL docker still present" || echo "ok: docker gone"
test -e supabase && echo "FAIL supabase still present" || echo "ok: supabase gone"
git grep -n "docker/" -- ':!docs/**' ':!*.md' ':!infrastructure/**'
```

Expected: both `ok:` lines; the grep returns only `scripts/dev/new-agent-worktree.sh` if its comment still mentions the old copy behaviour (rewrite it if so).

- [ ] **Step 5: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Delete the local Supabase stack and the unapplied migration corpus"
```

---

### Task 5: Delete the unused dependency and the dead generated types

**Files:**

- Modify: `packages/api/package.json:34` (remove the dependency), `pnpm-lock.yaml` (regenerated)
- Delete: `packages/shared/src/types/database.ts` (3,175 lines)
- Modify: `packages/shared/src/types/index.ts:1` (remove the re-export)

**Interfaces:**

- Consumes: nothing.
- Produces: `git grep -l "@supabase/supabase-js"` returns nothing, lockfile included.

- [ ] **Step 1: Prove the types are unimported before deleting them**

```bash
git grep -n "types/database\|Database\b" -- 'packages/*/src/**' | grep -v "types/database.ts:" | grep -v "types/index.ts:"
```

Expected: no hit that imports the `Database` type. If one appears, STOP and report — this task's premise is wrong.

- [ ] **Step 2: Delete the dependency and the types**

```bash
git rm --quiet packages/shared/src/types/database.ts
```

Remove `"@supabase/supabase-js": "^2.99.0",` from `packages/api/package.json`, and the line `export type { Database } from "./database.js";` from `packages/shared/src/types/index.ts`.

- [ ] **Step 3: Regenerate the lockfile**

```bash
pnpm install
git diff --stat pnpm-lock.yaml
```

Expected: the `@supabase/*` entries disappear. If the diff touches unrelated packages, STOP and report rather than committing a wide re-resolution.

- [ ] **Step 4: Verify the frozen install still works**

```bash
pnpm install --frozen-lockfile
git grep -l "@supabase/supabase-js" || echo "ok: no reference anywhere"
```

Expected: exit 0, then `ok: no reference anywhere`.

- [ ] **Step 5: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Delete the unused Supabase dependency and the dead generated types"
```

---

### Task 6: Delete the production Supabase path

**Files:**

- Delete: `infrastructure/docker-compose.production.yml`; `infrastructure/scripts/{deploy,migrate,backup,restore,rollback,health-check,ssl-setup}.sh`
- Modify: `infrastructure/nginx/nginx.conf` (remove two server blocks and their upstreams, and the host list in the header comment)
- Modify: `.env.production.example`
- Modify: `infrastructure/provision/README.md`, `docs/deployment.md`

**Interfaces:**

- Consumes: nothing.
- Produces: `git grep -rn "supabase" -- infrastructure/ .env.production.example` returns nothing.

- [ ] **Step 1: Confirm every script is Docker-dependent before deleting it**

```bash
for f in infrastructure/scripts/*.sh; do
  printf "%-42s %s\n" "$f" "$(grep -qE 'docker compose|COMPOSE=' "$f" && echo docker-dependent || echo 'NO docker reference')"
done
```

Expected: all seven report `docker-dependent`. If one does not, STOP and report — it may be worth keeping.

- [ ] **Step 2: Delete**

```bash
git rm --quiet infrastructure/docker-compose.production.yml infrastructure/scripts/*.sh
```

- [ ] **Step 3: Remove the Supabase hosts from nginx**

In `infrastructure/nginx/nginx.conf`, delete the `supabase.townmeetingmanager.com` server block (around line 242-271, the public Kong proxy) and the `studio.townmeetingmanager.com` block (around line 273-300), including the `set $upstream_studio` line. Update the host list in the file header (lines 12-15) so it no longer advertises them.

- [ ] **Step 4: Strip the Supabase secrets from the production example**

In `.env.production.example`, delete the "Core Supabase secrets" block (`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, the realtime keys, `DASHBOARD_USERNAME`, `SUPABASE_PUBLIC_URL`), the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` lines, and the "Supabase Storage S3 protocol" stub section.

- [ ] **Step 5: Correct the prose that survives**

`infrastructure/provision/README.md` describes the VM; remove only its Supabase references. In `docs/deployment.md`, replace the Docker deployment instructions with a short statement of fact:

```markdown
## Deployment

There is currently no working deployment path. Phase F removed the Docker
Compose stack, which had already stopped working when Docker was removed from
the VM, along with the scripts that drove it. Building a deployment for the
current stack — a process manager for the Fastify API, nginx, and a way to
apply migrations as the database owner — is owned by a separate spec, expected
in Stage 2.

For local development, see `CLAUDE.md` and `pnpm db:reset`.
```

- [ ] **Step 6: Verify**

```bash
git grep -rn -i "supabase" -- infrastructure/ .env.production.example || echo "ok: production surface clean"
grep -c "server_name" infrastructure/nginx/nginx.conf
```

Expected: `ok: production surface clean`, and a `server_name` count two lower than before the task.

- [ ] **Step 7: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Delete the Docker/Supabase production path"
```

**Unit 2 exit:** the grep table in the spec's §5 is zero except for the prose Unit 3 sweeps.

---

# UNIT 3 — Close Stage 1

### Task 7: The prose sweep, by claim

**Files:** whatever the four greps below return. `README.md` certainly; `docs/` history is out of bounds.

**Interfaces:**

- Consumes: Tasks 4-6 (the deletions that make these claims false).
- Produces: each grep below returns zero.

**Method:** sweep by CLAIM, not by file. Phase E's close-out widened three times because it swept file lists; a claim can reappear in a file the previous list never named.

- [ ] **Step 1: Claim 1 — citations into deleted migration files**

```bash
git grep -n "supabase/migrations/" -- ':!docs/**'
```

Each hit cites a file that no longer exists. Rewrite to name the migration and its fate, e.g.:

```
 * (`20260311000003_session_0603_storage_bucket.sql:8`, in the Supabase corpus
 * deleted in Phase F — see git history)
```

- [ ] **Step 2: Claim 2 — comments describing things that no longer exist**

```bash
git grep -in "docker\|kong\|gotrue\|studio\|postgrest" -- 'packages/**' 'scripts/**' 'e2e/**' ':!**/*.snap'
```

Rewrite any comment that tells the reader these exist or are running. Keep comments that say "this used to run through X, which is why the code looks like this".

- [ ] **Step 3: Claim 3 — instructions to run the retired stack**

```bash
git grep -rn "supabase:up\|supabase:reset\|supabase:down\|pnpm supabase" -- ':!docs/superpowers/**' ':!docs/workflow/**' ':!docs/audit/**'
```

Every hit is an instruction that now fails. `README.md` is the important one: replace its local-setup section with `pnpm db:reset`, the dev password, and the `packages/api/.env` line the bootstrap prints.

- [ ] **Step 4: Claim 4 — statements about how the system works now**

```bash
git grep -in "supabase" -- 'packages/**' 'scripts/**' 'e2e/**' '*.md' ':!docs/superpowers/**' ':!docs/workflow/**' ':!docs/audit/**' ':!docs/advisory-resolutions/**'
```

Read every hit. Leave true history; fix anything stated in the present tense that is no longer true. `packages/shared/src/utils/subdomain.ts`'s reserved word stays — add a short note that it stays reserved deliberately.

- [ ] **Step 5: Verify the four greps**

Re-run steps 1-4. Expected: step 1 zero; steps 2-4 return only hits you have read and judged true history, listed in the task report with a one-line ruling each.

- [ ] **Step 6: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Sweep the prose Phase F falsified"
```

---

### Task 8: Verify Stage 1's exit criteria and the 21 permission rules

**Files:**

- Modify: `docs/superpowers/plans/2026-08-26-stage-1-platform.md` (the exit-criteria checklist, lines 491-499)
- Modify: `docs/backlog.md` (one entry per missing guard, if any)
- Create: `docs/superpowers/plans/phase-f-stage-1-gate.md` (the evidence and the 21-rule table)

**Interfaces:**

- Consumes: everything above.
- Produces: the Stage 1 gate answer.

- [ ] **Step 1: Verify each of the eight exit criteria, recording the command and its output**

The criteria, verbatim from the plan:

1. `./scripts/build-db-from-repo.sh` exits 0 with no shim, seed applied, ≥26 tables
2. The isolation test passes **as `tmm_app`**, covering all 26 RLS-enabled tables plus the three adversarial cases
3. All 26 RLS-enabled tables have `FORCE ROW LEVEL SECURITY`, and `push_subscription`'s exemption or policy is recorded
4. All 14 `SECURITY DEFINER` functions have an explicit `SET search_path`
5. Each of the 21 permission rules has a named guard and a test
6. No `supabase` import remains in `packages/web` or `packages/api`
7. No API route is reachable unauthenticated unless explicitly marked public
8. Feature parity on CI

For 1, run the script as `tmm_owner` against a scratch database. For 3 and 4, query the catalog:

```bash
psql "$OWNER_URL" -Atc "SELECT count(*) FILTER (WHERE relrowsecurity) || ' enabled, ' || count(*) FILTER (WHERE relforcerowsecurity) || ' forced' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'"
psql "$OWNER_URL" -Atc "SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','better_auth') AND p.prosecdef ORDER BY 1"
```

For 2, 7 and 8, name the test files that already prove them and the run that passed. For 6, `git grep -n "supabase" -- packages/web/src packages/api/src` and show that every hit is a comment.

- [ ] **Step 2: Build the 21-rule table**

The master plan's checklist names the three migrations and their codes (A2, M2, M3; R1, R4, A3; C2) and states there are 21 `has_permission()` calls in total. Recover the full list from git history, since the corpus is deleted:

```bash
# The commit that deleted the corpus, then the file as it was just before it:
DEL=$(git log -1 --format=%H --diff-filter=D -- 'supabase/migrations/*')
git show "$DEL^:supabase/migrations/20260308000033_rls_agenda_motion_vote.sql" | grep -n "has_permission"
# Every deleted RLS migration, to work through:
git show --stat --format= "$DEL" -- 'supabase/migrations/*rls*'
# The full count, to check against the plan's "21":
for f in $(git show --name-only --format= "$DEL" -- 'supabase/migrations/*'); do
  git show "$DEL^:$f" | grep -c "has_permission" | tr '\n' ' '; echo "$f"
done | grep -v '^0 '
```

For each of the 21 calls, record: the migration it came from, the code, the guard that enforces it now (file and function), and the test that pins it. Write the table to `docs/superpowers/plans/phase-f-stage-1-gate.md`.

- [ ] **Step 3: File a backlog entry for each gap**

Any rule with no guard, or a guard with no test, gets an entry in `docs/backlog.md` in the existing format: where, what the gap is, why it was not closed in Phase F, a retirement condition, and a verification command. Do **not** fix them in this task — the spec's decision 6 is verify and report.

- [ ] **Step 4: Check off the exit criteria**

In `docs/superpowers/plans/2026-08-26-stage-1-platform.md`, tick each criterion that is met and add a parenthetical pointing at the evidence in `phase-f-stage-1-gate.md`. Leave unmet ones unticked with a pointer to their backlog entry.

- [ ] **Step 5: Run the gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
git add -A && git commit -m "Verify Stage 1's exit criteria and report on the 21 permission rules"
```

**Unit 3 exit:** Stage 1's gate is met, or every gap is named with an owner decision attached.

---

## Definition of done for the whole plan

Run all of these at the end; every one must hold:

```bash
git grep -l "@supabase/supabase-js" || echo "ok: dependency gone"
test -e docker || echo "ok: docker gone"
test -e supabase || echo "ok: supabase dir gone"
git grep -in supabase -- package.json packages/*/package.json || echo "ok: manifests clean"
git grep -rn "supabase/migrations/" -- packages/ scripts/ infrastructure/ .github/ || echo "ok: no dangling citations"
git grep -rn -i supabase -- infrastructure/ .env.production.example || echo "ok: production clean"
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
./scripts/dev/reset-local-db.sh tmm_dev_final
```

Plus: Stage 1's eight criteria ticked or explained, and the 21-rule table complete.
