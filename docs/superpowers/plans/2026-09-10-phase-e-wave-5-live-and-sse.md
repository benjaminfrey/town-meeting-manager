# Phase E, Wave 5 — The Live Meeting, and the SSE Transport

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the live-meeting screen onto tRPC, replace Supabase Realtime with tRPC SSE subscriptions, and close the authorization gaps that surface when the last unguarded writes in the product move server-side.

**Architecture:** `docs/superpowers/plans/phase-e-conventions.md` is the specification for _how_; this plan says _what_. Where they disagree, the conventions win and this plan is wrong — say so rather than following it.

## Why this wave is the hard one

The phase spec singles it out: the heaviest migration and a new transport, in the screen a clerk runs a live public meeting on. Three things make it worse than that sounds.

**1. There is a multi-writer race nobody has flagged.** Five of `live.tsx`'s fifteen writes are not user actions. They are `useEffect`s that fire on _observed data_ arriving over the realtime subscription — a motion row flipping to `passed` causes a write to `executive_session`, `minutes_document` or `notification_event`. They are guarded only by an in-memory `useRef<Set>` of processed motion ids, which does not survive a reload and is not shared across devices. **Every connected client running this screen races to perform them.** Two clerks with the screen open means two writes. This is live today; changing the transport does not fix it and could change its timing.

**2. The transport decision is made, and it collides with a guard added after it was made.** `docs/advisory-resolutions/5.1-realtime-transport.md` resolves the transport as **tRPC SSE subscriptions** (`httpSubscriptionLink` client-side, `fastifyTRPCPlugin` with `useWSS: false` server-side) — not a plain Fastify route, and not WebSockets. That ADR is from August 2026. The `bindTenantAccess` reentrancy guard was added in wave 3 and tightened in wave 4, **after**. Nobody has checked the interaction. See Task 1.

**3. Two of the three transport files are app-global, not live-screen-local.** `ConnectionStatusBar` is mounted in `layouts/AppShell.tsx` (every authenticated screen) as well as `live.tsx`; `connection-error-handler` is wired at `providers/QueryProvider.tsx`. Migrating them is an app-shell change. Scope accordingly — this is not confined to one route.

## Global Constraints

- **Read `phase-e-conventions.md` in full first.** Items 2, 3, 7, 8, 11, 13 and 14 have been amended across four waves, several more than once.
- **Authorization is declared before `.input()`.** Every mutation carries a **deletion test and a reorder pin**. A refusal test asserts **`FORBIDDEN`** — one asserting `BAD_REQUEST` survives guard deletion while proving nothing.
- **Resolve `ctx.actor()` BEFORE opening `ctx.withTenant`.** The reentrancy guard refuses an unsettled actor inside a transaction and is deliberately stricter than the hazard.
- **An FK from client input needs a tenant-scoped existence check.** Postgres FK checks bypass RLS — reproduced **six** times now, most recently in wave 4 Task 2, where neutering the check made a cross-tenant insert succeed _silently_.
- **Every table this wave writes has tenancy-only RLS.** `motion`, `vote_record`, `meeting_attendance`, `executive_session`, `guest_speaker`, `agenda_item_transition`, `future_item_queue`, `meeting`, `agenda_item` — all nine are `FOR ALL USING (town_id = get_current_town_id())` with no board and no role predicate, verified in `packages/api/drizzle/0000_baseline.sql`. **RLS will not catch a cross-board write on any of them.** The guard is entirely application code.
- **Board derivation is one join for eight of the nine — and `future_item_queue` is the exception.** Eight carry a non-nullable `meeting_id`, so the board is `meeting.board_id`, the shape `agenda-item.ts`'s `assertMeetingOnAuthorizedBoard` already solves — reuse it, do not reinvent. **`future_item_queue` carries `board_id uuid NOT NULL` directly and its `source_meeting_id` is NULLABLE** (verified at `0000_baseline.sql:1248-1250`), so a join derivation there is not merely unnecessary, it is **wrong** — a deferred item with no source meeting would derive NULL. Authorize it on its own column. An earlier draft of this plan asserted all nine were one join; wave 4's close-out caught it.

  Item 2's copy-template says to copy the per-id query _and_ the row-count existence check together; a `SELECT DISTINCT board_id` cannot do the second.

