# Phase E, Wave 3 — Meetings, and the Board-Scoped Authorization Debt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the meetings list, the kanban, the meeting detail shell and the board's Meetings tab — and in doing so give `requireBoardPermission` its first real call sites.

**Architecture:** `docs/superpowers/plans/phase-e-conventions.md` is the specification for _how_; this plan says _what_. Where they disagree, the conventions win and this plan is wrong — say so rather than following it.

## Why this wave is different

Unit 0 and waves 1–2 touched **only Actor-only rules**. `requirePermission`, `requireBoardPermission` and `BoardScope` have had **zero real call sites** for three waves, exercised only by `board-scope.test.ts`'s synthetic router.

That ends here. `assertCanInsertMeeting` and `assertCanUpdateMeeting` both take a `BoardScope` and check **A1**. This is the half of the authorization layer that:

- Phase D built and mutation-tested, and where a review found `BOARD_SCOPED_CODES` was hand-written so `requirePermission("A2")` silently performed a **global** check.
- Wave 1 had to fix twice, because a guard declared after `.input()` is preempted by input parsing.
- Required changing `requirePermission` to read `getRawInput()`, because a middleware declared **before** `.input()` sees `opts.input === undefined` — so the board id comes from **unvalidated** input.

**Expect to amend conventions item 2.** Its board-scoped half has been transcribed and tested but never used in anger. Wave 1's equivalent moment found the ordering defect that took two fix rounds. Report what item 2 gets right and what it does not.

## Global Constraints

- **Read `phase-e-conventions.md` in full first.** Items 2, 3, 7, 8, 11, 13 and 14 were amended across both prior waves, several more than once.
- **Authorization is declared before `.input()`.** Every mutation carries a **deletion test and a reorder pin**. A refusal test asserts **`FORBIDDEN`** — one asserting `BAD_REQUEST` survives guard deletion while proving nothing.
- **Do not `.transform()` a value a guard authorizes on.** With `getRawInput()`, a board-scoped guard authorizes the **pre-validation** board id while the resolver acts on the post-validation one. Identical today; a transform would make them differ, authorizing one board and acting on another.
- **An FK from client input needs a tenant-scoped existence check.** Meeting writes carry a client-supplied `board_id`. This defect has been reproduced **four** times; every unguarded cross-tenant write succeeded silently. `assertBoardExists` is exported from `board.ts`.
- **No redundant `WHERE town_id` alongside RLS** — it makes the tenancy test vacuous. Do scope what RLS does not enforce.
- Both mechanised checks now run: `cache-key-parity.test.ts` (invalidation half) and `pathfilter-pin-coverage.test.ts` (pin half). Neither catches a _per-mutation_ miss inside a file that has other pins — item 14's deletion sweep is the backstop.
- Gates are `.github/workflows/ci.yml`'s list. `npx turbo run build --force` first; tests as `npx turbo run test --force` (anything but `0 cached` proves nothing); then `typecheck --force` and `pnpm format:check`. **Bare `npx tsc` resolves to the wrong package — always go through turbo.** A green vitest run is not a typecheck.
- `DATABASE_URL="postgres://ben@localhost:5432/postgres"`. Unique scratch DBs, dropped; leave `tmm_app`.

---

## Measured scope

At `1944dfb`:

| File                                          | Refs | Writes |
| --------------------------------------------- | ---- | ------ |
| `routes/meetings.$meetingId.tsx`              | 9    | 0      |
| `components/meetings/CreateMeetingDialog.tsx` | 6    | 1      |
| `routes/boards.$boardId.meetings.tsx`         | 5    | 0      |
| `routes/meetings.tsx`                         | 4    | 2      |
| `components/meetings/CancelMeetingDialog.tsx` | 3    | 1      |

**Out of scope, and verify before assuming:** the agenda surface (`meetings.$meetingId.agenda.tsx`, `AgendaSection`, `InlineItemForm`, `PublishAgendaDialog`, `ExhibitUploader`) is **wave 4**; `live.tsx` and the SSE transport are **wave 5**; `minutes.tsx` and `review.tsx` are **wave 6**. `home.tsx` imports `CreateMeetingDialog` and was partly migrated in wave 1 — it is in scope only insofar as that dialog's props change.

---

## Task 0: Wave 2's parked items

**Files:** `docs/superpowers/plans/phase-e-conventions.md`, plus two markers.

Three small things, committed separately from the router work.

