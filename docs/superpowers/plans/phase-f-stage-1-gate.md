# Phase F, Task 8 — the Stage 1 gate

Written 2026-09-20 on `stage-1-phase-f`, after Tasks 1–7 deleted the Supabase
stacks, the migration corpus, the dependency and the dead generated types, put a
native-Postgres dev bootstrap in their place, and swept the prose.

This document answers two questions and nothing else:

1. Are Stage 1's eight exit criteria met? Each one below carries the command or
   the file that decides it, its real output, and a verdict.
2. Do the 21 permission rules the corpus carried each have a guard and a test?
   The table names, for every one, the policy it came from, the code, the
   function that enforces it now, the place that calls that function, and the
   test that pins it.

**This task verifies and reports. It fixes nothing.** Every gap it found has a
`docs/backlog.md` entry instead of a patch — the decommission spec's decision 6.

---

## Method — recovering the corpus Task 4 deleted

The three migrations the master plan names, and every other file in the corpus,
were deleted by `8b1e9c4` ("Delete the local Supabase stack and the unapplied
migration corpus"). Everything below was read out of git history, not
reconstructed:

```bash
DEL=$(git log -1 --format=%H --diff-filter=D -- 'supabase/migrations/*')
# → 8b1e9c4dbe914f130bb732eb5a50fda08840cf61
git show --name-only --format= "$DEL" -- 'supabase/migrations/*'   # 60 files + README
git show "$DEL^:supabase/migrations/20260308000033_rls_agenda_motion_vote.sql"
```

Per-file occurrence counts across the whole corpus (`grep -o`, so occurrences
and not lines):

```
has_permission=2 has_board_permission=2  20260308000027_create_rls_helper_functions.sql
has_permission=9 has_board_permission=0  20260308000033_rls_agenda_motion_vote.sql
has_permission=9 has_board_permission=0  20260308000034_rls_minutes_exhibit.sql
has_permission=3 has_board_permission=0  20260308000035_rls_notification.sql
has_permission=1 has_board_permission=0  20260308000038_create_custom_access_token_hook.sql
                                          (24 occurrences in total)
```

### Reconciling the number 21

The brief warned not to assume the three named migrations hold all 21, and they
do not. The 24 occurrences resolve as:

| Where                                | What it is                                      | Count |
| ------------------------------------ | ----------------------------------------------- | ----- |
| `…027` line 69                       | the `CREATE FUNCTION has_permission` definition | 1     |
| `…027` line 100                      | its `COMMENT ON FUNCTION` doc string            | 1     |
| `…033` line 11                       | a prose line in the file's header comment       | 1     |
| `…038` line 32                       | a prose line in the hook's header comment       | 1     |
| `…033`, `…034`, `…035` policy bodies | **real `has_permission()` calls**               | 20    |

Twenty, not twenty-one. The design spec
(`docs/superpowers/specs/2026-08-26-tmm-revival-design.md:188`) subtracted only
the definition and one comment from 24 and arrived at 21; the master plan
carried that forward. The arithmetic was one comment short.

**But 21 is nevertheless the right number of rules**, for a reason the plan's
own wording obscured. `20260308000032_rls_meeting.sql` gates two policies on
`has_board_permission` — a different function, so no `has_permission` grep finds
it — with three calls:

```
20260308000032_rls_meeting.sql:20:    AND has_board_permission('A1', board_id)
20260308000032_rls_meeting.sql:30:      OR has_board_permission('A1', board_id)
20260308000032_rls_meeting.sql:31:      OR has_board_permission('M1', board_id)
```

Count **policies gated on a permission code**, which is what a rule is, and the
corpus has exactly twenty-one:

| Migration                                   | Policies gated on a code | Codes      |
| ------------------------------------------- | ------------------------ | ---------- |
| `20260308000032_rls_meeting.sql`            | 2                        | A1, M1     |
| `20260308000033_rls_agenda_motion_vote.sql` | 8                        | A2, M3, M2 |
| `20260308000034_rls_minutes_exhibit.sql`    | 8                        | R4, R1, A3 |
| `20260308000035_rls_notification.sql`       | 3                        | C2         |
| **Total**                                   | **21**                   |            |

(Twenty-three call sites across twenty-one policies: `exhibit_select` states A3
twice, once per visibility tier, and `meeting_update` states A1 and M1.)

`packages/api/src/trpc/authorization/rules.ts` already numbers its restored
rules 1–21 against exactly this set, and
`packages/api/src/trpc/__tests__/permission.test.ts` opens
`describe("the 21 authorization rules")` with one `it` per number. The
enumeration below is theirs, independently re-derived from the deleted files.

---

## The eight exit criteria

### 1. `./scripts/build-db-from-repo.sh` exits 0 with no shim, seed applied, ≥26 tables — **MET**

Built as `tmm_owner`, a `NOSUPERUSER NOBYPASSRLS` role, via
`./scripts/dev/reset-local-db.sh tmm_gate_scratch`, then re-run standalone to
capture the exit code:

```
$ ls scripts/dev/auth-shim.sql
ls: scripts/dev/auth-shim.sql: No such file or directory      # no shim

$ ./scripts/build-db-from-repo.sh "postgres://tmm_owner@localhost:5432/tmm_gate_scratch"
    0000_baseline.sql
    0001_better_auth_and_tenant_bridge.sql
    0002_invitation_tenant_bootstrap.sql
    0003_portal_tenant.sql
    0004_hash_invitation_tokens.sql
==> Applying seed
NOTICE:  === Seed data loaded successfully ===
NOTICE:  Town: Newcastle, ME
NOTICE:  Persons: 6 (1 admin, 2 staff, 3 board members)
NOTICE:  Boards: 2 (Select Board, Planning Board)
NOTICE:  Meetings: 1 · Agenda items: 5 · Motions: 2 · Attendance: 4
==> Table count
27
==> RLS enabled / forced (must be equal, and equal to the table count)
27 enabled, 27 forced
EXIT CODE = 0
```

27 ≥ 26. The one warning the run emits —
`could not GRANT tmm_app TO tmm_owner; SET ROLE tmm_app will not work on this connection`
— is expected on a non-superuser build and does not affect the exit code; the
test harness provisions its own databases and does hold that grant (criterion
2).

### 2. The isolation test passes as `tmm_app`, all RLS-enabled tables plus the adversarial cases — **MET**

`packages/api/src/db/__tests__/tenant-isolation.test.ts`, run in the `Tasks: 5
successful` run recorded at the bottom of this document. Its own header states
the invariant, and its first assertion is
`expect(who!.current_user).toBe("tmm_app")` (line 339) — the test is not merely
intended to run as the application role, it proves it did.

Eight cases, covering every table in the catalog rather than a hand-kept list:

| Line  | Case                                                                            |
| ----- | ------------------------------------------------------------------------------- |
| `333` | no rows of town B to town A, in every table, and town A's own still returned    |
| `382` | **adversarial** — zero rows with no tenant context set: fails closed, not open  |
| `436` | **adversarial** — cross-tenant UPDATE/DELETE affects zero rows, target intact   |
| `554` | **adversarial** — an INSERT carrying another town's id is rejected              |
| `690` | tenant context does not survive the transaction that set it                     |
| `742` | a `townId` that would silently disable every policy is refused                  |
| `761` | `FORCE ROW LEVEL SECURITY` binds a non-superuser table owner too, behaviourally |
| `880` | `FORCE ROW LEVEL SECURITY` is still set on every table, per the catalog         |

Three adversarial cases were required; there are five.

### 3. All RLS-enabled tables have `FORCE ROW LEVEL SECURITY`, and `push_subscription`'s exemption or policy is recorded — **MET**

Queried against the scratch database as `tmm_owner`:

```
$ psql "$OWNER_URL" -Atc "SELECT current_user || ' | superuser=' || … "
tmm_owner | superuser=false | bypassrls=false

$ psql "$OWNER_URL" -Atc "SELECT count(*) || ' tables, '
    || count(*) FILTER (WHERE relrowsecurity)      || ' enabled, '
    || count(*) FILTER (WHERE relforcerowsecurity) || ' forced'
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'"
27 tables, 27 enabled, 27 forced

$ psql "$OWNER_URL" -Atc "SELECT c.relname FROM pg_class c JOIN pg_namespace n …
  WHERE n.nspname='public' AND c.relkind='r'
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity)"
(no rows)
```

**The criterion says 26; the catalog says 27.** The schema grew after the
criterion was written (`minutes_addendum`, `invitation`, the four live-meeting
tables). Every one of the 27 is both enabled and forced, so the criterion is met
a fortiori. The full list, all `true/true`: `agenda_item`,
`agenda_item_transition`, `agenda_template`, `audit_log`, `board`,
`board_member`, `executive_session`, `exhibit`, `future_item_queue`,
`guest_speaker`, `invitation`, `meeting`, `meeting_attendance`,
`minutes_addendum`, `minutes_document`, `minutes_section`, `motion`,
`notification_delivery`, `notification_event`, `permission_template`, `person`,
`push_subscription`, `subscriber_notification_preference`, `town`,
`town_notification_config`, `user_account`, `vote_record`.

**`push_subscription` has no exemption — it has a policy**, recorded here as the
criterion asks:

```
push_subscription | rls=true force=true
policy push_subscription_tenant_isolation | cmd=ALL
  using / check: (user_account_id IN (
      SELECT ua.id FROM user_account ua WHERE (ua.town_id = get_current_town_id())))
```

It is the one table whose tenancy is reached through a join rather than a
`town_id` column, because it has none — the subscription belongs to an account,
and the account belongs to a town.

### 4. All `SECURITY DEFINER` functions have an explicit `SET search_path` — **MET**

```
$ psql "$OWNER_URL" -Atc "SELECT n.nspname||'.'||p.proname||' -> '
    ||coalesce(array_to_string(p.proconfig,','),'NO proconfig')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
  ORDER BY 1"
public.get_current_person_id       -> search_path=pg_catalog, public
public.get_current_role            -> search_path=pg_catalog, public
public.get_current_town_id         -> search_path=pg_catalog, public
public.get_current_user_account_id -> search_path=pg_catalog, public
public.has_board_permission        -> search_path=pg_catalog, public
public.has_permission              -> search_path=pg_catalog, public
public.is_admin                    -> search_path=pg_catalog, public

$ psql "$OWNER_URL" -Atc "SELECT count(*) || ' SECURITY DEFINER functions, '
    || count(*) FILTER (WHERE proconfig IS NOT NULL
         AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'))
    || ' with explicit SET search_path' … "
7 SECURITY DEFINER functions, 7 with explicit SET search_path
```

The query was widened past the brief's `('public','better_auth')` to every
non-system schema, so a function hiding elsewhere would show. None does.

**The criterion says 14; the catalog says 7.** Fourteen counted `SECURITY
DEFINER` **occurrences** across the deleted corpus, not functions:

```
$ for f in $(git show --name-only --format= "$DEL" -- 'supabase/migrations/*.sql'); do
    n=$(git show "$DEL^:$f" | grep -ci "SECURITY DEFINER"); [ "$n" != 0 ] && echo "$n  $f"
  done
8  20260308000027_create_rls_helper_functions.sql
1  20260308000037_create_handle_new_user.sql
1  20260308000038_create_custom_access_token_hook.sql
1  20260308000040_create_invite_user_function.sql
1  20260310000002_rls_onboarding_inserts.sql
2  20260310000003_onboarding_rpc.sql
```

`…027`'s seven helpers are the seven that survive, and all seven are hardened.
The four functions the other occurrences belonged to are gone with the stack
they served: `handle_new_user`, `custom_access_token_hook` and `invite_user`
were Supabase-auth machinery, and `complete_onboarding` was replaced by
`routes/session.ts`. This closes audit finding **A8**, which named the same
seven (plus the two now-deleted auth functions) as running with a mutable
`search_path`.

### 5. Each of the 21 permission rules has a named guard and a test — **MET for all 21, with five wiring gaps reported**

All 21 have a named rule function in
`packages/api/src/trpc/authorization/rules.ts` and a dedicated test in
`packages/api/src/trpc/__tests__/permission.test.ts` — see the table below. The
criterion as written is therefore met.

Reported separately, because the criterion does not ask it and the reader will:
**five of the 21 are not wired to the write or read path they govern.** Rules
10, 12, 13, and half of 18 and 19 have a guard and a test but no production
caller, and one read path (`minutesDocument.byMeeting`) reaches minutes rows
without rule 9's check. Backlog entries 15–19.

### 6. No `supabase` import remains in `packages/web` or `packages/api` — **MET**

**Corrected 2026-09-20, final fix wave:** this criterion's own wording says "no
supabase import remains" with no package scope, but the recorded grep below was
scoped to `packages/web/src packages/api/src` — narrower than the criterion,
and narrower than the repo. That gap is exactly why a real surviving artifact,
a repo-root `docker-compose.yml` injecting `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` into the API container and pointing at a
`docker/docker-compose.yml` deleted in Task 4, passed this gate undetected —
it lives outside both scanned directories. It has since been deleted (final
fix wave, blocking finding 1). The command is widened here to the whole repo,
excluding `docs/` (which legitimately narrates Supabase history), and re-run:

```
$ git grep -nE "^\s*(import|require|from).*supabase" -- ':!docs/**'
(no output)

$ git grep -n "supabase" -- ':!docs/**' | grep -vE ':\s*\*|:\s*//|__tests__|\.test\.'
.github/workflows/ci.yml:58:      # `packages/web/src/lib/supabase.ts` — which threw at import time when
README.md:48:│   │   ├── 3.2-supabase-hosting.md          #   Original hosting pick (self-hosted Supabase via Docker Compose) — superseded, see Tech Stack below
README.md:178:retired the Supabase-based local stack and its `pnpm supabase:up`/`supabase:reset` commands; see
packages/api/drizzle/0003_portal_tenant.sql:14:-- (`plugins/supabase.ts`), which bypasses RLS outright — the portal, the one
packages/shared/src/utils/subdomain.ts:65:  "supabase",
scripts/dev/baseline-transform.sql:7:-- was derived from the historical supabase/migrations corpus. It is committed
scripts/dev/baseline-transform.sql:262:-- 20260308000039_configure_auth_hooks.sql granted supabase_auth_admin
scripts/dev/baseline-transform.sql:270:  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
scripts/dev/new-agent-worktree.sh:21:#   packages/web/.env — needed only while `packages/web/src/lib/supabase.ts`
scripts/dev/reset-local-db.sh:5:# Replaces `pnpm supabase:up` and the nine-container Supabase stack, which
```

Every one of the ten lines above is a `#`/`--`-style comment narrating what a
file used to do or naming a deleted file/script, a one-time baseline-migration
script's literal Postgres role names being dropped (`scripts/dev/baseline-transform.sql:270`,
not an application dependency), or the pre-existing test fixture/reserved-word
occurrences already accounted for (`resolvePortalTenant(db, "supabase")`
checking a reserved subdomain, a stored-URL parser fixture,
`subdomain.ts`'s reserved-subdomain list). None is an import, a require, or a
reference that resolves to a module. Still **MET** — now against the wording
the criterion actually states.

### 7. No API route is reachable unauthenticated unless explicitly marked public — **MET**

Two tests, both in the recorded run.

`packages/api/src/auth/__tests__/route-access.test.ts` proves the property
structurally, which is what "cannot recur" requires:

- `:68` refuses a brand-new route carrying no auth marking
- `:97` refuses an unmarked route for **every** method, not only GET
- `:114` serves a route explicitly marked public
- `:126` one route's public marking does not leak onto a sibling
- `:161` covers routes registered **before** the plugin, not only after
- `:205` answers 401, not 404, for a path matching no route
- `:224` runs the gate ahead of a route's own `onRequest` hook
- `:256` refuses an unmarked POST before its body is parsed
- `:439`/`:472` ignores JWT-shaped `Authorization` claims and forged Bearer
  tokens entirely

`packages/api/src/routes/__tests__/public-route-inventory.test.ts` pins the
exception list itself: `:147` asserts the served-without-a-session set equals
`EXPECTED_PUBLIC_ROUTES` exactly ("and no others"), `:180` reads the **real**
route table including inline routes, `:169` keeps the public and tenant-exempt
sets disjoint, and `:211` keeps every notification route except the Postmark
webhook behind a session.

### 8. Feature parity on CI — **NOT MET, and not verifiable as written**

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format:check, build, the
dev bootstrap and the tests, and the five gates below are green. That is not
feature parity, and no artefact in the repository proves feature parity, because
there is nothing to compare against:

> **there is no parity baseline.**
> — `docs/superpowers/specs/2026-08-29-phase-e-web-restoration-design.md:25`

The web client was already inert before Phase E began: the browser sent no
credential, so `get_current_town_id()` could not resolve and every PostgREST
read returned zero rows. Phase E was a restoration, not a migration, and its
plans say so repeatedly (`2026-08-29-phase-e-unit-0-boards-slice.md:20`). A
criterion phrased as parity with a predecessor has no predecessor to be at
parity with.

The nearest available substitute is also not wired up: `playwright.config.ts`
and four specs under `e2e/` (`smoke`, `onboarding`, `member-management`,
`meeting-lifecycle`) exist and `pnpm test:e2e` runs them, but
`.github/workflows/ci.yml` has no Playwright step, so CI runs none of them.

Left unticked. **Backlog entry 20** records what would have to exist for the
criterion to become answerable, and proposes the substitute the evidence already
supports.

---

## The 21 permission rules

Columns: the policy as it stood in the deleted corpus; the action code; the rule
function that restates it; where that function is actually called in the running
system; and the test that pins it. `permission.test.ts` numbers its cases to
match the first column, so every row's primary test is
`trpc/__tests__/permission.test.ts` at the `it()` named for that number; extra
tests are listed where they add coverage the numbered case does not.

Paths are relative to `packages/api/src/`.

| #   | Policy (deleted migration)                        | Code   | Rule function (`trpc/authorization/rules.ts`)                       | Enforced at                                                                                                                          | Test                                                                                                   |
| --- | ------------------------------------------------- | ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | `agenda_item_insert` (`…033`)                     | A2     | `assertCanInsertAgendaItem`                                         | `trpc/routers/agenda-item.ts:429` `insert` — `requireBoardPermission("A2", boardIdFrom())`                                           | `permission.test.ts:64` "1/2"; `board-scope.test.ts:150`                                               |
| 2   | `agenda_item_update` (`…033`)                     | A2     | `assertCanUpdateAgendaItem`                                         | `agenda-item.ts:496` `update`, `:554` `reorder`, `:603` `delete`, `:657` `instantiateFromTemplate`                                   | `permission.test.ts:64` "1/2"; `context.test.ts`                                                       |
| 3   | `motion_insert` (`…033`)                          | M3     | `assertCanInsertMotion`                                             | `trpc/routers/motion.ts:187` `insert`                                                                                                | `permission.test.ts:94` "3/4"; `board-scope.test.ts:155`                                               |
| 4   | `motion_update` (`…033`)                          | M3     | `assertCanUpdateMotion`                                             | `motion.ts:247` `callVote`, `:278` `withdraw`                                                                                        | `permission.test.ts:94` "3/4"                                                                          |
| 5   | `vote_record_insert` (`…033`)                     | M3/M8  | `assertCanInsertVoteRecord` (async — self-vote hits the DB)         | `trpc/routers/vote-record.ts:233` `insert` (`requireBoardActor`) + resolver-side call at `:265`                                      | `permission.test.ts:115` "5"; `board-scope.test.ts:313`; `routers/__tests__/vote-record.test.ts`       |
| 6   | `vote_record_update` (`…033`)                     | M3     | `assertCanUpdateVoteRecord`                                         | `vote-record.ts:421` `recordForMotion` — `requireBoardPermission("M3", …)`                                                           | `permission.test.ts:177` "6"                                                                           |
| 7   | `attendance_insert` (`…033`)                      | M2     | `assertCanInsertMeetingAttendance`                                  | `trpc/routers/meeting-attendance.ts:170` `setRollCall`                                                                               | `permission.test.ts:197` "7/8"; `board-scope.test.ts:160`                                              |
| 8   | `attendance_update` (`…033`)                      | M2     | `assertCanUpdateMeetingAttendance`                                  | `meeting-attendance.ts:235` `setStatus`                                                                                              | `permission.test.ts:197` "7/8"                                                                         |
| 9   | `minutes_document_select` (`…034`)                | R4     | `canSelect…` / `assertCanSelect…` / `visibleMinutesDocuments`       | `trpc/routers/minutes-document.ts:428` `detail`, `:491` `pendingByTown`; `storage/documents.ts:146`                                  | `permission.test.ts:218` "9"; `board-scope.test.ts:360`; `portal-rules.test.ts`                        |
| 10  | `minutes_document_insert` (`…034`)                | R1     | `assertCanInsertMinutesDocument`                                    | **no caller** — the only INSERT (`routes/minutes.ts:416`) is gated on **R2** at `:334`                                               | `permission.test.ts:265` "10/11/12/13"; `board-scope.test.ts:166`                                      |
| 11  | `minutes_document_update` (`…034`)                | R1     | `assertCanUpdateMinutesDocument`                                    | `minutes-document.ts:518` `saveDraft` (`requireBoardPermission("R1", …)`); `routes/minutes.ts:621`                                   | `permission.test.ts:265`; `routers/__tests__/minutes-document.test.ts`                                 |
| 12  | `minutes_section_insert` (`…034`)                 | R1     | `assertCanInsertMinutesSection`                                     | **no caller** — nothing in the product writes `minutes_section`                                                                      | `permission.test.ts:265` "10/11/12/13"                                                                 |
| 13  | `minutes_section_update` (`…034`)                 | R1     | `assertCanUpdateMinutesSection`                                     | **no caller** — same                                                                                                                 | `permission.test.ts:265` "10/11/12/13"                                                                 |
| 14  | `exhibit_select` (`…034`, both A3 branches)       | A3     | `canSelectExhibit` / `assertCanSelectExhibit` / `visibleExhibits`   | `trpc/routers/exhibit.ts:330` `byMeeting`; `storage/documents.ts:303`                                                                | `permission.test.ts:292` "14"; `board-scope.test.ts:178`, `:388`                                       |
| 15  | `exhibit_insert` (`…034`)                         | A3     | `assertCanInsertExhibit`                                            | `exhibit.ts:388` `link` (`requireBoardActor`); `storage/documents.ts:412` (upload)                                                   | `permission.test.ts:352` "15/16"; `routers/__tests__/exhibit.test.ts`                                  |
| 16  | `exhibit_update` (`…034`)                         | A3     | `assertCanUpdateExhibit`                                            | `storage/documents.ts:474` (visibility change)                                                                                       | `permission.test.ts:352` "15/16"                                                                       |
| 17  | `notification_event_select` (`…035`)              | C2     | `assertCanSelectNotificationEvent`                                  | `routes/notifications.ts:110` `notificationAdmin` = `requirePermission(PERMISSIONS.C2)`, on `:310`, `:505`                           | `permission.test.ts:377` "17"; `public-route-inventory.test.ts:211`                                    |
| 18  | `notification_delivery_select` (`…035`)           | C2     | `canSelect…` / `assertCanSelect…` / `visibleNotificationDeliveries` | C2 half: `routes/notifications.ts` `notificationAdmin` on `:270`, `:342`, `:370`, `:393`. **Self branch: no caller**                 | `permission.test.ts:392` "18"                                                                          |
| 19  | `subscriber_pref_select` (`…035`)                 | C2     | `canSelect…` / `assertCanSelect…` / `visibleSubscriberPreferences`  | Own half: `trpc/routers/notification-preference.ts` `mine` scopes to `ctx.tenant.personId` by construction. **C2 branch: no caller** | `permission.test.ts:439` "19"                                                                          |
| 20  | `meeting_insert` (`…032`, `has_board_permission`) | A1     | `assertCanInsertMeeting`                                            | `trpc/routers/meeting.ts:646` `insert` — `requireBoardPermission("A1", boardIdFrom())`                                               | `permission.test.ts:471` "20"; `board-scope.test.ts`                                                   |
| 21  | `meeting_update` (`…032`, A1 **or** M1)           | A1, M1 | `assertCanUpdateMeeting`                                            | `meeting.ts:694` `cancel`, `:726` `updateStatus`, `:880` `callToOrder`, `:974` `navigateToAgendaItem`, `:1115` `adjourn`             | `permission.test.ts:530` "21"; `require-board-actor-type.test.ts`; `routers/__tests__/meeting.test.ts` |

**No row is unknown.** Twenty-one rules, twenty-one guards, twenty-one tests.

### Where the restoration is narrower or wider than the policy

Recorded because "has a guard" is not the same as "has the same guard", and a
future reader auditing one of these should find the comparison already made:

- **Rules 1–8, 10–13, 15, 16, 20, 21 are board-scoped; the policies were not.**
  `…033`'s own header says so: _"For MVP performance, we use `has_permission()`
  which checks global permissions only."_ The restored rules take a required
  `BoardScope`. This is a widening for a board-designated clerk (both
  `designated_boards` templates grant these codes only inside `board_overrides`
  with global all-false, so such accounts previously held nothing at all) and a
  narrowing for a clerk explicitly barred from one board. `rules.ts`'s header,
  point 2, argues it at length; `board-scope.test.ts` pins both directions.
- **Rule 9 is stricter**: the policy read
  `has_permission('R4') OR status IN ('approved','published')` with no actor
  term in the second branch. `canSelectMinutesDocument` adds
  `actor.kind !== "user" → false`, so the portal cannot reach approved-but-
  unpublished minutes through it.
- **Rule 10 is enforced by a different code.** The policy said R1; the only
  INSERT path guards on R2 (`assertCanGenerateMinutes`). Across all five shipped
  templates R2 is never granted without R1, so no shipped account's answer
  changes — but a hand-built matrix holding R2 and not R1 would be admitted
  where the policy refused. Backlog entry 15.
- **Rule 18 is narrower**: only the C2 branch is reachable. There is no "my
  deliveries" surface, so the self branch has nothing to admit. Safe direction.
- **Rule 19 is narrower**: `notificationPreference.mine` has no `personId`
  input at all, so the own-scope is structural and the C2 branch is unreachable.
  The router's header states this as a decision. Safe direction.
- **Rule 17's C2 resolves globally**, deliberately: neither `designated_boards`
  template grants C2, and none of the three notification tables has a board
  column. `rules.ts:738-753` groups all three C2 rules with that argument so a
  future per-board C2 template has one place to revisit.
- **The code-versus-name defect (audit A2) does not reach these guards.**
  `plugins/auth.ts:297` translates the action name to its code through
  `CODE_BY_ACTION` before calling `resolvePermission`, and refuses to build a
  check for a name that has no code. Rule 17's `requirePermission(PERMISSIONS.C2)`
  therefore resolves `"C2"`, not `"manage_notification_settings"`. The unfixed
  half of A2 is on the web client and is already backlog entry 6.

---

## Gaps filed

| Gap                                                                    | Backlog entry |
| ---------------------------------------------------------------------- | ------------- |
| Rule 10's guard is unwired; minutes creation is gated on R2            | 15            |
| Rules 12/13's guards have no caller — nothing writes `minutes_section` | 16            |
| Rule 9 is bypassed by `minutesDocument.byMeeting`                      | 17            |
| Rule 18's self branch has no caller                                    | 18            |
| Rule 19's C2 branch has no caller                                      | 19            |
| Criterion 8 has no parity baseline and no test                         | 20            |

No gap was fixed in this task.

---

## Backlog entry 13 — closure confirmed

Task 7 marked entry 13 ("Phase F's inherited surface is written down in a
phase-scoped document") CLOSED. Re-checked at the end of Phase F, every claim in
the closure holds:

```
docker                                        gone
supabase                                      gone
packages/web/src/lib/supabase.ts              gone
packages/web/src/types/database.ts            gone
infrastructure/docker-compose.production.yml  gone

$ git grep -n "@supabase/supabase-js" -- package.json 'packages/*/package.json'
(no output)

$ node -e "console.log(require('./package.json').scripts['db:reset'])"
scripts/dev/reset-local-db.sh
```

`pnpm db:reset` exists and works — criterion 1 above is a run of the script it
points at. The entry stays CLOSED.

---

## The five gates

Run on `stage-1-phase-f` at the end of this task. The test gate was run alone,
with nothing else touching Postgres, as the brief requires.

```
$ pnpm typecheck     -> exit 0   (Tasks: 5 successful, 5 total)
$ pnpm lint          -> exit 0
$ pnpm format:check  -> exit 0   (All matched files use Prettier code style!)
$ pnpm build         -> exit 0   (Tasks: 3 successful, 3 total)

$ DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force
@town-meeting/shared:test:  Test Files   8 passed (8)    Tests   139 passed (139)
@town-meeting/web:test:     Test Files  87 passed (87)   Tests   695 passed (695)
@town-meeting/api:test:     Test Files  71 passed (71)   Tests  1129 passed (1129)

 Tasks:    5 successful, 5 total
exit code 0
```

166 test files, 1963 tests, all green. Among them the two that decide criteria 2
and 7: `db/__tests__/tenant-isolation.test.ts`,
`auth/__tests__/route-access.test.ts` and
`routes/__tests__/public-route-inventory.test.ts`.

The full transcript of every command in this document, with unabridged output,
is in `.superpowers/sdd/2026-09-19-phase-f-decommission/task-8-report.md`.