- **The query you are replacing is a specification.** Filters, ordering and limits state intent even at zero rows. A dropped _or added_ clause is a behaviour change and must be stated.
- **A read owns its cache key** (item 7), with a `pathFilter()` and a pin per call site (item 8). Neither mechanised check catches a per-mutation miss inside a file that already has other pins — wave 3 shipped two, wave 4 shipped two more. Sweep every call site you add by deletion.
- Gates are `.github/workflows/ci.yml`'s list, all `--force`; anything but `0 cached` proves nothing. **Bare `npx tsc` resolves to the wrong package — always go through turbo.** A green vitest run is not a typecheck.
- **`DATABASE_URL="postgres://ben@localhost:5432/postgres"` must be set for the api suite** — without it every api test fails with `role "postgres" does not exist`, a red suite that proves nothing. Unique scratch DB names, dropped; leave the `tmm_app` role.

---

## Measured scope

Measured on `stage-1-phase-e-wave-4` at `344ff25`, mid-wave — wave 4 touches the agenda surface and the conventions doc, not `live.tsx` or any file below, so these hold at merge. **Re-derive them against wave 4's merge commit before Task 1 anyway**, and say if any moved. Counts are whole-file; **two published numbers were wrong and are corrected here** — `live.tsx` and `MeetingStartFlow.tsx` each had a write count inflated by one, because their own `TODO(phase-e-wave-5)` comments quote a `.update({...})` in prose.

| File                                                | `supabase` | writes | tables                                |
| --------------------------------------------------- | ---------- | ------ | ------------------------------------- |
| `routes/meetings.$meetingId.live.tsx`               | 39         | **15** | 12 distinct                           |
| `components/meeting/MeetingStartFlow.tsx`           | 7          | **6**  | meeting, attendance, item, transition |
| `components/meeting/VotePanel.tsx`                  | 4          | 3      | motion, vote_record                   |
| `components/meeting/MotionPanel.tsx`                | 3          | 2      | motion                                |
| `components/meeting/AttendancePanel.tsx`            | 3          | 2      | meeting_attendance                    |
| `components/meeting/GuestSpeakerEntry.tsx`          | 3          | 2      | guest_speaker                         |
| `components/meeting/AgendaItemDetailPanel.tsx`      | 3          | 2      | agenda_item                           |
| `components/meeting/RecusalDialog.tsx`              | 2          | 1      | vote_record                           |
| `components/meeting/MotionCaptureDialog.tsx`        | 2          | 1      | motion                                |
| `components/meeting/ExitExecutiveSessionDialog.tsx` | 2          | 1      | executive_session                     |
| `hooks/useQuorumCheck.ts`                           | 4          | 0      | reads only                            |

**35 real write sites.** A transitive-import sweep of `live.tsx`'s 42-file graph found **no** write-bearing file outside this list.

**Transport files, app-global — see hazard 3:** `hooks/useRealtimeSubscription.ts` (8 call sites, all in `live.tsx`, nowhere else), `components/ConnectionStatusBar.tsx` (`live.tsx` **and** `AppShell.tsx`), `lib/connection-error-handler.ts` (`QueryProvider.tsx`).

**Out of scope, verify before assuming:** `components/meetings/AgendaItemRow.tsx` is in the **`meetings/` (plural)** agenda-builder directory and is not in `live.tsx`'s graph at all. The two directory names differ by one character and this has caused a mis-scope before. `AgendaNavigationPanel.tsx` has zero supabase sites — measured, not assumed. `review.tsx`, `minutes.tsx` and `SourceDataPanel` are wave 6.

---

## The authorization gaps this wave inherits

Four tables this wave writes have **no rule in `rules.ts` at all**, and one has a missing operation:

| Table                    | Gap                                                                        | Candidate code                     |
| ------------------------ | -------------------------------------------------------------------------- | ---------------------------------- |
| `executive_session`      | no rule                                                                    | **M6** `trigger_executive_session` |
| `guest_speaker`          | no rule                                                                    | **M7** `manage_speaker_queue`      |
| `agenda_item_transition` | no rule                                                                    | none obvious — decide              |
| `future_item_queue`      | no rule                                                                    | none obvious — decide              |
| `vote_record`            | INSERT and UPDATE exist; **DELETE does not** — `VotePanel.tsx:207` deletes | M3                                 |

