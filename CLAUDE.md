# Town Meeting Manager

pnpm monorepo: `packages/web` (React 19, React Router 7 SPA), `packages/api` (Fastify 5, tRPC 11,
Drizzle 0.45, Better Auth, Postgres), `packages/shared` (types, Zod schemas, permission codes).
Multi-tenant by town; every `public` table is under FORCE ROW LEVEL SECURITY.

## The project gate

CI (`.github/workflows/ci.yml`) runs five gates, in this order. A change is done when all five
pass locally — never a subset:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
```

Reading the result:

- **lint** passes on `0 errors`; warnings are pre-existing.
- **test** passes only on `Tasks: 5 successful, 5 total` **and** exit code 0. Quote that line and
  the per-package `Tests N passed` counts as evidence. `--force` is what makes it a real run
  (`Cached: 0 cached`); `pnpm test --force` does not forward the flag.
- Afterwards, `pgrep -f vitest` and
  `psql -Atc "select count(*) from pg_database where datname like 'tmm_test%'"` should both be empty
  / 0.

## Local environment

- **API tests need `DATABASE_URL`.** The harness defaults to CI's `postgres:postgres@…`; on a
  Homebrew Postgres every api test fails with `role "postgres" does not exist` — an environment
  error, not a code failure.
- **API dev server:** `cp packages/api/.env.example packages/api/.env`, then the `api-dev` and
  `web-dev` configurations in `.claude/launch.json` (ports 3001 and 5173).
- **The web app needs no env file.** It reads only `DEV` and the optional `VITE_API_URL` /
  `VITE_VAPID_PUBLIC_KEY`. A leftover `packages/web/.env` holds an old anon JWT — delete it.
- **Worktrees for agents:** `isolation: "worktree"` branches from `main`, not the branch in hand.
  Use `scripts/dev/new-agent-worktree.sh <name> [base]`, which asserts the base. A fresh worktree
  has no `node_modules`: run `pnpm install` in it.

## Database and migrations

- Migrations are hand-written SQL in `packages/api/drizzle/NNNN_name.sql`, each with an entry in
  `meta/_journal.json`; the test harness refuses a file the journal does not list. Never edit an
  applied migration — add the next one. Keep `packages/api/src/db/schema.ts` in step by hand.
- **Nothing applies migrations to an existing database.** `infrastructure/scripts/migrate.sh` is
  inoperative, `scripts/build-db-from-repo.sh` rebuilds from scratch, and `pnpm db:migrate` replays
  every file as superuser against the legacy Docker container. A live database gets a new
  migration applied by hand, as the table owner.
- **CI connects as a superuser, which bypasses RLS** — so it cannot catch a migration that fails,
  or silently does nothing, for the real owner. A backfill on an RLS table: lift FORCE for the
  window, assert `NOT row_security_active('<table>')` **before** writing (a count afterwards is
  blind in the same way), restore FORCE. Prove it once by hand as a
  `NOSUPERUSER NOBYPASSRLS` owner, with and without the `NO FORCE` line.
- Tenancy is `withTenant` (`packages/api/src/db/with-tenant.ts`) setting `app.town_id`. Tests that assert
  anything about tenancy must use `connectAsAppRole` — the harness's owner connection is a superuser
  and sees every town.
- **Foreign-key checks bypass RLS.** Any client-supplied id that becomes an FK on INSERT needs an
  explicit existence check inside the tenant transaction, or it can point into another town.

## Authorization

- Rules live in `packages/api/src/trpc/authorization/rules.ts`; codes in
  `packages/shared/src/constants/permissions.ts`. Three Phase E waves found a code defined in the
  spec and enforced nowhere — when touching a feature, check its codes against its server guards.
- Authorize before reading or writing. A guard placed after a write can return 403 having already
  changed the row; test the row, not only the status.
- Board-scoped rules need the board: derive it via `packages/api/src/trpc/board-derivation.ts`, never from the
  client.
- Invitation tokens are stored only as `sha256` (`invitation.token_sha256`), minted at send time
  (`packages/api/src/db/invitation-token.ts`). Never select, log or return a token.

## Testing traps

- **Green tests have shipped a broken product.** For UI or transport changes, drive the real app
  (the Browser pane with `web-dev` + `api-dev`) before calling it done.
- **For guards, prove the test can fail:** remove or reorder the guard and watch a named test go
  red. A check that cannot fail proves nothing.
- `turbo run test` can leave vitest workers running after exit 0, and can exit 1 on an unhandled
  rejection while its summary reads green. Read the exit code and the `Tasks:` line, not one of
  them.
- A `vi.mock("…")` specifier is resolved by nothing — not `tsc`, not vitest. Grep for them
  separately when deleting or renaming a module.
- Branch coverage reports a conditional inside an always-mounted `<Dialog open={false}>` as hit.
- In `git grep` / POSIX ERE, `\s` is not whitespace; use `[[:space:]]`.
- After fixing a pattern-shaped bug, search for the same pattern elsewhere; diff-scoped review
  misses unchanged sibling files.

## Where things are recorded

- `docs/backlog.md` — the durable register of known gaps. Add new ones there, with a retirement
  condition; close entries in place, keeping their number.
- `docs/superpowers/plans/phase-e-conventions.md` — the conventions the tRPC migrations follow
  (board derivation, cache keys, close-out sweeps).
- Mechanised checks: `packages/api/src/trpc/__tests__/router-wiring.test.ts` (publish inventory) and
  `packages/web/src/lib/__tests__/cache-key-parity.test.ts` (cache keys a writer must invalidate).

## Working rules

- Branch from `main`; one PR per change; merge only when CI passes and the user has said to.
- Comments here record _why_ and history at length; match the density of the file you are in.
