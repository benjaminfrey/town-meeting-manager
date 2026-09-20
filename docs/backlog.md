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

## 6. ~~The web client never normalises a code-keyed permissions matrix~~ — CLOSED

**Closed 2026-09-20.** `fetchCurrentUser` now runs `normalisePermissionsMatrix`
on the matrix `GET /api/me` returns — the one boundary a matrix crosses into
the browser, so every consumer (`usePermission`, `PermissionGate`, and every
screen calling `hasPermission`) is fixed at once and a new screen cannot
reintroduce the gap by forgetting a step.

`hasPermission`'s own comment had said what would happen: "It takes an
ALREADY-NORMALISED matrix … or half the accounts in the system silently resolve
to no permissions at all." The server obeyed it; the client was the half that
did not, so a code-keyed account — the Deputy Clerk row the seed writes — had
every permission-gated button hidden for writes the server would have allowed.

**Pinned by** `lib/__tests__/current-user.test.ts`: a code-keyed matrix
resolves (and a code it does NOT carry still does not), a name-keyed one still
resolves, `board_overrides` are normalised too and stay board-scoped, and a
missing matrix stays `null` rather than becoming an empty object.
Mutation-checked — removing the normalisation turns the code-keyed and
override cases red.

**Sibling sweep, since this class of gap repeats:** every other `hasPermission`
caller in the client reads the current user's matrix, now normalised.
`PermissionMatrixEditor` builds its matrix locally from templates for NEW
accounts and never reads a stored row, so it was not affected.

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

## 11. ~~Two live defects in generated legal minutes, assigned to Phase E wave 6 and never decided~~ — CLOSED

**Closed 2026-09-20** on branch `fix-backlog-11-minutes-legal-record`, deciding
both questions this entry left open.

**Defect A — the record named the wrong adjourner. Decision: fix the READ, not
the write.** `performAdjournment` (`packages/api/src/trpc/routers/meeting.ts`)
still writes `adjournment.adjourned_by` as a `person.id`, unchanged.
`minutes-assembler.ts`'s `buildAdjournment` used to look that value up with
`memberName`, a `board_member.id` map — the wrong map for a `person.id` — so it
always resolved to `null`, and `minutes-formatters.ts`'s
`formatAdjournmentText` silently substituted `attendance.presiding_officer`.
The fix reads it with `personName` instead, the `person.id` map the assembler
already builds. Two reasons the write stays exactly as it was, recorded in the
code comment at both ends (`meeting.ts`'s `adjourn` doc comment and
`minutes-assembler.ts`'s `buildAdjournment`): every existing row already holds
a `person.id`, so historical records become correct with no data migration;
and a clerk who adjourns may have no `board_member` row at all on that board —
precisely the case that produced the wrong name — so a `board_member.id` could
never have represented them, even in principle. The presiding-officer fallback
in `formatAdjournmentText` is unchanged and still applies when `adjourned_by`
is genuinely absent. `adjourned_by_name` remains written and read by nothing;
left as-is, noted in a comment.

`meeting.test.ts`'s existing assertion (`adjournment` matching
`adjourned_by: operator.personId`) needed no change — it was pinning a shape
that was always correct; only the reader was wrong. Its comment now says so.

**Pinned by** `packages/api/src/services/__tests__/minutes-generation.test.ts`,
describe block `assembleMinutesJson > adjournment`: "names the actual
adjourner, not the presiding officer, when a non-board-member clerk adjourns"
(the failing case — chair presides, a clerk with no `board_member` row
adjourns, and the generated text must name the clerk) and "falls back to the
presiding officer when adjourned_by is absent (old rows predating the field)".
Mutation-checked: reverting `personName` back to `memberName` in
`buildAdjournment` turns the first test red with `expected null to be 'Pat
Reyes'`, confirming the read was the entire defect.

**Defect B — the DRAFT watermark was never removed. Decision: a
document-keyed render route, board derived from the document's own meeting,
failures surfaced.** `packages/api/src/routes/minutes.ts` gains
`POST /api/minutes/:documentId/render`, beside the existing
`POST /api/meetings/:meetingId/minutes/render` (kept, unchanged, still used by
other callers). The new route looks up the `minutes_document` row directly by
id, loads its OWN meeting (not any "current" or live meeting), and guards with
the same `assertCanUpdateMinutesDocument` (R1) the sibling route uses, so the
two cannot drift on who may re-render — the same shape
`board-derivation.ts`'s `resolveMinutesDocumentScope` embodies, decomposed
into queries the route already makes. `VotePanel.tsx` now posts
`data.minutesApproved` (the approved document's own id, already returned by
`voteRecord.recordForMotion`) to the new route, only when it is non-null, and
a failure is surfaced with `toast.error(...)` instead of swallowed by
`.catch(() => {})` — a failure here means a legal record keeps a DRAFT
watermark, which the clerk needs to know.