**M6 and M7 exist as permission codes, are board-scopeable, and are referenced nowhere in `packages/api`.** That is the exact shape of the A5 hole wave 4 Task 2 just closed: a code the product defined, a screen that acts on it, and no rule in between. Both are in `TEMPLATE_BOARD_SPECIFIC_STAFF`.

**M8 (`vote_as_board_member`) is deliberately different** — it is in no `designated_boards` template. It lives in `BOARD_MEMBER_ALWAYS_ACTIONS` alongside A4 and A7: actions board members always have, not configurable. `assertCanInsertVoteRecord` already encodes this as its second branch and is **the only async rule in the file** — it takes `(actor, tx, subject)` and does a live `board_member` query to check the voter's own active seat. Do not flatten that into a `BoardScope` rule.

**The A2-vs-M1/M2 question wave 4 left you.** `agendaItem.setOperatorNotes` and `agendaItem.markComplete` shipped unwired, guarded by A2 like every other `agenda_item` write. But a live-meeting operator may hold M1/M2 and no A2. `agenda-item.ts`'s header states it: _"if the product wants a presiding officer with no agenda-editing rights to mark items complete, that is a rules change (a second code, hence `requireBoardActor`), not a wiring change, and it should be made deliberately rather than discovered when a clerk is refused mid-meeting."_ **Decide it in Task 2, before wiring.**

---

## Task 0: Wave 4's parked items and the standing close-out

**Files:** `docs/superpowers/plans/phase-e-conventions.md`, plus whatever the ledger names.

Read wave 4's parked and deferred entries and clear or re-record each. Then run item 14's close-out **now, not at the end**: walk every Known-gaps bullet and status claim and check it **by claim, not by file**. Wave 3's close-out ran the sweep and missed a bullet its own commit falsified; wave 4 Task 0 did the same thing again, one commit into the wave. The unit of staleness is a claim.

**One standing decision to record so no later wave reopens it:** the owner has decided (2026-09-10) to **leave rule 14's town-wide `board_only` read visibility as-is**. Any board member of the town can read any board's `board_only` exhibit titles, because `isBoardMember(actor)` is a town-level fact. It is pinned as a _passing_ test in `exhibit.test.ts` so narrowing it later is deliberate. Wave 4's implementer judged it a latent defect rather than an intent; the owner's decision stands over that judgement. Record it in the conventions as a **decision**, not a gap, so the next reviewer does not re-raise it.

---

## Task 1: The SSE transport, and the context-lifetime question

**Files:** `packages/api/src/trpc/context.ts`, `packages/api/src/server.ts`, a new subscription router, their tests.

**Read `docs/advisory-resolutions/5.1-realtime-transport.md` in full first.** It is a resolved ADR backed by a real spike: SSE subscriptions on `fastifyTRPCPlugin`, reconnection resume verified against an actual `kill -9` mid-stream, tested through real nginx. It also tells you exactly what to install and what **not** to (no `eventsource` polyfill for the browser, no `@fastify/websocket`, no `wsLink`/`splitLink`), and that any subscription's input schema must carry an optional `lastEventId` or the client's automatic resume handshake has nothing to bind to.

**The question the ADR could not have answered, because the code postdates it.**

`createTrpcContext` calls `bindTenantAccess` **once per context**, and a subscription's context is created once and lives for the whole stream. That closure holds two pieces of per-request state:

- `inTransaction` — sequential `ctx.withTenant()` calls are fine (the flag resets in `finally`), but **two overlapping ones throw**. A long-lived stream that fans out concurrent per-event work would trip a guard that a normal request never could.
- `actorSettled` / the memoized actor — resolved once and reused. **A live meeting runs for hours.** A clerk whose permissions are revoked mid-meeting keeps a memoized actor that says otherwise, for as long as the stream is open.

Neither is a measured failure yet — no subscription procedure exists in the repo (`grep` for `.subscription(` returns nothing). **Settle both before writing the first subscription**, and pin whatever you decide:

1. Whether the subscription opens `withTenant` per event, once at subscribe time, or not at all.
2. Whether the actor is re-resolved on some cadence, and if not, what the stated exposure is. Say it plainly in the header rather than leaving it implicit — "authorization is evaluated at subscribe time and not re-checked for the life of the stream" is an acceptable answer _if it is written down_.

