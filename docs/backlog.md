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

## 4. The minutes editor's source panel downloads every seat's live invitation token to resolve names

**Where:** `packages/web/src/components/minutes/SourceDataPanel.tsx` (the
`boardMember.roster` read and its `memberNames` map) and
`packages/api/src/trpc/routers/board-member.ts` (`roster`'s `SELECT`, which
returns `invitation_token` per seat).

**What the gap is:** `boardMember.roster` is the only procedure that maps a
`board_member_id`/mover/seconder id to a person's name, and its row shape
includes each seat's most recent invitation id, token and status —
`activeCountForBoard`'s own doc comment in the same file states the trade
explicitly: "Sending a board's live invitation tokens to every user who opens
that dialog, to count rows the server can count, is not a trade worth making
to avoid a nine-line procedure." `SourceDataPanel` needs names, not a count,
but it pays the same price: every clerk who opens the minutes editor now
receives every board seat's live invitation token in the `roster` response,
to read `.name` off it.

**Why it wasn't closed in Phase E:** this widens an EXISTING pattern rather
than opening a new hole — `meetings.$meetingId.live.tsx` already fetches
`boardMember.roster` for the identical reason (`VotePanel`'s
board-member-id-to-name mapping), so wave 6 Task 3 is the second screen to
make this trade, not the first. Closing it means adding a narrower procedure
(`boardMember.namesForBoard`, returning `id`/`name` only) and moving both
callers onto it — a real fix, but a new procedure plus two call-site
migrations is out of scope for a task whose brief was "wire the six writes
Task 1 already built," and no Phase E wave task owns a token-minimization pass
across the app.

**Verification command:**

```
grep -n "invitation_token" packages/api/src/trpc/routers/board-member.ts
grep -rln "boardMember.roster" packages/web/src/routes/meetings.\$meetingId.live.tsx packages/web/src/components/minutes/SourceDataPanel.tsx
```

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

**Widened by wave 6, Task 5 (`43c2963`): the set is now FOURTEEN namespaces, and `meetings` is one of
them.** That task removed the last legacy reader of `meetings`, `boards`, `persons` and `minutes` —
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
invalidation lines for all fourteen namespaces, delete the matching `MIGRATED` entries in
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
