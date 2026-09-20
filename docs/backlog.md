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

## 5. ~~The web client's `isAdmin` includes sys_admin; the server's authorization does not~~ — CLOSED

**Closed 2026-09-20** by aligning the client to the server, per the owner. The
server's line is deliberate and documented: a platform operator administers the
deployment and is not a clerk of any town, so `resolvePermission` short-circuits
`admin` to true and then denies `sys_admin` outright — as the deleted
`has_permission()` did. Nothing on the server changed; nobody gained access.

Three client checks dropped `sys_admin`:
`hooks/usePermission.ts`'s `checkPermission`,
`routes/meetings.$meetingId.review.tsx`'s `canGenerateMinutes`, and
`routes/meetings.$meetingId.minutes.tsx`'s `isAdmin` — the last being the one
that offered Approve, Return for Amendments and Unpublish to a caller the
server then refused on every one.

**Pinned by** `hooks/__tests__/usePermission.test.ts` (new): a `sys_admin` is
denied the operational codes, an `admin` still holds them, a `sys_admin` is
denied even a code their matrix carries (matching the server's outright denial,
not a fall-through), and a signed-out caller gets nothing. Mutation-checked —
restoring `sys_admin` to the short-circuit turns two of them red.

**Noted while writing those tests:** `checkPermission` reads the matrix by
ACTION NAME while the database stores it by CODE, so a code-keyed matrix reads
as empty in the browser. That is entry 6, untouched here; the test uses the
name spelling deliberately so the two defects cannot hide each other.

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

## 12. ~~The "minutes approved" email queued from a live meeting reaches nobody~~ — CLOSED

**Closed 2026-09-20.** `approveMinutesForPassedMotion` built its payload by
hand — `{minutes_document_id, meeting_id, approved_by_motion_id}` — and
`getSubscribersForEvent` returns `[]` without `board_id`, so the notification a
board raised by voting its own minutes through reached nobody.

It now uses `minutesApprovedPayload`, the same helper `submitForReview`,
`approve` and `publish` use, adding `approved_by_motion_id` on top as this
path's own fact. That fixes the recipients AND the message: the helper also
carries the town name, board name, meeting date and URL the email template
renders, none of which the hand-built payload had. A null context now throws
rather than queueing an event nobody can be found for.

**Pinned by** `vote-record.test.ts`'s minutes-approval case, which no longer
stops at the row: it asserts `payload.board_id`, then calls
`getBoardSubscribers` — the lookup the pipeline actually performs — and
requires at least one deliverable subscriber. Asserting the payload's shape
alone is exactly what let this survive. Mutation-checked: stripping `board_id`
turns it red with "the subscriber lookup returns []".

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

## 16. ~~Rules 12 and 13 guard a table nothing writes~~ — CLOSED

**Closed 2026-09-20** by decision, not by code: `minutes_document.content_json`
is today's shape, and `minutes_section` is a deferred design whose
authorization is already settled — R1, board-scoped, as the corpus policies had
it. The two guards stay. The table stays.

**What changed is that the enforcement is no longer incidental.**
`packages/api/src/trpc/__tests__/minutes-section-rules.test.ts` fails in both
directions:

- a production writer to `minutes_section` appears that does not reference the
  guards — the case that would otherwise ship unguarded, since "nothing writes
  the table" is a fact about today only;
- either guard is deleted from `rules.ts` as dead code, taking with it the only
  record that R1 governs sections.

Both were proven by mutation: an unguarded writer fails the first test, a writer
that calls a guard passes, and deleting a guard fails the second. `rules.ts`
carries the decision above the guards so the next reader finds it there.

**If the sectioned editor is ever built:** wire both guards with the board
derived from the section's `minutes_document`, and update that test's
expectation deliberately.

---

## 17. ~~`minutesDocument.byMeeting` returns a draft document's id and status with no R4 check~~ — CLOSED

**Closed 2026-09-20.** `byMeeting` now joins `meeting` for the board and routes
its row through `canSelectMinutesDocument` (rule 9), the same rule `detail` and
`pendingByTown` already applied. `m.board_id` is read for the rule and not
returned, as in `detail`.

