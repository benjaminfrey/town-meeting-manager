# Phase E, Wave 6 — Minutes, Review, and the Deletion That Proves It

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the minutes and review surfaces, close the last authorization gap, and **delete the Supabase client** — which is what proves the phase is finished.

**Architecture:** `docs/superpowers/plans/phase-e-conventions.md` is the specification for _how_; this plan says _what_. Where they disagree, the conventions win and this plan is wrong — say so rather than following it.

## Why this wave ends differently

Every prior wave could ship with work left over, because a missed file kept returning zero rows silently. This one cannot. Phase E's definition of done is **removal**:

- `packages/web/src/lib/supabase.ts` deleted
- `@supabase/supabase-js` gone from `packages/web/package.json`
- `VITE_SUPABASE_*` gone from the env files and CI
- no import of any Supabase symbol anywhere in `packages/web/src`

The spec is explicit about why: _"With the client deleted, a screen that still depends on it is a **build error** rather than a silent zero-row read. Completeness resting on grep is what let 82 files drift this far."_

**So the deletion is its own task, it goes last, and a build failure at that point is the check working.** Do not stub, alias or shim the module to make the build pass — that reintroduces exactly the silence the deletion exists to end.

## Global Constraints

- **Read `phase-e-conventions.md` in full first.** Item 2 grew six times in wave 5 alone; item 14 was widened twice.
- **Authorization is declared before `.input()`.** Every mutation carries a **deletion test and a reorder pin**. A refusal test asserts **`FORBIDDEN`** — one asserting `BAD_REQUEST` survives guard deletion while proving nothing.
- **Resolve `ctx.actor()` BEFORE opening `ctx.withTenant`.**
- **An FK from client input needs a tenant-scoped existence check — but this is an INSERT-side hazard, not a general property of writes on an RLS-covered table.** Nine reproductions, every one an INSERT taking a foreign key from client input (Postgres constraint enforcement bypasses row security, so the reference lands on a row the caller cannot see, and the write succeeds silently). An UPDATE on an RLS-covered table is not the same shape: probed directly against a real database in Task 1 (tenant context town A targeting town B's `minutes_document`), `UPDATE ... WHERE id = <town B's row>` matched zero rows and wrote nothing — RLS's `USING` clause covers UPDATE. Removing the existence check there still turns all six cross-tenant tests red, but for a different reason: it trades the honest `NOT_FOUND` for a FORBIDDEN-by-mismatch or an unguarded success/500, not for a silent cross-tenant write. Keep both shapes straight when writing this wave's tests.
- **`minutes_document`, `minutes_section` and `minutes_addendum` all have tenancy-only RLS** — `FOR ALL USING (town_id = get_current_town_id())`, no board term, verified at `0000_baseline.sql:4059-4072`. Board scope is entirely the application's job.
- **Do not authorize on `minutes_document.board_id`.** It exists but is **nullable and denormalised**, and two places in the codebase already warn against trusting it (`storage/documents.ts`, `rules.ts`'s `BoardScopedRow`). The authorization path is `minutes_document.meeting_id → meeting.board_id`. `agenda-item.ts` deliberately _does_ filter on `md.board_id` for a non-authorization list query and documents the divergence — do not copy that into a guard.
- **The query you are replacing is a specification.** A dropped _or added_ clause is a behaviour change and must be stated.
- **A read owns its cache key** (item 7), with a `pathFilter()` **and a pin per call site** (item 8). Wave 5's sweeps came back clean twice running; keep it that way by sweeping every call site you add by deletion.
- **Run item 2's coverage procedure from `packages/web`** for confirmation-dialog refusals. A refusal rendered outside an open Radix `AlertDialog` is `aria-hidden` and invisible.
- Gates are the five in `.github/workflows/ci.yml`: `typecheck`, **`lint`**, `format:check`, `build`, `test`. `pnpm lint` must be **0 errors**. Anything but `0 cached` proves nothing.
- **`DATABASE_URL="postgres://ben@localhost:5432/postgres"` must be set** or every api test fails with `role "postgres" does not exist`. Baseline at `83d335d`: shared 139 / web 556 / api 1044.
- **After any red `turbo run test`, check `SELECT datname FROM pg_database WHERE datname LIKE 'tmm_test%'` and drop what you find.** Turbo kills the sibling task mid-run, teardown never executes, and the orphan is invisible in `pg_stat_activity`. Turbo also leaves **stray vitest workers running after the CLI reports exit 0** — check for those too, and re-run on a quiet machine before believing a failure.

---

## Measured scope

At `83d335d`. Item 11's grep answers **23**, but that number is misleading three ways and the plan uses the corrected one.

- The 23rd is `src/test/render.ts`, a test helper matching neither `__tests__` nor `.test.` — **comment-only**.
- Six of the remaining 22 are **already migrated** and retain only header prose: `MeetingStartFlow.tsx`, `CreateMeetingDialog.tsx`, `useQuorumCheck.ts`, `lib/trpc.ts`, `meetings.$meetingId.agenda.tsx`, `meetings.$meetingId.live.tsx`. **Zero work.**
- The measure that matters is the **import** grep, because an import is what the definition of done forbids:

```
git grep -l 'from "@/lib/supabase"\|from "@/hooks/useSupabase"\|@supabase/supabase-js' -- packages/web/src
```

→ **17** = 16 consumers + `lib/supabase.ts` itself. No test file appears; they `vi.mock` the module rather than import it.

**16 files with real code, 11 real writes:**

| File                                                    | code/comment | writes | note                                  |
| ------------------------------------------------------- | ------------ | ------ | ------------------------------------- |
| `routes/meetings.$meetingId.review.tsx`                 | 17 / 6       | 0      | **16 reads**, one table has no router |
| `routes/meetings.$meetingId.minutes.tsx`                | 12 / 5       | **7**  | the six status transitions            |
| `components/minutes/SourceDataPanel.tsx`                | 7 / 0        | 0      | 5 reads; all procedures exist         |
| `routes/home.tsx`                                       | 4 / 2        | 0      | marker names two procedures           |
| `components/boards/ArchiveBoardDialog.tsx`              | 4 / 1        | **2**  | untransacted pair                     |
| `components/CommandPalette.tsx`                         | 3 / 0        | 0      | **no marker**                         |
| `components/members/AddPersonDialog.tsx`                | 3 / 0        | 0      | one `person` read                     |
| `components/members/EditPersonDialog.tsx`               | 3 / 0        | 0      | one `person` read                     |
| `components/boards/EditBoardDialog.tsx`                 | 3 / 3        | 0      | **no marker**                         |
| `hooks/useSupabase.ts`                                  | 3 / 3        | 0      | delete it                             |
| `components/MeetingSubnavHeader.tsx`                    | 2 / 0        | 0      | **no marker**                         |
| `components/boards/MinutesWorkflowEditor.tsx`           | 2 / 1        | **1**  | unauthorized `board` write            |
| `components/boards/NoticeTemplateEditor.tsx`            | 2 / 1        | **1**  | unauthorized `board` write            |
| `layouts/AppShell.tsx`                                  | 2 / 2        | 0      | needs `meeting.liveByTown`            |
| `routes/boards.$boardId.templates.$templateId.edit.tsx` | 2 / 1        | 0      | **no marker**                         |
| `routes/meetings.tsx`                                   | 2 / 2        | 0      | `board.listActive` exists             |

**`AddMemberDialog.tsx` is already migrated** — wave 2, Task 3. The spec's wave-6 row ("16 + 11 + 14") counts 14 sites there that no longer exist. Wave 6's member-dialog work is two `person` reads. **Verify before relying on this**, but the spec's table is stale on that axis and understates the stray axis.

**Four files carry no marker at all** — `CommandPalette`, `MeetingSubnavHeader`, `EditBoardDialog`, `templates.$templateId.edit.tsx`. Item 11's sweep reads them as done. They are findable only by the import grep, which is the argument for the import grep being the wave's completeness measure.

---

## The findings this wave inherits

### 1. R5 and R6 are enforced nowhere on the server — and R5 gates a legal record going public

```
grep -rn '"R5"\|"R6"' packages/api/src --include='*.ts' | grep -v __tests__   → empty
```

`PERMISSIONS.R5 = publish_approved_minutes` and `R6 = export_minutes` appear in **no rule and no router**. `minutes.tsx` gates the Publish button on R5 **client-side only**, and the write itself is a raw unauthorized Supabase update.

When you migrate it, the only rule that exists is `assertCanUpdateMinutesDocument` — **R1**. `TEMPLATE_RECORDING_SECRETARY` grants **R1 without R5** by design. So migrating publish onto R1 would let a recording secretary **publish minutes to the public portal**, which the product deliberately withholds from them.

**Add `assertCanPublishMinutes(actor, scope: BoardScope)` on R5 before wiring publish.** This is wave 4's A5 and wave 5's M6/M7 for a third time — a code the product defined, a screen that acts on it, no rule in between — except this one is a _widening_ rather than a missing table, so nothing fails loudly if you miss it.

### 2. No board-derivation helper exists for a minutes document

`board-derivation.ts` exports helpers keyed by meeting, live row, agenda items, motions and board members — **nothing keyed by `minutes_document.id`**. All six transitions on `minutes.tsx` key by `docId`. You must build that derivation, through `minutes_document.meeting_id → meeting.board_id`, and it must carry the row-count existence check item 2's copy-template describes — a `SELECT DISTINCT board_id` structurally cannot.

### 3. `future_item_queue` has no router, and `review.tsx` reads it

Confirmed: no `future-item*.ts` in `routers/`. `rules.ts` has `assertCanInsertFutureItem` (added wave 5) but there is no read. This read is in none of the eight markers — it is findable only by migrating the screen.

### 4. Two live defects in generated legal minutes, preserved for this wave

Both were deliberately not fixed in wave 5 because changing them changes what a legal record says. **Wave 6 owns the reading surface, so this is where they get decided.**

- **The record names the wrong adjourner.** `performAdjournment` writes `adjourned_by` as a **`person.id`** (`meeting.ts`, the `jsonb_build_object`), `minutes-assembler.ts`'s `memberName` looks it up in a **`board_member.id`** map and returns `null`, and `minutes-formatters.ts`'s `formatAdjournmentText` then **falls back to `attendance.presiding_officer`**. So when a clerk adjourns and the chair presides, the PDF says the chair adjourned. Not blank — misattributed. `adjourned_by_name` is written and read by nothing.

  **There is a deliberate tripwire:** `meeting.test.ts` asserts `adjourned_by: operator.personId`, pinning the _defective_ shape. **A correct fix turns it red — that is intended, not a regression.** A fix also needs `performAdjournment` to resolve the actor's `board_member.id` on that board, which it does not currently do, and a decision about existing rows.

- **The DRAFT watermark is never removed.** `VotePanel.tsx` POSTs `/api/meetings/:meetingId/minutes/render` with the **live** meeting's id; the approved document belongs to an **earlier** meeting, reached via `agenda_item.source_minutes_document_id`. The render route is keyed by meeting and 404s, and the call is `.catch(() => {})`. So the un-watermarked re-render has never once happened.

  `approveMinutesForPassedMotion` already has the right `documentId` in hand. A fix needs either a document-keyed route or a `document_id` param — **and a decision about which board the R1 check derives from**, since the earlier meeting may differ from the rendered one.

**Fixing either changes a legal record. Decide deliberately and state the reasoning; if the product question is genuinely open, say so rather than choosing.**

### 5. Two spec bullets describe work that has already happened

The spec lists as out-of-scope, deferred to D1f: the A6/R1/R2/R3 legacy board-scope gap, and deleting `plugins/supabase.ts`. **Both are done.** `plugins/supabase.ts` no longer exists, and `auth.ts` records that D1f removed the gap by removing the callers — the one remaining `requirePermission` preHandler is `notifications.ts` with C2, which is town-level by design and correct. Do not redo either.

### 6. `minutes_addendum` is fully built and entirely unused

Table, RLS policy, Drizzle schema, Zod schemas, relations and an isolation test — and **zero** application code: no router, no route, no web reference, no rule. The spec does not mention it and no marker names it. **It is not in this wave's scope**; record it as a decision rather than discovering it. (The screen's "amendment history" is a different thing — `minutes_document.amendments_history`, a `jsonb` column.)

---

## Task 0: Wave 5's carry-over, and a broken grep in the conventions

**The conventions' own marker grep silently undercounts by 8×.** Item 11 quotes it as `grep -rnE "^\s*(//|\*) TODO\(phase-e-wave"`, which works. The same pattern under `git grep` answers **1**, not 8, because `\s` is a GNU extension that POSIX ERE does not honour:

```
grep -rnE   with \s          → 8
git grep -nE with \s         → 1     ← a reader would conclude the phase is nearly done
git grep    with [[:space:]] → 8
```

**Fix the quoted grep to `[[:space:]]`** so it is correct under both tools, and say why. This footgun has now produced nine wrong counts in this project.

Then run item 14's close-out **by claim**, using the widened lens: Known-gaps bullets **and** prose inside numbered items, checking whether another section of the same document falsifies a claim. Report every false claim or state plainly how you checked.

Also clear wave 5's recorded items: `getMutationErrorMessage` has zero call sites with three categories unread; `isPaused` is rendered nowhere so an offline device pauses mutations silently at the form; and the connection banner never reaches a terminal state.

---

## Task 1: The `minutesDocument` router

**Files:** `packages/api/src/trpc/routers/minutes-document.ts` (extend — it has `byMeeting` only), `rules.ts`, `board-derivation.ts`, their tests, `router-wiring.test.ts`.

Build, in this order:

1. **`assertCanPublishMinutes` on R5** (finding 1). Decide whether R6/`export_minutes` needs one too, and say why either way.
2. **The minutes-document board derivation** (finding 2), through `meeting.board_id`, with the row-count existence check.
3. **`minutesDocument.detail`**, **`pendingByTown`** (`home.tsx`'s marker), and **the six status transitions** — save draft, submit for review, approve, publish, return for amendments, unpublish.

Every mutation: guard before `.input()`, a `FORBIDDEN` refusal test, a reorder pin, a board-mismatch test, and an existence check proven by removal. **`publish` gets a test for the actor the R5 rule exists to refuse** — R1 without R5, the recording-secretary shape.

`minutes_document.status` drives what the public portal serves. `canSelectMinutesDocument` already encodes the visibility rule (draft/review need R4; approved and published are broader) — read it before writing a transition that changes `status`.

---

## Task 2: The remaining reads — `futureItem`, `meeting.liveByTown`

**Files:** a new `future-item.ts` (one read), `meeting.ts` (extend), their tests, `router-wiring.test.ts`.

`review.tsx` reads `future_item_queue` and no router exists (finding 3). `AppShell.tsx` needs `meeting.liveByTown` — its marker explains why `meeting.byTown` is not a drop-in: **it selects no `started_at`, which is the query's ordering column.** Verify that before assuming.

`future_item_queue` carries **`board_id` directly, NOT NULL**, with a **nullable `source_meeting_id`** — so its board is its own column, not a join, and a join would derive NULL for an item with no source meeting.

---

## Task 3: The minutes screen

**Files:** `routes/meetings.$meetingId.minutes.tsx`, `components/minutes/SourceDataPanel.tsx`, and whatever `MinutesEditor` needs.

Seven writes — the six transitions plus the draft save. `SourceDataPanel`'s five reads all map to procedures that already exist; it is imported by `MinutesEditor`, which `minutes.tsx` renders.

**Coverage here is close to greenfield.** This 910-line screen has **one** test, and it is a cache-key pin that stubs out `MinutesEditor` and `TrackedChanges` entirely. `components/minutes/` has **no test file at all**. Per the spec, these are rewritten, not adapted.

**Publishing is the write that makes a legal record public.** It gets the R5 guard from Task 1, a refusal surfaced to the user, and — because it is behind a confirmation dialog — **two** refusal tests, one per reachability path.

---

## Task 4: The review screen

**Files:** `routes/meetings.$meetingId.review.tsx`.

Sixteen reads, zero writes — the largest single read surface in the phase. Fifteen map to shipped procedures; the sixteenth is `future_item_queue` from Task 2.

It calls `/api/meetings/:meetingId/minutes/generate`, a Fastify route, **not** tRPC. That is correct and stays — Puppeteer holds a Chromium process and a pooled connection for seconds, which is why minutes generation was deliberately kept off the transaction path. Do not migrate it.

**Audit the columns against every child receiving props** (item 10), not just the screen's own JSX. Wave 4's equivalent brief named five files and needed eight.

---

## Task 5: The twelve strays

**Files:** `home.tsx`, `meetings.tsx`, `AppShell.tsx`, `CommandPalette.tsx`, `MeetingSubnavHeader.tsx`, `EditBoardDialog.tsx`, `ArchiveBoardDialog.tsx`, `MinutesWorkflowEditor.tsx`, `NoticeTemplateEditor.tsx`, `boards.$boardId.templates.$templateId.edit.tsx`, `AddPersonDialog.tsx`, `EditPersonDialog.tsx`.

Mostly wiring onto procedures that already ship (`board.listActive` for two of them). Three exceptions:

- **`MinutesWorkflowEditor` and `NoticeTemplateEditor` each make a raw, unauthorized `board` write** — no guard stands between a caller and a board's minutes-workflow or notice-template settings. `board.update` exists; decide whether it is the right procedure or whether these need their own.
- **`ArchiveBoardDialog` makes two untransacted writes** (`board.update` then `board_member.update`). A failure between them leaves a board archived with its members still `active`. Both procedures exist individually; **a single transactional procedure does not.** Build one.

---

## Task 6: The deletion

**Files:** `lib/supabase.ts`, `hooks/useSupabase.ts`, `packages/web/package.json`, `packages/web/.env.example`, `.github/workflows/ci.yml`, the 15 test files, `src/test/render.ts`.

**Do this only when Tasks 1–5 are complete, and let the build tell you if they were not.**

1. Delete `lib/supabase.ts` and `hooks/useSupabase.ts`.
2. Remove `@supabase/supabase-js` from `packages/web/package.json`.
3. Empty or delete `packages/web/.env.example` — it is only the two `VITE_SUPABASE_*` lines. Then remove CI's `Configure web environment` step, which exists to copy it.
4. **Rewrite the 15 test files that `vi.mock` one of the two modules.** The spec is explicit: _a rewritten test is not a migrated test._ Count them with a multiline-safe pattern — a naive `grep -rln 'vi\.mock(.*supabase'` answers 9 and misses six where the call wraps.
5. Fix `src/test/render.ts`'s stale prose about module-level Supabase mocks.

**Verification is the import grep returning empty**, plus a green build:

```
git grep -l 'from "@/lib/supabase"\|from "@/hooks/useSupabase"\|@supabase/supabase-js' -- packages/web/src
```

**Two things that are not blockers but must be reported:**

- **`packages/web/.env` is gitignored** and holds the local anon JWT on each developer's machine. No commit can remove it. Say so in the wave report so developers delete theirs.
- **Four `e2e/` files reference Supabase.** The definition of done is scoped to `packages/web/src`, so they do not block it — but if they drive the app through a Supabase-backed fixture they will break the moment the client is deleted. **Check them; do not assume either way.**

**Out of scope, confirmed:** `packages/api/package.json` still lists `@supabase/supabase-js` with nothing importing it (dead dependency, D1f/Phase F), and `docker/`, `supabase/` and `nginx.conf` still run the stack (**Phase F**).

---

## Task 7: Close-out

- Run item 11's greps, each anchored to this wave's SHA, **with the corrected `[[:space:]]` form**.
- Re-derive marker counts against `git archive`. Wave 6 should end at **zero** `TODO(phase-e-wave-*)` markers — if any survive, say which and why.
- Run item 14's sweep by claim, widened lens.
- **Sweep every `pathFilter()` call site this wave adds, by deletion.**
- **Report what Phase E taught that the spec could not have known** — and state plainly whether the definition of done is met, item by item, with the grep for each.

---

## Self-review notes

- **The deletion is the point, not the epilogue.** Every other wave could leave work behind silently. This one turns a miss into a build error, which is why Task 6 is separate and last.
- **Item 11's count is wrong in three directions at once** — one test helper, six comment-only files, and four files with no marker that the sweep cannot see. The import grep is the real measure and the plan says so.
- **R5 is the third consecutive wave to find a defined-but-unenforced permission code.** A5 in wave 4, M6/M7 in wave 5, R5/R6 here. Unlike the others this one _widens_ silently — migrating publish onto R1 lets a recording secretary publish to the public portal, and nothing fails.
- **Two spec bullets are already done** (the A6/R1/R2/R3 gap, `plugins/supabase.ts`). Recorded so nobody redoes them.
- **The two minutes defects are decisions, not tasks.** Both change what a legal record says. The plan names the tripwire that a correct fix must turn red, so nobody mistakes it for a regression.
- **`minutes_addendum` is deliberately out of scope** — fully built, entirely unused, mentioned nowhere. Recorded rather than discovered.
