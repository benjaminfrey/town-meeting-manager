# Phase F — Decommissioning Supabase

**Status:** design approved 2026-09-19. Implementation plan to follow.

**Goal:** remove Supabase from the running system and from the repository's working surface, replacing what local development still depends on, and close Stage 1 by verifying its exit criteria.

**Stage:** the last phase of Stage 1 (`docs/superpowers/plans/2026-08-26-stage-1-platform.md`), whose task **G2 Decommission** (line 487) reads: _"Delete `packages/web/src/lib/supabase.ts`, `docker/docker-compose.yml`, the superseded RLS policies, and CI's `.env.example` copy step. Retire `migrate.sh`."_ Gate: _"Zero Supabase references; CI green without the env step."_ Phase E already did the first and last of those.

---

## 1. What is actually left

Measured 2026-09-19 on `6db1c11`. 372 tracked files match "supabase" by content or path. **None of them is a runtime dependency of the application**: no source file imports `@supabase/supabase-js` or reads a `SUPABASE_*` variable.

| Kind              | What                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev stack   | `docker/` — nine services (`db kong inbucket auth rest realtime storage meta studio`), `docker/volumes/` (144 MB), `docker/scripts`, `docker/templates`; six `supabase:*` and three `db:*` scripts in the root `package.json`                                  |
| Production stack  | `infrastructure/docker-compose.production.yml`; seven scripts in `infrastructure/scripts/`; `infrastructure/nginx/nginx.conf`'s `supabase.*` (public Kong) and `studio.*` hosts; the Supabase secrets and `VITE_SUPABASE_*` block in `.env.production.example` |
| Migration history | `supabase/migrations/` (60 files, applied by nothing), `supabase/tests/`, and `supabase/seed.sql` — which IS live (applied by `scripts/build-db-from-repo.sh` and `pnpm db:seed`)                                                                              |
| Dead code         | `packages/api/package.json:34` `"@supabase/supabase-js": "^2.99.0"` (unused, 18 lockfile entries); `packages/shared/src/types/database.ts` (3,175 generated lines) and its single re-export in `types/index.ts` — nothing else imports it                      |
| Prose             | ~180 source files and ~130 test files mention Supabase in comments; `README.md`, `docs/deployment.md`, and the historical record under `docs/workflow/`, `docs/audit/`, `docs/advisory-resolutions/`, `docs/superpowers/`                                      |

Two facts shape the work:

- **`docker/volumes/db/data` holds every local developer's login accounts.** `supabase/seed.sql` creates towns, people and `user_account` rows but no auth users, so the volume is the only place those logins exist.
- **nginx publishes `supabase.townmeetingmanager.com` → Kong**, a public PostgREST surface with no legitimate client left.

## 2. Decisions

Owner decisions taken 2026-09-19, during design:

1. **Production: remove, don't replace.** Phase F deletes the Docker/Supabase production path. It already cannot run — Docker was removed from the VM and `migrate.sh` is marked INOPERATIVE. Designing a non-Docker deployment (process manager, deploy script, migrations applied as the owner) is a separate spec, expected in Stage 2. This also settles the plan's open question about a process manager: Phase F does not answer it.
2. **Dev accounts: re-seed, don't migrate.** The volume is disposable. GoTrue password hashes are not portable to Better Auth, so migration could only preserve rows the seed already recreates. Phase F instead creates dev logins through Better Auth.
3. **Old corpus: delete the migrations, move the seed.** `supabase/migrations/` and `supabase/tests/` go (git history keeps them); `supabase/seed.sql` moves to `packages/api/drizzle/seed/seed.sql`. The ~30 comments citing individual migration files are rewritten to name the migration and note that it was removed in Phase F.
4. **Local database: native Postgres, no containers.** Replaced by one dev script. The schema needs no extensions (`CREATE EXTENSION` appears nowhere in `packages/api/drizzle/`), and CI already runs plain `postgres:17`.
5. **Prose: fix only what Phase F makes false.** Sweep by claim, not by file. Comments that accurately record why code changed stay — that history is how several live defects were found.
6. **The 21 permission rules: verify and report.** Produce the table; missing guards become findings with backlog entries, not silently absorbed work.

## 3. Structure: replace, remove, close

Three units, executed in order. The ordering is the design: Phase E's completeness argument was vacuous because the deletion happened when nothing could break, and the lesson recorded there is that **deletion proves something only when the replacement already exists.** Local development must work at every commit.

### Unit 1 — The replacement (additive; nothing is deleted)

- **`scripts/dev/reset-local-db.sh`** — creates a `tmm_owner` role (`NOSUPERUSER NOBYPASSRLS`) and a database it owns, runs `scripts/build-db-from-repo.sh` against it (that script already refuses a superuser), applies the seed, then creates dev logins. Prints its postconditions: table count, RLS enabled/forced counts, seeded town and account counts.
- **Dev logins** — a `tsx` script that, for each `user_account` the seed creates, calls Better Auth's sign-up and links the identity exactly as invitation acceptance does: `user_account.auth_user_id`, and the `better_auth.user_tenant` row. One documented dev password, used only here. Ends by signing in once and failing loudly if that does not work.
- **`supabase/seed.sql` → `packages/api/drizzle/seed/seed.sql`**, with `scripts/build-db-from-repo.sh` and `pnpm db:seed` following it.
- **Root scripts:** `supabase:up|down|reset|logs|status|db` removed; `db:reset`, `db:migrate`, `db:seed` rewritten onto the new path.
- **CI** gains one step that runs the bootstrap against its Postgres service, so the dev path cannot rot unnoticed.