**It answers `null`, not a refusal** — the list-shaped form rule 9 anticipates.
`byMeeting` is how `meetings.$meetingId.tsx` and `meetings.$meetingId.review.tsx`
decide which minutes affordance to render, and both already treat `null` as
"nothing to show" (`minutes?.status`, `hasMinutes = !!minutesDoc`). A throw
would turn an ordinary screen into an error for a caller who simply may not see
a draft yet; the caller that wants the document itself still gets the refusal,
from `detail`.

**Pinned by** two cases in `trpc/routers/__tests__/minutes-document.test.ts`: a
caller with no R4 gets `null` for a `draft` and the row once it is `approved`
(rule 9's adopted branch needs no R4), and a caller holding R4 for the board
gets the draft. Mutation-checked — removing the rule-9 call turns the first
test red (`expected { …(2) } to be null`).

---

## 18. ~~Rule 18's self branch has no caller — a person cannot read their own notification deliveries~~ — CLOSED

**Closed 2026-09-20.** Owner decision: the self branch stays. A person-facing
delivery history is a plausible feature whose authorization is already settled;
deleting the branch would mean deciding residents never get one, which nobody
has decided.

**Closing it found something this entry had not.**
`NotificationService.getSubscriberDeliveryHistory(personId)` already existed,
read **any** person's deliveries by id, applied no rule, and had no caller — an
unguarded reader waiting for a route. It now takes the actor and calls
`assertCanSelectNotificationDelivery` itself, so the rule is enforced at the
read rather than trusted to whoever wires it later. That is the self branch's
first real caller, and three tests in
`services/__tests__/notification-service.test.ts` pin it: own history served,
another person's refused without C2, allowed with C2.

**And the absence is now mechanical.**
`trpc/__tests__/notification-delivery-rules.test.ts` fails if a production file
reads `notification_delivery` without either the `notificationAdmin` preHandler
or rule 18, and fails if the self branch disappears from the rule. Its header
names the two reads it cannot distinguish (`getDeliverySummary`, C2-gated by its
only caller; `processRetries`, the background sender with no actor).

Mutation-checked: stripping the guard from the service method turns a named test
red, and deleting the self branch turns the tripwire red.

---

## 19. ~~Rule 19's C2 branch has no caller — C2 cannot read anyone's notification preferences~~ — CLOSED

**Closed 2026-09-20** by removing the branch. Owner decision: notification
preferences are **self-service only**.

The deleted policy `subscriber_pref_select` admitted
`person_id = get_current_person_id() OR has_permission('C2')`, but nothing ever
called the C2 half — no screen shows an administrator who has opted out of what.
A person's communication choices are theirs, and an administrator-facing view is
a privacy decision to take deliberately, with a rule written for it then, rather
than a permission inherited from a policy no surface used.

`canSelectSubscriberPreference` now returns true only for the row's owner, and
its refusal message says there is no administrator override. `permission.test.ts`
case 19 was rewritten to assert the narrowing: a C2 holder is refused another
person's preferences, and still reads their own. Mutation-checked — restoring
the C2 branch turns that case red.

`notification-preference.ts`'s `mine` still enforces self-access by construction
(no `personId` input), which is stronger than a runtime check; these rule
functions exist for a future reader that takes rows it did not scope itself.

---

## 20. ~~Stage 1's "feature parity on CI" criterion has no baseline and no test~~ — CLOSED

**Closed 2026-09-20 by restating the criterion**, per the owner. As written it
could never be met: it asked CI to demonstrate parity with a predecessor, and
the web client was already inert before Phase E — no credential reached
PostgREST, `get_current_town_id()` could not resolve, every read returned zero
rows. `2026-08-29-phase-e-web-restoration-design.md:25` states there is no
parity baseline. Phase E was a restoration, not a migration.

**The criterion now reads:** CI is green on typecheck, lint, format:check,
build, the dev bootstrap and the full test suite, with the tenant-isolation and
route-access gates among them. It is ticked in
`docs/superpowers/plans/2026-08-26-stage-1-platform.md` against that wording,
and `phase-f-stage-1-gate.md` § 8 carries the evidence and the reasoning —
including what the restatement deliberately does not claim.

**Stage 1's exit criteria are now 8 of 8.**

**This does not mean the product is verified end to end.** A green unit and
integration suite is not a functional guarantee — Phase E wave 5 shipped 1725
passing tests over a live screen that rendered blank in a browser. That work is
entry 22.

---

## 21. ~~`serving-surface.test.ts` no longer pins the group half of nginx's read access to API-written files~~ — CLOSED

**Closed 2026-09-20.** The property still cannot be pinned — it belongs to a
deployment, and no artefact in the repository starts the API process — so
instead of pretending otherwise, the requirement is now attached to the moment
someone builds one.

**`packages/api/src/storage/__tests__/deployment-group-pin.test.ts`** passes
vacuously today and fails as soon as a file that starts the API (a compose
file, a systemd unit, a Procfile, a Dockerfile) appears without encoding how
the API process shares nginx's group. Its failure message carries what the
deleted compose file knew: the mechanism (`user: "${TMM_ASSET_UID:-0}:${TMM_ASSET_GID:-101}"`,
101 being the `nginx` uid/gid in `nginx:*-alpine`), the reason
(`storage/store.ts` writes group-readable; nginx's workers are a different
user), and the symptom of skipping it (403 on every document and seal, with the
application's logs clean). A second test fails if `store.ts`'s paragraph
stating the requirement is tidied away.

**It found something on its first run.** `packages/api/Dockerfile` — kept by
Phase F as inert, and the most likely seed of a future deployment — ran the API
as root and said nothing about groups. It now carries the requirement in a
header addressed to whoever deploys from it.

Mutation-checked in both directions: a silent systemd unit fails the first
test, the same unit with `SupplementaryGroups=nginx` passes, and removing
`store.ts`'s paragraph fails the second.

**What is still owed to Stage 2:** an actual deployment that grants the access,
and a structural assertion against whatever artefact encodes it. This entry
guarantees the question gets asked; it does not answer it.

---

## 22. No end-to-end suite runs in CI, and the four specs that exist are stale

**Where:** `playwright.config.ts`, `e2e/fixtures.ts`, `e2e/*.spec.ts` (420 lines
across `smoke`, `onboarding`, `member-management`, `meeting-lifecycle`), and
`.github/workflows/ci.yml`.

**What the gap is:** nothing exercises the running product in a browser on any
automated path. `pnpm test:e2e` exists and CI never calls it. This is the
substitute that entry 20's restatement explicitly does not provide, and the
reason it matters is on the record: Phase E wave 5 had 1725 green tests and a
live meeting screen that rendered blank, an SSE resume that lost every write in
a quiet gap, and a 404 on every page load — three defects that only ~20 minutes
in a real browser found.

**The four specs cannot pass as they stand.** Measured 2026-09-20:

1. `e2e/fixtures.ts:30` logs in with `TestPassword123!`; the dev bootstrap
   (`scripts/dev/reset-local-db.sh`) creates logins with `TownMeeting!Dev1`.
2. `e2e/fixtures.ts:62-63` names `boardId: "bbbb0001-0000-0000-0000-000000000000"`
   and `adminUserId: "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"`; the seed has
   `bbbb1111-bbbb-4bbb-8bbb-…` / `bbbb2222-…` and
   `aaaa1111-aaaa-4aaa-8aaa-…` (note the UUID version and variant nibbles).
3. `playwright.config.ts:34` starts only `@town-meeting/web`; nothing serves the
   API, so any spec that reads data fails regardless of the first two.

Whether the specs' assertions still describe the current screens is unknown —
they were last touched before Phase E's later waves rewrote those screens.

**Why it was not closed with entry 20:** repairing fixtures, standing up two
servers and a seeded database in CI, and re-deriving 420 lines of assertions
against screens that changed is a body of work, not a restatement. It also
slows every CI run, which is a trade to make deliberately.

**Retirement condition:** CI runs at least the smoke spec against a
bootstrap-seeded database with both servers up, green, on every pull request —
and the specs it runs assert something a developer would notice breaking.

**Verification command:**

```
grep -n "e2e\|playwright" .github/workflows/ci.yml   # currently no hit
grep -n "TEST_PASSWORD\|boardId:\|adminUserId:" e2e/fixtures.ts
grep -n "DEV_PASSWORD" scripts/dev/reset-local-db.sh
grep -n "aaaa1111\|bbbb1111\|bbbb2222" packages/api/drizzle/seed/seed.sql
```

---
