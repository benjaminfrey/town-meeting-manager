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