1. **Record the pin check's known limit.** `pathfilter-pin-coverage.test.ts` credits a writer if a test file imports it _and_ contains `isInvalidated` anywhere — so a writer imported alongside a different, genuinely-pinned writer passes without being pinned itself. A reviewer built a fixture proving it. Zero effect at HEAD; item 14's deletion sweep is the backstop. Say so in the check's own header and in item 8.

2. **Give `CreateMeetingDialog.tsx` and `routes/templates.tsx` their markers.** Both still read `agenda_template` through raw Supabase with **no** `TODO(phase-e-wave-N)` token, so item 11's sweep reads them as done. Wave 2 judged them correctly as _not_ an authorization gap — `agendaTemplate.list`/`.detail` are plain `protectedProcedure`, so there is no delta versus the raw read — but a completeness gap is still a gap. Note `CreateMeetingDialog` is in **this** wave's file list, so its marker may be discharged rather than added; decide and say which.

3. **Run item 14's close-out step now, not at the end** — re-check every Known-gaps bullet against HEAD and retire what wave 2 closed. Wave 2 shipped five stale bullets because tasks only ever amended what their own work touched.

---

## Task 1: The meeting router

**Files:** new `packages/api/src/trpc/routers/meeting.ts`, its tests, `router-wiring.test.ts`.

Reads for the three routes: a town-wide list (the kanban groups by status), a board-scoped list, and one meeting's detail. Writes: create and cancel.

**The writes are the point of this wave.** `assertCanInsertMeeting(actor, scope)` and `assertCanUpdateMeeting(actor, scope)` take a `BoardScope` and check **A1**. Use `.use(requireBoardPermission("A1", boardIdFrom())).input(...)` — middleware, declared **before** `.input()`.

Read `packages/api/src/trpc/__tests__/board-scope.test.ts` first. It is the only existing exercise of this path and its four procedures were repositioned to guard-first in wave 1 precisely so they could be copied.

Four things to prove, each by mutation:

- A caller **with** A1 on that board succeeds; **without** it is refused `FORBIDDEN`.
- A caller with a **revoking board override** for A1 on that board is refused, and still allowed on another board. This is the case the whole board-scoped mechanism exists for, and it has never been exercised by a real procedure.
- Moving the `.use()` after `.input()` turns a reorder pin red.
- Removing `assertBoardExists` lets a cross-tenant write succeed — reproduce it, then confirm the guard refuses.

**Do not** reach for `requireActor` here; that is the Actor-only shape. **Do not** add a `.transform()` to `boardId`.

---

## Task 2: The meetings list and kanban

**Files:** `routes/meetings.tsx`, `routes/boards.$boardId.meetings.tsx`, `components/meetings/CreateMeetingDialog.tsx`, `components/meetings/CancelMeetingDialog.tsx`.

Both dialogs are shared — `CreateMeetingDialog` by `meetings.tsx`, `boards.$boardId.meetings.tsx` and `home.tsx`; `CancelMeetingDialog` by the board tab. A read abandoned in one route affects every writer of that key across all three, and `home.tsx` is already migrated.

`CreateMeetingDialog` also reads `agenda_template` raw — see Task 0.

Every migrated read's writers get their `pathFilter()` **and their pin**, in this commit. Both mechanised checks will catch a missing invalidation; neither catches a missing pin inside a file that has others.

---

## Task 3: The meeting detail shell

**Files:** `routes/meetings.$meetingId.tsx`.

Nine reads, no writes. This is the shell the agenda, live, minutes and review tabs mount inside — wave 4, 5 and 6 all build on whatever it exposes, so its `board_id` must reach them: every board-scoped guard downstream needs it.

Audit the columns against **every child it hands data to**, not just its own JSX. Unit 0 shipped a regression exactly there.

---

## Task 4: Close-out

- Run item 11's greps and record the numbers, timestamped with this wave's SHA.
- Discharge or re-label every marker this wave closes. `home.tsx`'s wave-2 marker names `meeting.byTown` — if Task 1 ships it, close it.
- **Report what item 2's board-scoped half got right and what it did not.** This is the deliverable waves 4–6 inherit, and it is the first evidence anyone has about that half.

---

## Self-review notes

- **Scope measured, not inherited.** `boards.$boardId.meetings.tsx` was in no prior measurement; it is the board's Meetings tab and owns `CancelMeetingDialog`.
- **The debt discharges here.** After this wave `requireBoardPermission` has real call sites for the first time. If item 2's board-scoped guidance is wrong, this is where it shows — which is why Task 1 comes before any screen.
- **The `.transform()` hazard is live for the first time**, because this is the first wave whose guard reads a value out of unvalidated input.
