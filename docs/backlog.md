# Backlog

Phase-agnostic gaps that a phase's own plan or close-out apparatus decided are
real but out of that phase's scope. This file exists because
`docs/superpowers/plans/phase-e-conventions.md` — where these three were first
recorded — is scoped to Phase E's own lifecycle (its Known-gaps list and
close-out sweep exist to serve Phase E's waves) and nothing suggests it is read
or maintained once the phase ends. Nothing else in the repo tracks future work
across phases; the master plan (`docs/town_meeting_manager_plan.docx` →
`docs/pre-development-advisory.md` → `docs/workflow/README.md`) has no
"future work" section either.

**On format:** this is a plain markdown file, not GitHub Issues, because that
choice belongs to the project owner, not to whichever task happened to be
recording a gap. If the owner would rather track these as issues, converting
each entry below to one is straightforward — the context needed to act on it
is already written out. Either way, add new entries here as they're found;
don't let them live only inside a phase-scoped plan document again.

---

## 1. `getMutationErrorMessage`: three of five error categories have no reader

**Where:** `packages/web/src` — `getMutationErrorMessage`'s definition, its own
doc comment, and `trpc.test.ts` are the only occurrences
(`git grep -n "getMutationErrorMessage" -- packages/web/src`). Zero production
call sites.

**What the gap is:** the helper classifies mutation errors into five
categories, but only two are wired up anywhere; `validation`, `conflict`, and
`unknown` have no reader at all. `errorMessage`'s CONFLICT-verbatim behaviour
is the most obvious first fold-in.

**Why it wasn't closed in Phase E:** wiring these up is a UX decision about
copy at roughly 24 call sites across the web package — which of the three
categories gets its own wording, and where — not a migration-completeness
question. Phase E's definition of done turns on `lib/supabase.ts` being
deleted with nothing left depending on it; this doesn't bear on that. No
Phase E wave task was positioned to make a product decision about user-facing
error text, so each one that looked at it (wave 5, then re-verified at wave 6
Task 0) correctly declined to adopt it and correctly declined to silently pass
it to the next wave either.

**Verification command (re-run before acting, in case it has moved):**

```
git grep -n "getMutationErrorMessage" -- packages/web/src
```

---

## 2. `isPaused`: an offline device pauses mutations with no UI signal

**Where:** `packages/web/src`. `git grep -n "isPaused" -- packages/web/src`
answers nothing at all — not a production reader, not a test, not a comment.

**What the gap is:** the app-shell connection pill states the app-global
offline fact, but no form renders `isPaused`. A user who presses Save while
offline sees a spinner that never resolves, because the mutation is queued
(paused), not failed — and nothing tells them that.

**Why it wasn't closed in Phase E:** closing it well means designing a
per-form "queued, not failed" affordance — distinct from the loading and error
states Phase E's own conventions already require for every migrated form, not
a variant of them. No wave-6 task proposed such a design, and none of the
~70 already-migrated forms (nor the new ones wave 6 adds) would be closed by a
task that wasn't built to invent the pattern. This is a standing product gap
for offline UX, to be picked up by whichever future initiative owns that
surface.

**Verification command:**

```
git grep -n "isPaused" -- packages/web/src
```

---

## 3. Live-meeting connection banner has no terminal state for a silent outage

**Where:** `packages/web/src/hooks/useLiveMeetingEvents.ts`. Its `stopped`
state is reachable only from a real `TRPCError` or an `event: return` from the
server.

**What the gap is:** a server that is simply gone (process killed, network
partition) produces neither signal, so `useSubscription` never leaves
`connecting` and the banner never leaves amber — forever. The three-state
vocabulary (connected / connecting / stopped) is honest as far as it goes, but
has no terminal state for the most likely real outage, and no elapsed-time
point at which it tells an operator to reload.

**Why it wasn't closed in Phase E:** giving "reconnecting" a terminal timeout
is a retry/backoff policy decision — how long is long enough, whether it
should differ for a public-portal kiosk versus a clerk's laptop, whether the
server should start sending `EventSource`'s `retry:` field at all
(`routers/realtime.ts`'s header already declines to, for reasons orthogonal to
this gap). No Phase E wave task touches the live transport itself.

**Verification:** read `useLiveMeetingEvents.ts`'s `stopped`-state transitions
and confirm nothing else sets it; re-check `routers/realtime.ts` for whether a
`retry:` field or a heartbeat has since been added.

---

_First recorded during Phase E wave 5 (as "wave 6 inherits" items) and
re-verified — all three unchanged — during Phase E wave 6, Task 0's fix round
on 2026-09-12, which created this file. See
`docs/superpowers/plans/phase-e-conventions.md`'s "Carried forward" list
(items 5 and 6) and "What the transport taught" section (the
connecting/broken bullet) for the full history and the exact commands each
re-verification ran._

---

## 4. ~~The minutes editor's source panel downloads every seat's live invitation token to resolve names~~ — CLOSED