**A subscriber must not be able to receive an event for a town it cannot read, and that must be pinned by a test, not asserted.** The phase spec is explicit. Note that a `LISTEN` connection cannot carry tenant context by construction: `LISTEN` is session-scoped, `app.town_id` is `SET LOCAL` transaction-scoped, and notifications arrive outside any transaction. So filtering and per-subscriber authorization are application code, not RLS. `pg` 8.23.0 is already a declared dependency of `packages/api`, imported nowhere, provisioned for exactly this — `db-harness.ts` says so.

**Events carry no payload — they are invalidation signals.** The phase spec defaults to this and the reasoning holds here: it keeps authorization in the procedure that refetches, and cannot leak a field a subscriber should not see. If live-meeting latency argues otherwise, say so with a measurement rather than a preference.

---

## Task 2: The rules gap

**Files:** `packages/api/src/trpc/authorization/rules.ts`, its tests.

Add rules for the four unruled tables and the missing `vote_record` DELETE, per the table above. `executive_session` → M6 and `guest_speaker` → M7 are the two the product clearly intends; both codes exist and are board-scopeable.

`agenda_item_transition` and `future_item_queue` have **no obvious code**. Both are bookkeeping written as a side effect of navigation and adjournment, never by a user acting on them directly. Decide whether they take the code of the action that causes them (M1 for transitions, A2 or M1 for the queue) or a rule of their own, and state the reasoning. Do not leave a write authorized by nothing — that is what this wave is fixing.

**Settle the A2-vs-M1/M2 question here** for `agendaItem.setOperatorNotes` / `markComplete`, per the section above. If the answer is "a presiding officer with M1 should be able to mark items complete," that is a `requireBoardActor` multi-code rule, and Task 4's wiring depends on it.

Every new rule gets a mutation test: delete the `assertPermission` call, watch a named test go red.

---

## Task 3: The live-meeting routers

**Files:** new `motion.ts`, `vote-record.ts`, `meeting-attendance.ts` (extend — it exists with `countByMeeting`), `executive-session.ts`, `guest-speaker.ts`; `meeting.ts` (extend), `agenda-item.ts` (extend); tests; `router-wiring.test.ts`.

Board is one join for every table — reuse `assertMeetingOnAuthorizedBoard`. Per procedure: a caller with the right code on board X, acting on a row whose meeting is on board Y, must be **refused**. Prove it per procedure, not once.

**`assertCanInsertVoteRecord` is async and takes `(actor, tx, subject)`.** It is the only rule of its shape. It cannot go behind `requireBoardPermission` unchanged — decide how it is guarded and record what that costs.

**The two `meeting.status` holes close here**: adjournment (`live.tsx`) and call-to-order (`MeetingStartFlow`). Both currently write `meeting.status` with **no authorization check of any kind** under tenancy-only RLS. `meeting.ts` already has `cancel`, `updateStatus` and `publishAgenda` — copy their shape.

**`handleMeetingEnd` is one procedure, not five round trips.** Today it is: end the current transition, loop over unreached items writing `agenda_item` + `future_item_queue` per item, loop over tabled items, then update `meeting`. Unbounded loops of individual round trips with no transaction — a failure partway leaves items deferred with no queue row. Move it whole.

---

## Task 4: The live screen — reads, and the eight subscriptions

**Files:** `routes/meetings.$meetingId.live.tsx`, `hooks/useRealtimeSubscription.ts`, `hooks/useQuorumCheck.ts`, `components/meeting/AgendaItemDetailPanel.tsx`.

`useRealtimeSubscription` has exactly **8 call sites, all in `live.tsx`, and no other consumer in the repo** — so it can be replaced wholesale rather than kept compatible. Every one of its callbacks is already just `queryClient.invalidateQueries(...)`; three already invalidate a `trpc.*.pathFilter()`. The returned `status` is **never destructured at any call site** — the hook is called for its side effect only, which is worth knowing before designing its replacement's return type.

`AgendaItemDetailPanel` is **wiring-only** — `agendaItem.setOperatorNotes` and `markComplete` already exist and are tested, subject to Task 2's A2/M1 decision.

