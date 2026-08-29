# Phase E — Restoring the Web Client

**Status:** design, approved in conversation 2026-08-29
**Supersedes:** the "fan out 244 `.from()` calls across 70 files" line in the master plan

## What Phase E actually is

Not a migration. A **restoration**.

The web application's data layer is already dead, for two independent and individually
sufficient reasons:

1. **The browser sends no credential.** `packages/web/src/lib/supabase.ts` states it: every
   `supabase.auth.*` call is gone, and `persistSession` / `autoRefreshToken` are deliberately
   off. Phase C did this correctly — a stale GoTrue session attached to every PostgREST request
   is worse than none, because it neither works nor announces itself.
2. **Tenancy cannot resolve.** `get_current_town_id()` returns
   `nullif(current_setting('app.town_id', true), '')::uuid`, and only the API sets `app.town_id`,
   via `SET LOCAL` inside a request transaction. A PostgREST request from the browser never sets
   it, so all 25 tenancy policies compare against NULL and fail closed.

So every browser read returns zero rows and every browser write does nothing. This is not a
regression to avoid; it is the starting condition.

**The consequence that shapes everything below:** there is no parity baseline. A migrated screen
cannot be verified against how it behaves today, because today it shows nothing. Correctness comes
from tests and from the spec, and where the spec is silent we are reconstructing intent from code
that has never run against a live database. Every wave should expect to find at least one screen
whose intended behaviour is genuinely ambiguous, and should surface it rather than guess.

## Measured surface

At `d4cdd09`, in `packages/web/src`, excluding tests:

|                                                    | count                   |
| -------------------------------------------------- | ----------------------- |
| files touching supabase                            | 82                      |
| chain entries                                      | 220                     |
| `.from(` (data)                                    | 46                      |
| `.auth.`                                           | 3                       |
| `.storage.`                                        | 2                       |
| `.channel(` (realtime)                             | 1 hook + 2 status files |
| direct browser writes (`insert`/`update`/`delete`) | 104                     |
| test files mocking supabase                        | 14                      |

Concentration is extreme and matters more than the total:

| file                                     | sites |
| ---------------------------------------- | ----- |
| `routes/meetings.$meetingId.live.tsx`    | 24    |
| `routes/meetings.$meetingId.review.tsx`  | 16    |
| `components/members/AddMemberDialog.tsx` | 14    |
| `routes/meetings.$meetingId.minutes.tsx` | 11    |
| `routes/meetings.$meetingId.agenda.tsx`  | 9     |
| `routes/meetings.$meetingId.tsx`         | 8     |
| `routes/boards.$boardId.tsx`             | 7     |
| `lib/meeting-helpers.ts`                 | 7     |

Eight files carry 96 of the 220. The rest is a long, shallow tail.

## Three transports to replace

- **Data** → tRPC. The bulk of the work.
- **Realtime** → SSE over `LISTEN`/`NOTIFY`. Three files client-side; `live.tsx` is the only
  real consumer.
- **Storage** → the authorized-document and public-asset endpoints built in D1e.

Auth is already done (Phase C, Better Auth). When E ends, nothing in the repository consumes
Supabase.

## Unit 0 — the boards slice

This is what D2 was going to be, folded in as E's opening unit. It creates:

- `packages/web/src/lib/trpc.ts` and its TanStack Query integration
- the conventions every later wave copies: loading and error handling, mutation + invalidation,
  optimistic update policy (if any), the test idiom
- the **per-router wiring smoke test** described below

Boards earns this job by being small and complete: 7 call sites in one file, with real reads,
real writes, and a permission gate. Small enough to throw away if the shape is wrong; real enough
to prove it is not.

**Nothing else starts until unit 0 is reviewed.** The template is copied 80 times; a defect in it
is a defect 80 times.

## Waves, in dependency order

| #   | Area                                         | Notes                                               |
| --- | -------------------------------------------- | --------------------------------------------------- |
| 1   | identity, settings, town profile, people     | light; `useCurrentUser` already reads `GET /api/me` |
| 2   | board detail tabs                            | finishes what unit 0 starts                         |
| 3   | meetings list, kanban, `meetings.$meetingId` | 8 + tail                                            |
| 4   | agenda, agenda templates                     | 9 + tail                                            |
| 5   | **live + the SSE transport**                 | 24 sites and a new transport — the hard one         |
| 6   | minutes, review, member dialogs              | 16 + 11 + 14                                        |