**Closed by** `fix-roster-invitation-token-leak`: `boardMember.roster` no
longer selects `invitation.token`, the web's unused `invitation_token` field is
gone, and `board-member.test.ts` ("never returns an invitation token, to any
caller") checks the serialized response, so the token coming back under another
alias fails too.

**This entry under-rated what it described.** It was filed as token
minimisation. It was an account takeover: `roster` has no permission guard (the
live screen and the minutes panel read it for any signed-in user), and
`POST /api/invitations/accept` is public and asks for nothing but
`{token, password}` — the caller chooses the password for the invited account,
at the invitation's role, admin included, and the login is marked verified. Any
signed-in user in a town could claim any pending invitation on any board. It
predated Phase E; `SourceDataPanel` was the second screen to read `roster`, not
the cause. The lesson for the next entry like this: a leaked value's severity
is set by what ACCEPTS it, so follow the value to its consumer before rating it.

**What remains, and it is no longer a security item:** `SourceDataPanel` and
`live.tsx` still fetch the full roster to map ids to names. A narrower
`boardMember.namesForBoard` would be smaller, not safer. Adjacent, and
since closed: entry 14.

---

## 5. The web client's `isAdmin` includes sys_admin; the server's authorization does not

**Where:** `packages/web/src/routes/meetings.$meetingId.minutes.tsx:341`
(`const isAdmin = user?.role === "admin" || user?.role === "sys_admin";`) and
`packages/api/src/trpc/authorization/permission.ts` (`resolvePermission`:
line 156 `if (actor.role === "admin") return true;`, line 162
`if (actor.role === "sys_admin") return false;`).

**What the gap is:** the minutes screen shows Approve, Return for Amendments
and Unpublish to any `isAdmin` caller, which the client computes as
`admin || sys_admin`. The server's `resolvePermission` short-circuits `admin`
to true but explicitly denies `sys_admin` — the removed `has_permission()`
function denied sys_admin on purpose, per `permission.ts`'s own comment. So a
sys_admin sees all three buttons and is refused on every one.

**Why it wasn't closed in Phase E:** this is pre-existing — `resolvePermission`
already drew this line before wave 6 touched the file — and reconciling the
client and server definitions of "admin" is a product decision (should
sys_admin be able to approve/return/unpublish a town's minutes, or is the
denial intentional platform-operator scoping?), not a wiring gap this task's
brief covered. Wave 6 Task 3's own contribution is that the refusal is now
VISIBLE (the button submits and shows a FORBIDDEN toast) rather than silent,
which is a strict improvement but not a fix.

**Verification command:**

```
grep -n "isAdmin = user" packages/web/src/routes/meetings.\$meetingId.minutes.tsx
sed -n '150,165p' packages/api/src/trpc/authorization/permission.ts
```

---

## 6. The web client never normalises a code-keyed permissions matrix

**Where:** `packages/shared/src/utils/permissions.ts` (`hasPermission`'s own
doc comment: "It takes an ALREADY-NORMALISED matrix: pass a raw database row
through normalisePermissionsMatrix first, or half the accounts in the system
silently resolve to no permissions at all.") `normalisePermissionsMatrix` has
zero call sites anywhere under `packages/web/src` (production code — the sole
web-package hit is a mock in `StaffAccountFlow.test.tsx`); the server's
`authorization/permission.ts` calls it on every resolution.

**What the gap is:** `packages/api/drizzle/seed/seed.sql` (formerly
`supabase/seed.sql`, before Phase F's decommission) writes at least one account's
`permissions` keyed by action CODE (`{"global": {"A2": true, "A3": true, ...}}`,
the Sarah Mitchell / Deputy Clerk row) rather than by action NAME. The server
normalises this before resolving and allows the action; the web client passes
`user.permissions` straight to `hasPermission` with no normalisation step, so
the same code-keyed matrix resolves to nothing client-side — every
button gated on `hasPermission(...)` for that account is hidden even though
the server would allow the write.

**Why it wasn't closed in Phase E:** repo-wide, not specific to any one
screen or wave-6 task — every web caller of `hasPermission` (this task's
`minutes.tsx` included) shares the same gap, so fixing it belongs in
`useCurrentUser` or wherever `user.permissions` is first read, not in an
individual screen. It limits how much of wave 6 Task 3's `hasPermission`
widening (passing `boardId`/`role`, matching the server) a seeded staff
account can actually exercise: the buttons are correctly computed FROM the
matrix the client has, but the matrix itself is wrong for a code-keyed row.

**Verification command:**

```
git grep -n "normalisePermissionsMatrix" -- packages/web/src
grep -n "global.*A2.*true" packages/api/drizzle/seed/seed.sql
```

---

## 7. Dead legacy cache-invalidation lines, kept deliberately, not yet removed

**Where:** `packages/web/src/lib/__tests__/cache-key-parity.test.ts`'s own header, under "Why a dead
legacy line is not removed on sight"; the same reasoning is in wave 6 Task 4's report
(`.superpowers/sdd/2026-09-12-phase-e-wave-6-minutes-and-completion/task-4-report.md`, §4). Item 7 of
`docs/superpowers/plans/phase-e-conventions.md` ("the legacy line goes when the last legacy reader
does — not before") is the rule roughly 80 wave migrations copy from, and it still reads unamended —
this deviation from it is recorded nowhere the next wave's author would see it before copying that
rule.

**What the gap is:** wave 6 Task 4 moved `routes/meetings.$meetingId.review.tsx` off the last of
THIRTEEN legacy `queryKeys.*` reads, but did NOT delete the now-dead `invalidateQueries(queryKeys.*)`
lines those namespaces' writers still carry, and did not delete the matching `MIGRATED` entries in
`cache-key-parity.test.ts`. Eleven namespaces were affected at that point (not `meetings` — see item
3 of the same task's fix round; it kept live legacy readers in `CommandPalette.tsx`,
`EditBoardDialog.tsx` and `home.tsx` unrelated to that screen): `agendaItem`, `motion`, `voteRecord`,
`executiveSession`, `agendaItemTransition`, `guestSpeaker`, `exhibit`, `meetingAttendance`,
`boardMember`, `town` and `minutesDocument`. Roughly 80 dead lines across ~20 writer files, plus 13
test files that assert on those keys.

**Widened by wave 6, Task 5 (`43c2963`): the set grew again, and `meetings` is now one of the
namespaces affected.** (`MIGRATED` in `cache-key-parity.test.ts` is the authoritative list, not a
count restated here — it holds nineteen entries as of this fix round, and the verification grep
below matches fifteen of them; the two numbers differ because the grep pattern only lists namespaces
with a still-live legacy invalidation to find, and that is a moving target this section's own body
already tracks by name.) That task removed the last legacy reader of `meetings`, `boards`, `persons`
and `minutes` —
the three files the paragraph above names as `meetings`' live readers all migrated in it, along with
`boards.$boardId.templates.$templateId.edit.tsx` (`queryKeys.boards.detail`), `meetings.tsx` /
`home.tsx` / `CommandPalette.tsx` (`queryKeys.boards.byTown`), `home.tsx`
(`queryKeys.minutes.byMeeting`) and both person dialogs (`queryKeys.persons.byTown`). So:

- **`meetings`: partially executed, deliberately.** Task 5 DID delete the two lines whose stated
  justification it falsified — `meetings.tsx`'s `queryKeys.meetings.byTown` and
  `CreateMeetingDialog.tsx`'s `queryKeys.meetings.byBoard`, both of whose comments named a reader
  that task removed by name. It stopped there because `queryKeys.meetings.detail`/`.all` lines
  survive in seven other files (they were already dead before wave 6, so they belong to this batch,
  not to that task), which keeps the `meetings` MIGRATED entry matching something and avoids the
  "zero violations for the wrong reason" trap below.
- **`boards`, `persons`, `minutes`: not executed.** Deleting their remaining lines empties those
  MIGRATED entries entirely, which forces the same-commit entry removal this section already
  requires — exactly the batch being deferred. Left in place, with the comments that justified them
  corrected to say the key is dead rather than to keep naming readers that no longer exist. One of
  those comments, in `routes/settings.meeting-notices.tsx`, had already been false since wave 5.

**Why it wasn't closed in Phase E:** the call to keep them stands on sequencing, not on the check
going vacuous without them (verified false — deleting them and planting an unpathFiltered writer on
top still gets caught, 1 violation out of 16 matched pairs). An ~80-line deletion across ~20 writer
files plus 13 test files, in the same wave Task 5 adds writers to several of those same files,
deserves its own diff rather than riding along with a screen migration.

**Condition that retires this entry:** either (a) no remaining Phase E wave task is adding writers to
any of the affected files, or (b) wave 6 closes out, whichever comes first. **(a) is now satisfied —
Task 5 was the last task that adds writers, and Task 6 only deletes — so this is actionable as soon
as wave 6's close-out wants it.** At that point: delete the now-pointless `queryKeys.<abandoned>`
invalidation lines for every namespace `MIGRATED` names (quote the object, not a count), delete the matching `MIGRATED` entries in
`cache-key-parity.test.ts` in the SAME commit (an entry with nothing left to match reports zero
violations for the wrong reason), and update the test files that assert on those keys. Note that
emptying the map entirely leaves `cache-key-parity.test.ts` checking nothing at all — decide then
whether it is deleted with the last entry or kept as a tripwire against a NEW legacy key being
introduced.

**Verification command (re-run before acting, in case counts have moved):**

```
grep -rl "queryKeys\.\(agendaItems\|motions\|voteRecords\|executiveSessions\|agendaItemTransitions\|guestSpeakers\|exhibits\|attendance\|members\|towns\|minutesDocuments\|meetings\|boards\|persons\|minutes\)\." packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
```

(Widened with the four namespaces wave 6 Task 5 added. The authoritative list is
`cache-key-parity.test.ts`'s own `MIGRATED` object, not this pattern — quote the object, as that
file's header says.)

---

## 8. The cache-key parity check cannot see a writer whose table never had a legacy key

**Where:** `packages/web/src/lib/__tests__/cache-key-parity.test.ts`'s header, the
`futureItemQueues: "futureItem"` paragraph; wave 6 Task 4's report, §4 ("The one real gap, and the
check could not have found it").

**What the gap is:** `future_item_queue` rows are written only server-side, inside
`meeting.performAdjournment` — no client code ever invalidated `queryKeys.futureItemQueues`, because
no client code ever wrote through that legacy key in the first place. Conventions item 7's prescribed
procedure for finding writers that owe a `pathFilter()` call — `grep -rn "queryKeys.<entity>"` across
the tree, then check every `invalidateQueries` hit for the router's `pathFilter()` — returns exactly
ONE hit for `futureItemQueues` (the reader itself, before it migrated) and ZERO invalidation call
sites to check. The two real writers of the table (`routes/meetings.$meetingId.live.tsx`'s
`adjournMutation`, `components/meeting/VotePanel.tsx`'s `data.adjourned` branch) both invalidated
three other routers each and silently omitted the fourth — invisible to the procedure at any legacy
key count, because the procedure only ever looks at what already has a legacy key to grep for. This
is the client-side half of the blind spot wave 5 Task 3 named for the server side (a multi-table
mutation needs its own topic-set test; the inventory will not ask for it).

**Why it wasn't closed in Phase E:** it isn't a defect in any one task's diff — both real writers were
fixed on discovery, in wave 6 Task 4 itself. It's a gap in the CHECKING PROCEDURE (item 7's own
prescription) that no amount of running it more carefully would have caught, because the procedure's
input (a legacy key to grep for) doesn't exist for a table with no legacy reader at all. Closing it
needs either a different kind of check (e.g., a per-mutation topic/invalidation manifest, independent
of legacy keys) or an explicit convention that a NEW tRPC-only read of a server-written table gets its
writers audited by hand for a missing invalidation, since no mechanised check can find it via the
legacy-key route.

**Verification command:**

```
grep -rn "queryKeys.futureItemQueues" packages/web/src   # comment mentions only today, no live reads
grep -rn "trpc.futureItem.pathFilter()" packages/web/src | grep -v __tests__ | grep -v '\.test\.'
```

---

## 9. `MeetingLifecycle.tsx` renders a stage no row can reach, and the values were unmarked in the one file where they're user-visible

**Where:** `packages/web/src/components/MeetingLifecycle.tsx:14,16` (`LIFECYCLE_STAGES`) and its
`MEETING_STATUS_LABELS`-less "Published" stage.

**What the gap is:** `"in_progress"` (line 14, the `meeting` stage's `statuses`) and `"published"`
(line 16, the `published` stage's `statuses`) are not `meeting_status` enum values — the enum is
`draft, noticed, open, adjourned, minutes_draft, approved, cancelled`
(`0000_baseline.sql`; `SELECT 'in_progress'::meeting_status` raises "invalid input value for enum
meeting_status"). `home.tsx` and `meetings.tsx` both carry the identical two dead values and both
NAME them in a header comment (wave 6 Task 5); `MeetingLifecycle.tsx` carries the same two and,
until this fix round, named neither, even though this is the file where the dead vocabulary is
user-visible rather than merely inert: `LIFECYCLE_STAGES` renders a "Published" stage no meeting row
can ever reach, and `components/meetings/meeting-labels.ts`'s `MEETING_STATUS_LABELS` has no entry
for `in_progress` or for the `approved`+`published` pair `published`'s stage would need, so a row
that somehow reached either dead value would render with no label at all.

**Why it wasn't closed in Phase E:** deferring the three-file fix is correct — deciding what the
lifecycle rail should actually show is a product decision (does "Published" get renamed, dropped, or
does an `approved` meeting need a real post-adoption status the schema doesn't have yet?), not a
transport change, and wave 6 Task 5 said so explicitly for `home.tsx` and `meetings.tsx`. Leaving the
_shared_ file — the one both screens render through — unmarked while its two consumers are marked is
an inconsistency, not a scope decision; annotated here rather than left for a later wave to
rediscover a third time.

**Retirement condition:** whoever resolves `home.tsx`'s and `meetings.tsx`'s own dead-status
comments (both point back at this file) fixes all three in one change — either by removing
`"in_progress"`/`"published"` from `LIFECYCLE_STAGES`'s `statuses` arrays (they match nothing, so
deleting them changes no observable behavior) or by giving the product decision behind them a real
answer first. This entry retires the moment `MeetingLifecycle.tsx`'s `LIFECYCLE_STAGES` no longer
contains either string.

**Verification command:**

```
grep -n '"in_progress"\|"published"' packages/web/src/components/MeetingLifecycle.tsx
psql -c "SELECT 'in_progress'::meeting_status"   # confirms the enum still rejects it
```

---

## 10. `meeting.byTown` has no `LIMIT` and now feeds three screens

**Where:** `packages/api/src/trpc/routers/meeting.ts`'s `byTown` procedure; read by `home.tsx`, the
`/meetings` kanban, and `CommandPalette`.

**What the gap is:** `meeting.byTown` selects every `status != 'cancelled'` meeting row for the
caller's town with no `LIMIT` clause. This is not a regression from wave 6 Task 5 — `home.tsx`'s raw Supabase
read before the migration was already unbounded — but Task 5 widened its blast radius: dropping
`CommandPalette`'s own `.limit(50)` was the correct fix for a real defect (a search that could not
find the 51st-oldest meeting), and it works only because the shared procedure now returns everything
regardless of which of the three screens asked. A town with enough meeting history eventually sends
its entire meeting table to the browser on every home-page load, every kanban load, and every
command-palette open.

**Why it wasn't closed in Phase E:** it isn't a defect any single task introduced — it's a scaling
question with no current symptom (no town in this dataset is large enough to notice), and none of
the three consumers has a natural per-screen cap that wouldn't reintroduce the CommandPalette bug in
reverse (a `LIMIT` on the shared procedure caps the kanban and home too). Fixing it needs either a
`limit`/pagination argument on `byTown` that each caller sets independently, or a separate narrower
procedure for the two screens that only need "upcoming" or "recent," leaving the unbounded scan to
whichever caller (if any) genuinely needs the whole history.

**Verification command:**

```
grep -n "byTown" packages/api/src/trpc/routers/meeting.ts
```

---

## 11. Two live defects in generated legal minutes, assigned to Phase E wave 6 and never decided

**Where:** `packages/api/src/trpc/routers/meeting.ts` (`performAdjournment`'s
`jsonb_build_object`, `'adjourned_by', ${personId}`),
`packages/api/src/services/minutes-assembler.ts` (`memberName(adjData.adjourned_by …)`),
`packages/api/src/services/minutes-formatters.ts` (`formatAdjournmentText`'s
`attendance.presiding_officer` fallback); and
`packages/web/src/components/meeting/VotePanel.tsx` (the
`POST /api/meetings/${meetingId}/minutes/render` inside the `data.adjourned`
branch).

**What the gaps are:**

- **The record names the wrong adjourner.** `adjourned_by` is written as a
  `person.id` and looked up in a `board_member.id` map, so it always resolves to
  `null`; `formatAdjournmentText` treats null as "not recorded" and falls back to
  the presiding officer. The field is never blank — when a clerk adjourns and the
  chair presides, the generated PDF states that the chair adjourned the meeting,
  and nothing flags it. `adjourned_by_name` is written and read by nothing.
  **There is a deliberate tripwire:** `meeting.test.ts` asserts
  `adjourned_by: operator.personId`, pinning the DEFECTIVE shape. A correct fix
  turns it red on purpose. A fix also needs `performAdjournment` to resolve the
  actor's `board_member.id` on that board — it does not today — and a decision
  about existing rows.
- **The DRAFT watermark is never removed.** `VotePanel` posts the LIVE meeting's
  id to a meeting-keyed render route, while the approved document belongs to an
  EARLIER meeting (reached through `agenda_item.source_minutes_document_id`). The
  request 404s into a swallowed `.catch(() => {})`, so the un-watermarked
  re-render has never once happened. `approveMinutesForPassedMotion` already has
  the right `documentId` in hand; a fix needs a document-keyed route or a
  `document_id` param, plus a decision about which board the R5/R1 check derives
  from when the two meetings differ. No pin of any kind exists today.

**Why it wasn't closed in Phase E:** wave 5 deliberately preserved both rather
than change a legal record inside a migration, and the wave-6 plan assigned the
DECISION to wave 6 in bold ("Wave 6 owns the reading surface, so this is where
they get decided"). The two tasks positioned to make it — Task 3 (`minutes.tsx`)
and Task 4 (`review.tsx`) — both judged it out of scope, correctly: each is a
product decision about what a legal record says, not a wiring question, and
neither task's brief covered it. No later task owned it, and the phase ended.
Recorded here at the close-out so the decision does not die with the
phase-scoped plan document that assigned it. **Both defects re-verified as live
at `be61cfa`.**

**Verification commands:**

```
grep -n "adjourned_by" packages/api/src/trpc/routers/meeting.ts
grep -n "memberName(adjData" packages/api/src/services/minutes-assembler.ts
grep -n "minutes/render" packages/web/src/components/meeting/VotePanel.tsx
```

---

## 12. The "minutes approved" email queued from a live meeting reaches nobody

**Where:** `packages/api/src/trpc/routers/minutes-document.ts`
(`approveMinutesForPassedMotion`'s `INSERT INTO notification_event`) and
`packages/api/src/services/notification-service.ts`
(`getSubscribersForEvent`).

**What the gap is:** `getSubscribersForEvent` reads `payload.board_id` and
returns NO subscribers without it. `approveMinutesForPassedMotion` queues
`{minutes_document_id, meeting_id, approved_by_motion_id}` — no `board_id` — so
the notification raised when a board votes its minutes through during a live
meeting is delivered to nobody. The three procedures wave 6 Task 1 built
(`submitForReview`, `approve`, `publish`) all carry `board_id` for exactly this
reason, and three tests assert it; this one path does not.

**Why it wasn't closed in Phase E:** it was found in wave 6 Task 1 while
building the sibling procedures, in a function that belongs to wave 5's diff and
sat outside every subsequent task's file list. The fix is probably one line, but
it changes who receives mail about an adopted legal record, and it needs a test
that proves delivery rather than one that proves the row was written — which is
what the existing coverage proves. The defect is named in the payload itself so
it is not rediscovered a third time.

**Verification command:**

```
# the queued payload — three keys, no board_id:
grep -n "'minutes_approved'," -A 6 packages/api/src/trpc/routers/minutes-document.ts
# the reader — minutes_approved shares the branch that returns [] without one:
grep -n 'case "minutes_approved"' -A 9 packages/api/src/services/notification-service.ts
```

---

## 13. ~~Phase F's inherited surface is written down in a phase-scoped document~~ — CLOSED

**Closed by** Phase F Tasks 1–6: the local dev stack, the production Docker
Compose stack, the Supabase migration corpus, the `@supabase/supabase-js`
dependency and the generated `database.ts` types are all deleted, and
`pnpm db:reset` replaces the local stack (see git history and
`docs/superpowers/`). This entry existed so Phase F's plan would find the
inherited-surface material in `docs/superpowers/plans/phase-e-conventions.md`;
it did, and acted on it.

**What the gap was:** Phase E's close-out measured what was still left of the
Supabase stack and sorted it into four kinds of work (the local dev stack, the
production stack, the migration history, and prose that outlived its subject),
along with three authorization questions item 2 did not cover for a
decommissioning phase. That material was correct and current as of `be61cfa`.

**Two facts from it, now historical:** `packages/api`'s entire remaining
Supabase surface used to be one unused dependency line in `package.json`
(nothing under `packages/api/src` imported the package or read a `SUPABASE_*`
variable) — that line is gone; and the persisted volume
`docker/volumes/db/data`, which used to hold every local developer's auth
accounts and which the old `supabase/seed.sql` never recreated, is gone too —
`pnpm db:reset` builds logins fresh every time instead.

---

## 14. ~~Any signed-in user can rotate, and re-send, anyone's pending invitation~~ — CLOSED

**Closed by** `fix-invitation-send-resend-permission`: `POST
/api/invitations/:id/send` and `/resend` now require an administrator
(`assertCanInsertUserAccount`, via `assertMayIssueInvitations` in
`packages/api/src/routes/invitations.ts`), checked before the invitation is
read, so `resend` never reaches its reissue `UPDATE` for a refused caller.
`routes/__tests__/invitations-send-resend.test.ts` covers a board member with
no grants and a staff account holding every global grant (both 403, token
unchanged, no email) and an administrator (both 200, token rotated on resend).

**Why that rule:** every procedure that issues an invitation already requires
an administrator, so the `/send` each of them makes immediately afterward can
never be refused by this guard.

**Ordering is what the test is really about.** With the guard moved below the
`UPDATE`, the route still answered 403 — and had already rotated the token.
Only the token assertion caught it.

**Left open, deliberately:** `MemberRoster` shows Send/Resend to every
signed-in user, as it does Transition, Archive and Edit title — all
admin-only on the server. A non-admin who clicks one gets the rule's message
in a toast. Hiding admin-only row actions is a roster-wide UX decision, not
part of this fix.

---

## 15. ~~Rule 10's guard is unwired — minutes creation is gated on R2, not R1~~ — CLOSED

**Closed 2026-09-20** by wiring the guard in, per the owner's decision that
creation needs BOTH codes: `POST /meetings/:id/minutes/generate` now calls
`assertCanGenerateMinutes` (R2 — who may run the generator) **and**
`assertCanInsertMinutesDocument` (R1 — who may create the document), restoring
what the deleted policy `minutes_document_insert` required.
`POST /meetings/:id/minutes/regenerate` overwrites an existing draft, so it
takes `assertCanUpdateMinutesDocument` (rule 11, also R1).

**Blast radius: none for shipped templates.** All four templates that grant R2
grant R1 as well; `TEMPLATE_GENERAL_STAFF` has neither. Only a hand-built matrix
holding R2 without R1 is newly refused — the case the policy existed to refuse.

**Pinned by** `routes/__tests__/board-scoped-legacy-routes.test.ts`, describe
block "creating a minutes document needs R1 as well as R2 (backlog 15)": three
cases (generate refused, generate allowed with both, regenerate refused).
Mutation-checked — removing either guard turns its own named test red.

---

## 16. Rules 12 and 13 guard a table nothing writes

**Where:** `packages/api/src/trpc/authorization/rules.ts`
(`assertCanInsertMinutesSection`, `assertCanUpdateMinutesSection`) and the
absence of any `minutes_section` writer anywhere in `packages/api/src` or
`packages/web/src`.

**What the gap is:** the corpus carried `minutes_section_insert` and
`minutes_section_update`, both R1. Both are restated in `rules.ts` and both are
pinned by `trpc/__tests__/permission.test.ts:265`. Neither has a production
caller, because the product has no `minutes_section` router, no route and no
raw write — the only `INSERT INTO minutes_section` in the repository is in
`db/__tests__/tenant-isolation.test.ts`'s fixture. Minutes content lives in
`minutes_document.content_json` instead. This is not a live hole (an unwritten
table cannot be written past its guard) but it is a rule whose enforcement is
supplied by absence, which stops being true the first time a section writer is
added.

**Why it was not closed in Phase F:** there is nothing to fix. Deleting the two
guards would remove the only record that R1 governs sections, and the two
numbered test cases with them; wiring them needs a writer that does not exist
and that no screen asks for. Recorded so the next task that builds a sectioned
minutes editor finds the rule already decided instead of inventing one.

**Retirement condition:** either a `minutes_section` write path exists and calls
both guards, or a decision is recorded that `minutes_document.content_json` is
the permanent shape and the table (with its two guards) is dropped.

**Verification command:**

```
# no writer outside the test fixture:
git grep -n "INSERT INTO minutes_section\|UPDATE minutes_section" -- packages/
# the two guards, and their zero callers:
git grep -n "assertCanInsertMinutesSection\|assertCanUpdateMinutesSection" \
  -- packages/api/src | grep -v __tests__
```

---

## 17. `minutesDocument.byMeeting` returns a draft document's id and status with no R4 check

**Where:** `packages/api/src/trpc/routers/minutes-document.ts:322`
(`byMeeting`), against
`packages/api/src/trpc/authorization/rules.ts`'s rule 9
(`canSelectMinutesDocument` / `assertCanSelectMinutesDocument`).

**What the gap is:** rule 9 restores `minutes_document_select`, which gated
**every** column of a draft or in-review minutes row behind R4. Two of the three
read paths apply it — `detail` calls `assertCanSelectMinutesDocument` at `:428`,
`pendingByTown` filters through `visibleMinutesDocuments` at `:491` — and
`storage/documents.ts:146` applies it to the PDF download. `byMeeting` does not:
it runs `SELECT id, status FROM minutes_document WHERE meeting_id = …` inside
the tenant context and returns the row to any signed-in member of the town. No
content leaks, but the existence and workflow state of an unadopted minutes
document does, including for an executive session — which `rules.ts`'s own rule
9 comment calls "the single most sensitive document this product holds."

**Why it was not closed in Phase F:** Task 8 is verify-and-report, and this is a
behaviour change to a procedure with callers: `byMeeting` is how the web client
decides whether to offer "Generate minutes" or "Open minutes" for a meeting, so
returning `null` to a caller without R4 changes what that screen renders. The
fix is probably to return `null` rather than to throw — a list-shaped decision
rule 9's three forms already anticipate — but it needs the screen checked, not
just the procedure.

**Retirement condition:** `byMeeting` routes its row through
`canSelectMinutesDocument` (joining `meeting` for the board, as `detail` does),
and a test asserts that a caller without R4 gets `null` for a `draft` row and
the row for an `approved` one.

**Verification command:**

```
# the unguarded read:
sed -n '322,336p' packages/api/src/trpc/routers/minutes-document.ts
# the two siblings that do apply the rule:
grep -n "assertCanSelectMinutesDocument\|visibleMinutesDocuments" \
  packages/api/src/trpc/routers/minutes-document.ts
```

---

## 18. Rule 18's self branch has no caller — a person cannot read their own notification deliveries

**Where:** `packages/api/src/trpc/authorization/rules.ts`
(`canSelectNotificationDelivery`, `assertCanSelectNotificationDelivery`,
`visibleNotificationDeliveries`) and `packages/api/src/routes/notifications.ts`,
whose delivery reads at `:270`, `:342`, `:370` and `:393` all sit behind the
`notificationAdmin` preHandler (`:110`, `requirePermission(PERMISSIONS.C2)`).

**What the gap is:** the deleted `notification_delivery_select` policy admitted
`has_permission('C2') OR subscriber_id = get_current_person_id()`. The restored
rule keeps both branches and `trpc/__tests__/permission.test.ts:392` pins both,
but only the C2 branch is reachable: there is no surface anywhere that shows a
person their own notification history, so the three self-scoped functions have
zero production callers. The direction is safe — the running system is
**narrower** than the policy, not wider — but the rule is half-enforced and a
grep for "is rule 18 wired" answers yes on the C2 half alone.

**Why it was not closed in Phase F:** wiring the self branch means building a
screen (a "your notifications" view) that no plan has asked for, which is
product work and not decommissioning. Deleting the branch would discard a rule
the corpus actually carried, before anyone has decided that residents never get
a delivery history.

**Retirement condition:** either a procedure exists that serves a person their
own deliveries through `visibleNotificationDeliveries`, or a decision is
recorded that delivery history is administrator-only and the self branch is
removed from the rule and its test.

**Verification command:**

```
git grep -n "canSelectNotificationDelivery\|visibleNotificationDeliveries" \
  -- packages/api/src | grep -v __tests__
grep -n "notificationAdmin" packages/api/src/routes/notifications.ts
```

---

## 19. Rule 19's C2 branch has no caller — C2 cannot read anyone's notification preferences

**Where:** `packages/api/src/trpc/authorization/rules.ts`
(`canSelectSubscriberPreference`, `assertCanSelectSubscriberPreference`,
`visibleSubscriberPreferences`) and
`packages/api/src/trpc/routers/notification-preference.ts`'s `mine`.

**What the gap is:** the deleted `subscriber_pref_select` policy admitted
`person_id = get_current_person_id() OR has_permission('C2')`. `mine` enforces
the first half by construction — it has no `personId` input and reads
`WHERE person_id = ${ctx.tenant.personId}` — which the router's header argues is
stronger than a runtime check. The C2 half has no caller: nothing lets a
notification administrator see who has opted out of what, so the three rule
functions are unreferenced outside `permission.test.ts:439`. Again narrower than
the policy, so not a hole; again half-enforced.

**Why it was not closed in Phase F:** the same reason as entry 18. An
administrator-facing preferences view is product work, and the C2 branch exposes
one person's communication choices to another, which is a privacy decision
rather than a wiring one.

**Retirement condition:** either a C2-gated procedure reads preferences through
`visibleSubscriberPreferences`, or a decision is recorded that preferences are
self-service only and the C2 branch is removed from the rule and its test.

**Verification command:**

```
git grep -n "canSelectSubscriberPreference\|visibleSubscriberPreferences" \
  -- packages/api/src | grep -v __tests__
grep -n "person_id = " packages/api/src/trpc/routers/notification-preference.ts
```

---

## 20. Stage 1's "feature parity on CI" criterion has no baseline and no test

**Where:** `docs/superpowers/plans/2026-08-26-stage-1-platform.md`'s exit-criteria
list (the eighth item), `docs/superpowers/specs/2026-08-26-tmm-revival-design.md:480`,
and `.github/workflows/ci.yml`.

**What the gap is:** the criterion asks CI to demonstrate feature parity. CI
demonstrates that typecheck, lint, format:check, build, the dev bootstrap and
the full test suite pass; it does not and cannot demonstrate parity, because
there is no predecessor to be at parity with.
`docs/superpowers/specs/2026-08-29-phase-e-web-restoration-design.md:25` states
it plainly — "there is no parity baseline" — and explains why: the web client
was already inert before Phase E, since the browser sent no credential and
`get_current_town_id()` could not resolve, so every PostgREST read returned zero
rows. Phase E was a restoration. The criterion is left unticked in the Stage 1
plan and in `docs/superpowers/plans/phase-f-stage-1-gate.md` because ticking it
would assert something no artefact supports.

**Why it was not closed in Phase F:** it cannot be closed by any amount of
deleting. The nearest thing to an answer already exists and is not wired up:
`playwright.config.ts` and four specs under `e2e/` (`smoke`, `onboarding`,
`member-management`, `meeting-lifecycle`) are in the repository, `pnpm test:e2e`
runs them, and **CI runs none of them** — `.github/workflows/ci.yml` has no
Playwright step. Whether those four still pass against the post-Phase-F stack is
itself unknown; they were last touched before the decommission, and their
`baseURL` assumes a dev server nobody starts in CI. Standing them up is a body
of work, not a decommissioning step, and it would still not be _parity_ — it
would be a functional suite, which is the thing worth having.

**Retirement condition:** the owner either (a) restates the criterion as
something CI answers — the suggestion the evidence supports is "CI green on
typecheck, lint, format:check, build, dev bootstrap and the full test suite,
with the tenant-isolation and route-access gates among them" — and ticks it
against that, or (b) gets the four `e2e/` specs running green against a seeded
database in CI and ticks it against that instead.

**Verification command:**

```
grep -n "Feature parity on CI" docs/superpowers/plans/2026-08-26-stage-1-platform.md
grep -n "no parity baseline" docs/superpowers/specs/2026-08-29-phase-e-web-restoration-design.md
ls e2e/*.spec.ts                                    # four specs exist
grep -n "e2e\|playwright" .github/workflows/ci.yml  # and CI runs none of them
```

---

## 21. `serving-surface.test.ts` no longer pins the group half of nginx's read access to API-written files

**Where:** `packages/api/src/storage/__tests__/serving-surface.test.ts`, the
`describe("what the API writes is readable by nginx and by nothing else", ...)`
block and its JSDoc comment immediately above.

**What the gap is:** the property this suite exists to protect has two
halves — the mode bits `writeFileDurably` sets on files and directories, and
the shared group that let nginx's unprivileged workers actually read files
owned by a different Linux user (the API process). Before Phase F, the second
half was pinned by reading `infrastructure/docker-compose.production.yml` at
module load and asserting it ran the API container with
`TMM_ASSET_UID`/`TMM_ASSET_GID` (default `101`), matching nginx's own primary
group in that image. Phase F (Task 6) deleted that compose file outright — the
owner decision was remove, not replace, since no non-Docker deployment was
being built in this phase — which left the test reading a file that no longer
exists. It was fixed minimally in the same task: the `COMPOSE`
`fs.readFileSync` and the one test asserting against it were removed, leaving
only the still-true half (nginx still drops its workers to an unprivileged
`user nginx;`) and a comment explaining why the group-side pin is gone.

**Why it wasn't closed in Phase F:** there is nothing in this phase to pin it
against. The group relationship is a property of a _deployment_, not of this
application's source — with the compose file gone and no replacement
deployment artefact in the repository, there is no file left to read an
assertion out of. Re-establishing the pin is deployment design work that
belongs to whichever phase next defines how the API and nginx actually run
together, not to a decommissioning task.

**Retirement condition:** the Stage 2 deploy spec re-establishes how the API
and nginx's workers share group access to written files (containers, systemd
`SupplementaryGroups`, or otherwise), and pins that relationship the same way
the deleted compose-file test did — a structural assertion against whatever
artefact encodes the deployment, not a comment. Until then this is recorded
only in this file; the task-6 report it was first written down in
(`.superpowers/sdd/2026-09-19-phase-f-decommission/task-6-report.md`) is
git-ignored SDD scratch space and would vanish on merge.

**Verification command:**

```
git grep -n "TMM_ASSET_GID" -- packages/api/src   # only the writer's own comment remains
git log --diff-filter=D --name-only --format=%H -- 'infrastructure/docker-compose.production.yml'
sed -n '1,30p;230,340p' packages/api/src/storage/__tests__/serving-surface.test.ts
```