**Pinned by** `packages/api/src/routes/__tests__/minutes-render-by-document.test.ts`
(four cases against a real Fastify instance, real Better Auth session, real
database: re-renders board A's document while an unrelated board-B meeting
exists; derives authorization from the DOCUMENT's own board via a
board-specific override rather than a global grant; refuses a caller holding
R1 nowhere; 404s for a document id from another town) and by
`packages/web/src/components/meeting/__tests__/VotePanel.test.tsx` (posts
`data.minutesApproved`, not `meetingId`; surfaces a toast on failure rather
than swallowing it). Mutation-checked: replacing `meeting.board_id` with a
fresh random uuid in the new route's guard turns the board-derivation test
red (200 becomes 403); reverting `VotePanel`'s target back to the
meeting-keyed URL and re-swallowing the error turns both of its named tests
red.

**Fix round 1 correction — a sweep for claims the fix left stale.** The
authoritative doc comment for defect B
(`minutes-document.ts`'s `approveMinutesForPassedMotion`) still said "its
target is wrong today", "reproduced rather than repaired", and pointed at
`VotePanel.tsx` as "still issu[ing] exactly the call the browser issued
before" — all false once the fix above landed. Rewritten in past tense,
keeping the history. Two other comments
(`meetings.$meetingId.live.tsx`, `meetings.$meetingId.review.tsx`) still
described the `adjourned_by` misattribution as live; corrected the same
way. Also corrected the route test's "a document id from another town"
case, which used a random nonexistent uuid — that pins unknown-id → 404,
not cross-tenant isolation. It now seeds a genuinely separate town (a
second town/board/meeting/document inserted directly, following
`db/__tests__/tenant-isolation.test.ts`'s own pattern for cross-tenant
fixtures) and keeps the nonexistent-id case as its own, correctly named
test.

**Fix round 2 — owner decision on the motion path, found by review.**
Defect A's read-side fix (above) made `adjourned_by` resolve correctly for
the first time — which surfaced a THIRD fact, invisible until then: on the
path where a motion carries the adjournment (as opposed to "without
objection"), `voteRecord.recordForMotion` passes `ctx.tenant.personId` —
whoever happened to be recording the vote — as `adjourned_by`. Before the
fix that value silently resolved to `null` and fell back to the presiding
officer; after the fix it resolved correctly, so adopted-by-motion minutes
started reading **"<the clerk> declared the meeting adjourned"** instead of
naming the chair. That is a live change to what a legal record says, and
the owner decided it, not the tool: **the body adjourned itself by
carrying a motion; no individual declared it**, so the sentence should name
nobody. `minutes-formatters.ts`'s `formatAdjournmentText` now renders the
motion path impersonally — `"The meeting adjourned at TIME."` — and
computes `officer` only inside the `without_objection` branch, which is
unchanged and still names the real adjourner (the clerk-adjourns case
defect A was about). The motion block immediately following already names
the mover and seconder, so the attribution is not lost, only moved to
where it is actually true. **Already-generated PDFs are not re-rendered by
this change** — it takes effect on the next render of each document, same
as every other formatter change.

Pinned by two tests in `minutes-generation.test.ts`, beside the defect-A
cases: an assembler-to-formatter pipeline test (the clerk recorded the
vote, the chair presided, the rendered text names neither, and the motion
block still names mover and seconder) and a formatter-unit test updated to
the new wording. Example rendered sentence:
`"The meeting adjourned at 4:45 PM. Smith moved Move to adjourn.. Davis
seconded. Passed unanimously."` Mutation-checked: reintroducing `${officer}`
into the motion-path sentence turns both named tests red; restored, all 61
tests in the file pass.

**Verification commands:**

```
grep -n "personName(adjData" packages/api/src/services/minutes-assembler.ts
grep -n "minutes/:documentId/render" packages/api/src/routes/minutes.ts
grep -n "api/minutes/\${data.minutesApproved}" packages/web/src/components/meeting/VotePanel.tsx
grep -n "The meeting adjourned" packages/api/src/services/minutes-formatters.ts
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

## 22. ~~No end-to-end suite runs in CI, and the four specs that exist are stale~~ — CLOSED

**Closed 2026-09-20.** CI now runs a real Chromium browser against a real
bootstrap-seeded Postgres database on every pull request, in a new `e2e` job
(`.github/workflows/ci.yml`) that runs in parallel with `verify` rather than
after it, so it does not slow that job's feedback. It brings up its own
`postgres:17` service (mirroring `verify`'s, plus
`POSTGRES_HOST_AUTH_METHOD=trust` — see the job's own comment for why the
non-owner bootstrap needs that and `verify` doesn't), installs deps, builds,
runs `scripts/dev/reset-local-db.sh`, installs Playwright's Chromium build,
runs `pnpm test:e2e:ci` (`playwright test --project=chromium` —
`playwright.config.ts`'s `projects` still lists firefox/webkit for local use,
per the owner decision that CI is Chromium-only), and uploads the HTML report
as an artifact on failure.

**The three measured breaks are fixed, all in `e2e/fixtures.ts`:**

1. The password now reads `process.env.DEV_PASSWORD ?? "TownMeeting!Dev1"`,
   matching the bootstrap.
2. `seededTown` now points at real seed rows:
   `boardId: "bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb"` (Select Board — the
   governing board, and the one the seed's meeting belongs to) and
   `adminUserId: "aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"`.
3. `playwright.config.ts`'s `webServer` is now an array: `@town-meeting/api`
   (via `tsx src/index.ts`, `DATABASE_URL` required and validated at config
   load — see its top-of-file comment for the local-loop invocation) plus
   `@town-meeting/web`. The API runs against the runtime URL
   `scripts/dev/reset-local-db.sh` prints — the non-owner `tmm_app` role via
   `options=-c role=tmm_app` — never the owner connection.

Fixing these also surfaced one bug in `e2e/fixtures.ts` itself, not listed in
the original three: `seededTown`'s fixture function took `(_fixtures, use)`,
which Playwright rejects outright (`First argument must use the object
destructuring pattern`) — this file had never actually been run by anything
before this entry, so nothing had caught it. Now `({}, use)`.

**The smoke spec was rewritten** (requirement 4): it no longer asserts
`hasLogin || hasHeading`, which is true on any page with any heading and
could not fail. It now asserts, against `packages/web/src/routes/login.tsx`'s
real markup: the "Email" and "Password" labeled fields and the "Sign in"
button render, and a wrong password against the real seeded admin renders
`describeAuthError`'s "Invalid email or password" text rather than doing
nothing or redirecting.

**A new spec, `e2e/dashboard-data.spec.ts`, proves data reaches the browser**
(requirement 5): it signs in as the seeded admin and asserts the page renders
an `<h1>` reading "Newcastle" — `routes/home.tsx`'s town-name header, sourced
from `trpc.town.detail` through the tenant-scoped `tmm_app` role. This is the
shape of assertion that would have caught wave 5's blank live-meeting screen.

**Local result** (`./scripts/dev/reset-local-db.sh tmm_e2e` then
`DATABASE_URL=<runtime URL> pnpm test:e2e:ci`): `5 skipped / 4 passed (8.5s)`.

**What did not survive — quarantined, not rewritten**, because their failures
turned out to be real screen changes since these specs were last touched, not
typos to fix (`test.skip` / `test.describe.skip`, each with the measured
reason inline):

- `e2e/onboarding.spec.ts`'s full-wizard test — the sign-up link text is
  "Create one", not something matching `/sign up|register|create account/i`,
  so it always falls through to a sign-in with the seed admin (who is already
  onboarded, so there is no wizard to walk with the only real account this
  suite has).
- Both `e2e/member-management.spec.ts` tests — the board detail page is now a
  tabbed layout (Overview/Members/Meetings/Templates/Settings) defaulting to
  Overview; "member roster" as text does not appear anywhere in the DOM until
  the Members tab is selected, which the spec never does.
- Both `e2e/meeting-lifecycle.spec.ts` tests — the Kanban board
  (`routes/meetings.tsx`) renders each meeting as a `<button>` driven by an
  action object, not an `<a href="/meetings/...">`; the spec's own
  `a[href*='/meetings/']` locator matches nothing, so both tests have been
  silently self-skipping via their own `test.skip()` bailout since that
  rewrite — the same cannot-fail shape this entry closed in the smoke spec,
  just not CI-visible until now.

These three specs' staleness is tracked as entry 23, its own follow-up rather
than folded back into this one, since fixing them for real means driving the
current screens (a tab click, a button, a real sign-up flow), not a fixture
repair.

**Verification command:**

```
grep -n "e2e:" .github/workflows/ci.yml
DATABASE_URL="postgres://$USER@localhost:5432/postgres" pnpm exec turbo run test --force   # Tasks: 5 successful, 5 total
```

---

## 23. Three e2e specs are stale against redesigned screens and are quarantined

**Where:** `e2e/onboarding.spec.ts` (one test), `e2e/member-management.spec.ts`
(both tests), `e2e/meeting-lifecycle.spec.ts` (both tests).

**What the gap is:** entry 22 wired CI to a real browser and a real seeded
database, fixed the three measured fixture/config breaks, and rewrote the
one spec whose assertion could never fail. It deliberately did not repair
these five tests' own assertions, because their failures turned out to be
real screens changed out from under them, not typos:

1. `onboarding.spec.ts`'s full-wizard test looks for a sign-up link matching
   `/sign up|register|create account/i`; `login.tsx`'s actual link text is
   "Create one". It always falls through to signing in with the seed admin,
   who already has a town, so there is no wizard left to walk with the only
   real account this suite has. A real fix needs an actual fresh-signup path
   exercised end to end, not a regex tweak.
2. `member-management.spec.ts` asserts `getByText(/member roster/i)` is
   visible right after opening a board detail page. That page is now a
   tabbed layout (Overview/Members/Meetings/Templates/Settings, default
   Overview); no "member roster" text exists anywhere in the DOM until the
   Members tab is explicitly selected. Confirmed in a real browser against
   `/boards/bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb` as the seeded admin.
3. `meeting-lifecycle.spec.ts` locates meetings via
   `page.locator("a[href*='/meetings/']")`. The Kanban board
   (`routes/meetings.tsx`) renders each meeting as a `<button>` with an
   onClick handler built from an action object that merely has an `href`
   _field_ — never spread onto a real anchor. The locator matches zero
   elements, so both tests trip their own `test.skip()` bailout on every
   run and have asserted nothing since that rewrite.

**Why this is its own entry:** re-deriving these assertions against the
current UI (driving a tab click, a button instead of a link, a genuine
sign-up flow with a fresh, unseeded account) is new spec-writing, not a
fixture repair — entry 22's scope was standing up CI's browser + database
path and fixing what was measurably broken about doing that. Both are now
`test.skip`/`test.describe.skip` with the reasoning above inline, so CI
does not silently under-report what it covers.

**Retirement condition:** each spec is rewritten against the actual current
screen (tab navigation for member management, the Kanban button for meeting
lifecycle, a real unseeded sign-up for onboarding) and the `test.skip` is
lifted, or the spec is deleted with a note explaining why the assertion no
longer has a reason to exist.

**Verification command:**

```
grep -n "test.skip\|test.describe.skip" e2e/onboarding.spec.ts e2e/member-management.spec.ts e2e/meeting-lifecycle.spec.ts
```

---

## 24. Inline motion text doubles a period when the motion already ends with one

**Where:** `packages/api/src/services/minutes-formatters.ts`'s `formatMotionInline`
(`let text = \`${mover} moved ${motion.text}\``, then `text += ". "` for the
seconder, the vote result and the final period).

**What the gap is:** the formatter appends its own punctuation to
`motion.text` without checking whether that text already ends with one. A
motion stored as "Move to adjourn." renders as:

> Smith moved Move to adjourn.. Davis seconded. Passed unanimously.

Two defects in one sentence, both in a document a town files as its legal
record: the doubled period, and "moved Move to adjourn", where the stored
text's leading capital reads as a sentence rather than a clause. Neither
affects meaning, and neither is caught by any test — the generation suite
asserts that names and phrases APPEAR, not that the sentence reads correctly.

Pre-existing and unrelated to entry 11's two fixes: `formatMotionInline` is
byte-identical to what it was before them. Found while reviewing the
motion-path attribution change, in an example rendered by the new test.

**Why it is not fixed here:** trimming a trailing period is a one-line change,
but deciding what the sentence should read — whether motion text is a clause
("moved to adjourn") or a sentence quoted verbatim, and whether existing
stored text should be normalised — is an editorial decision about the record's
voice, and `block_format` renders the same text differently again.

**Retirement condition:** `formatMotionInline` and `formatMotionBlock` produce
one sentence-final period regardless of how `motion.text` was stored, pinned by
a test that asserts the rendered STRING rather than the presence of substrings.

**Verification command:**

```
grep -n "moved \${motion.text}" packages/api/src/services/minutes-formatters.ts
grep -rn "moved Move to adjourn" packages/api/src/services/__tests__/
```