Each wave runs as an orchestrated unit — migrate, verify, review — using
`.claude/workflows/sdd-review-wave.js`, whose interaction phase checks the merged tree. Waves are
reviewed before the next begins where they share files.

Realtime lands in wave 5 rather than earlier because `live.tsx` is its only consumer, and doing it
earlier would mean touching that file twice.

## Realtime design

Client: `hooks/useRealtimeSubscription.ts` becomes an SSE hook. `components/ConnectionStatusBar.tsx`
and `lib/connection-error-handler.ts` follow it — together the entire client surface.

Server: a `LISTEN`/`NOTIFY` bridge to an SSE endpoint. The endpoint is authenticated and
tenant-scoped like any other authenticated route; **a subscriber must not be able to receive an
event for a town it cannot read**, and that must be pinned by a test, not asserted.

Open for the wave to decide, with reasoning recorded: whether events carry payloads or act purely
as invalidation signals. Invalidation-only is simpler, keeps authorization in one place (the
procedure that refetches), and cannot leak a field the subscriber should not see. Payloads are
faster and quieter on the network. Default to invalidation-only unless live-meeting latency
demands otherwise.

## Testing

**Per screen:** typed tRPC mocks. The contract is end-to-end typed, so a mock that satisfies the
type matches the real shape — unlike the chainable Supabase mocks it replaces, which could return
anything and did.

**Authorization is not re-proven on the web.** It stays where it already is: the API's
real-Postgres suite. Web tests cover rendering, interaction, loading and error states.

**One wiring smoke test per router, against the real router.** This closes the one hole a typed
mock cannot: calling the wrong _procedure_. `meeting.list` standing in for `meeting.listForBoard`
type-checks and mocks cleanly. The smoke test asserts each screen's procedures exist, accept the
input the screen sends, and return the shape it reads — without dragging a database into every
screen test.

**A rewritten test is not a migrated test.** The 14 files that mock supabase are rewritten, not
adapted. This project has repeatedly shipped tests that could not fail: a `notification-service`
suite on a mock that could not express the bug it covered, `lib/push.ts` mocked wholesale to zero
executed coverage, a portal search test whose fixture made the assertion vacuous, an admin-gates
test that iterated the list it was testing. For every security-relevant assertion, delete the
guard and watch the test go red before believing it.

## Folded in, not deferred

The 8 `hasPermission` calls on raw DB rows in `packages/web` are fixed in whichever wave touches
them, via the shared `normalisePermissionsMatrix`. This is the mirror of the codes/names defect:
the web reads one spelling, so controls are hidden that the API would allow. Display-only — the
server re-checks — but it is the same bug and it should die with its twin.

## Definition of done

- `packages/web/src/lib/supabase.ts` deleted
- `@supabase/supabase-js` removed from `packages/web/package.json`
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` gone from `.env.example`, `.env`, and
  `.github/workflows/ci.yml`
- no import of any Supabase symbol anywhere in `packages/web/src`

Removal is the completeness proof. With the client deleted, a screen that still depends on it is a
**build error** rather than a silent zero-row read — which is exactly the failure mode this phase
exists to end. Completeness resting on grep is what let 82 files drift this far.

## Risks

1. **No parity baseline.** Stated above; the single most important consequence of this phase's
   real nature.
2. **`live.tsx` concentrates the two hardest problems** — the heaviest migration and a new
   transport — in the screen a clerk runs a live public meeting on. It gets its own wave and
   should get the most review.
3. **The template is copied 80 times.** Unit 0 is reviewed before anything follows it.
4. **Ambiguous intent.** Code that never ran against a live database may encode intentions nobody
   can now confirm. Surface these; do not resolve them silently.

## Out of scope

- Deleting `plugins/supabase.ts` and the API's remaining service-role usage — that is D1f.
- Decommissioning the Supabase containers, docker services and infrastructure — Phase F.
- The A6/R1/R2/R3 legacy board-scope gap — D1f.
- Accessibility remediation — a knowingly deferred roadmap item, per the owner's decision.