---

## Task 5: The live screen — writes, and the race

**Files:** `routes/meetings.$meetingId.live.tsx`, `MeetingStartFlow.tsx`, `VotePanel.tsx`, `MotionPanel.tsx`, `AttendancePanel.tsx`, `GuestSpeakerEntry.tsx`, `RecusalDialog.tsx`, `MotionCaptureDialog.tsx`, `ExitExecutiveSessionDialog.tsx`.

**The five reactive writes are this task's real subject.** `live.tsx` writes `executive_session` (×3), `minutes_document` and `notification_event` from `useEffect`s that fire on data arriving over the subscription, deduplicated only by an in-memory `useRef<Set>`. That ref dies on reload and is not shared between devices, so every connected client races.

Moving them server-side is the fix — the write becomes a consequence of the motion transition, decided once, where the ref cannot be the only guard. Whether that means folding them into the motion mutation, or a procedure the client calls idempotently, is yours to decide; **say which and why, and prove the dedup holds with two concurrent callers**, not one.

Closing these makes `FORBIDDEN` reachable on paths that could not refuse before. Wave 3 shipped two silent refusals for exactly that reason and wave 4 shipped a third. Every mutation surfaces its error.

---

## Task 6: The app-global transport surface

**Files:** `components/ConnectionStatusBar.tsx`, `lib/connection-error-handler.ts`, `layouts/AppShell.tsx`, `providers/QueryProvider.tsx`.

There are **three independent WebSocket heartbeats** to Supabase Realtime whenever the live screen is open: the hook's 8 channels, `ConnectionStatusBar`'s own `"connection-heartbeat"`, and `connection-error-handler`'s `"__global-connection-heartbeat__"`. Two of the three are app-global. Decide how many the SSE world needs — one shared connection state is the obvious answer, but say it rather than assuming it.

**`categorizeMutationError` is entirely Supabase-shaped** and none of its shape survives: it matches `PGRST301`, PostgREST `{code, message, details, hint}`, PG SQLSTATE class `23*`, and the strings `"row-level security"` / `"permission denied"`. Under tRPC these arrive as `TRPCError` with `FORBIDDEN`/`CONFLICT`/`BAD_REQUEST`. Rewrite it against the real error type. Its `network|permission|validation|conflict|unknown` categories are consumed elsewhere — check who before changing the shape.

`initConnectionErrorHandler`'s reconnect path calls `queryClient.invalidateQueries()` with **no arguments**, invalidating the entire cache. Decide whether that is still right when a reconnect resumes from `lastEventId` and has therefore missed nothing.

---

## Task 7: Close-out

- Run item 11's greps, **each anchored to this wave's SHA**. Bullets drifted in waves 3 and 4 because they quoted a bare number.
- Discharge or re-label every marker; re-derive counts against `git archive` rather than trusting a report.
- **Sweep every `pathFilter()` call site this wave adds, by deletion.** Wave 4's whole-branch review found two unpinned calls riding the pin check's credit-bleed limit, in files that already had pins.
- **Report what item 2 needs for wave 6**, and what the transport taught that the ADR could not have known.

---

## Self-review notes

- **The scariest finding is not in any TODO.** The five realtime-triggered writes race across every connected client and are deduplicated only by per-tab memory. It was found by asking what triggers each write rather than by counting writes, and it is the reason Task 5 is its own task.
- **The transport is decided; the interaction is not.** The ADR is thorough and verified, including reconnect-resume against a real process kill. It simply predates the reentrancy guard and the memoized actor. Task 1 settles that before a line of subscription code is written — the same shape as wave 4's Task 1 guard decision, which was worth doing first.
- **Two published write counts were wrong**, inflated by the very TODO comments written to help this wave. Corrected here rather than propagated.
- **Board derivation is easier than feared** — one join for eight of nine, the shape `agenda-item.ts` already solves; `future_item_queue` carries `board_id` directly. The hard parts of this wave are the transport, the race, and four missing rules, not the joins. (The all-nine claim was this plan's own error, caught by wave 4's close-out re-deriving it against the baseline rather than trusting the plan.)
- **Scope reaches the app shell.** Two of the three transport files are mounted app-wide. A plan that called this "the live screen" would have mis-scoped two tasks.
