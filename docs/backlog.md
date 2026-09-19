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
`boardMember.namesForBoard` would be smaller, not safer. Adjacent and still
open: entry 14.

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

**What the gap is:** `supabase/seed.sql` writes at least one account's
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
grep -n "global.*A2.*true" supabase/seed.sql
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

## 13. Phase F's inherited surface is written down in a phase-scoped document

**Where:** `docs/superpowers/plans/phase-e-conventions.md`, the closing sections
"What Phase E taught that the spec could not have known" and "What Phase F
inherits, and what item 2 still does not say for it".

**What the gap is:** Phase E's close-out measured what is actually left of the
Supabase stack and sorted it into four kinds of work (the local dev stack, the
production stack, the migration history, and prose that outlived its subject),
along with three authorization questions item 2 does not cover for a
decommissioning phase. That material is correct and current as of `be61cfa`, and
it lives in a document this file's own preamble says nothing reads once Phase E
ends. This entry exists so Phase F's plan finds it.

**Two facts from it worth repeating here, because they change the shape of the
work:** `packages/api`'s entire remaining Supabase surface is **one unused
dependency line in `package.json`** (nothing under `packages/api/src` imports the
package or reads a `SUPABASE_*` variable); and the persisted volume
`docker/volumes/db/data` holds every local developer's auth accounts, which
`supabase/seed.sql` does not recreate — so retiring the `db` service is a data
question, not a `docker compose down`.

**Verification command:**

```
git grep -n "@supabase/supabase-js" -- . ':!pnpm-lock.yaml' ':!docs' ':!.superpowers'
grep -rn "SUPABASE" packages/api/src --include='*.ts'
```

---

## 14. Any signed-in user can rotate, and re-send, anyone's pending invitation

**Where:** `packages/api/src/routes/invitations.ts` —
`POST /api/invitations/:id/send` and `POST /api/invitations/:id/resend`.

**What the gap is:** both take `app.verifyAuth` and nothing else — no
permission check. `resend` generates a new token and resets the expiry, so any
signed-in user in a town who knows (or is shown) an invitation's id can
invalidate the link sitting in the invitee's inbox, and either route re-sends
the email with `invited_by` set to the caller. `boardMember.roster` still
returns `invitation_id` to every signed-in user, so ids are not hard to come by.

**Why it is not a takeover:** the new token goes only to the invitee's
`person.email`, and changing that email goes through `person.update`, which is
guarded (`assertCanUpdatePerson`). Found while closing entry 4, and kept out of
that fix deliberately.

**Condition that retires this entry:** both routes check the same permission
the client uses to offer "Resend" (or whatever the owner decides governs
inviting), with a test that a board member with no grants gets 403.

**Verification command:**

```
grep -n -A2 '"/invitations/:id/send"\|"/invitations/:id/resend"' packages/api/src/routes/invitations.ts
```