Exit: a developer with no Docker can reach a working login in one command, proven on a clean database.

### Unit 2 — Removal

Delete: `docker/`; `supabase/migrations/`; `supabase/tests/`; `packages/api`'s `@supabase/supabase-js` dependency and its lockfile entries; `packages/shared/src/types/database.ts` and its re-export; `infrastructure/docker-compose.production.yml`; the Docker-dependent scripts in `infrastructure/scripts/` (`deploy.sh`, `migrate.sh`, `backup.sh`, `restore.sh`, `rollback.sh`, `health-check.sh`, `ssl-setup.sh`); nginx's `supabase.*` and `studio.*` server blocks and their upstreams; the Supabase secrets and `VITE_SUPABASE_*` lines in `.env.production.example`.

Correct rather than delete: `infrastructure/provision/README.md` and `infrastructure/nginx/portal.conf` describe the VM and the portal, not Supabase.

`docs/deployment.md` states plainly that there is currently no working deploy path, and which spec owns building one.

Exit: `pnpm install --frozen-lockfile` succeeds, the five gates pass, and the greps in §5 are zero.

### Unit 3 — Close Stage 1

- **Prose sweep by claim.** Four claim classes: citations into deleted migration files; comments describing services, files or containers that no longer exist; instructions telling a developer to run the Docker stack; and statements about how the system works now that Phase F falsifies. Each class has its own grep, run to zero.
- **`README.md`** and `docs/deployment.md` updated; the historical record under `docs/workflow/`, `docs/audit/`, `docs/advisory-resolutions/` and `docs/superpowers/` is left alone.
- **Stage 1's eight exit criteria** verified with evidence and checked off in the Stage 1 plan.
- **The 21 permission rules** (master plan § "The 21-rule permission checklist"): one row per rule — migration of origin, the code, the guard that enforces it now, and the test that pins it — or "missing". Every missing one gets a backlog entry and a recommendation.

Exit: Stage 1's gate is met or the gaps are named.

## 4. What stays, deliberately

`docs/` history; the reserved subdomain `"supabase"` in `packages/shared/src/utils/subdomain.ts` (it must stay reserved); comments that accurately record why code changed; and git history, which remains the record for everything deleted here.

## 5. Definition of done

| Check                                                                                | Expected                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `git grep -l "@supabase/supabase-js"` (lockfile included)                            | 0                                            |
| `test -e docker; test -e supabase/migrations`                                        | both absent                                  |
| `git grep -in supabase -- package.json packages/*/package.json`                      | 0                                            |
| `git grep -rn "supabase/migrations/" -- packages/ scripts/ infrastructure/ .github/` | 0                                            |
| `git grep -rn "supabase" -- infrastructure/ .env.production.example`                 | 0                                            |
| `scripts/build-db-from-repo.sh` as a NOSUPERUSER NOBYPASSRLS owner                   | exits 0                                      |
| `scripts/dev/reset-local-db.sh` on a clean database, then sign in                    | succeeds                                     |
| The five CI gates (`typecheck`, `lint`, `format:check`, `build`, `test`)             | pass, `Tasks: 5 successful, 5 total`         |
| Stage 1 exit criteria                                                                | eight checked, with evidence recorded        |
| 21-rule table                                                                        | complete, gaps recorded in `docs/backlog.md` |

## 6. Testing

Each unit proves itself:

- **Unit 1:** a real run on a clean database, ending in a successful Better Auth sign-in; plus the new CI step, which makes the bootstrap a standing gate rather than a one-time demonstration.
- **Unit 2:** the grep table above, a `--frozen-lockfile` install, and a full gate run. Existing suites already cover the schema corpus and tenant isolation.
- **Unit 3:** the recorded evidence per exit criterion, and the 21-rule table.

No new test framework or harness is needed. The one new standing check is the CI bootstrap step.

## 7. Risks

| Risk                                                     | Handling                                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deleting `docker/volumes/` destroys local dev accounts   | Accepted (decision 2). Unit 1 ships the replacement first, and the volume is git-ignored, so each developer deletes their own copy when they choose.                          |
| The production changes cannot be verified anywhere       | Nothing is deployed, and the deleted files already cannot run. The risk is of a stale `infrastructure/` misleading the future deploy spec — which is the reason to delete it. |
| The 21-rule check finds missing guards, of unknown size  | It reports rather than fixes (decision 6). Findings are backlog entries and an owner decision.                                                                                |
| A comment sweep this wide misses a claim                 | Sweep by claim with a grep per class, each run to zero — the Phase E close-out's rule, which widened three times when swept by file.                                          |
| `seed.sql` moving breaks a test that references its path | The references are comments citing `supabase/seed.sql:116` for permission-code spelling; unit 1 updates them with the move.                                                   |

## 8. Out of scope

Designing a new production deployment; fixing the live defects in `docs/backlog.md` (including item 11's minutes defects); any change to the application's behaviour. Phase F removes, replaces and verifies — it does not change what the product does.
