# Phase E, Wave 2 — Board Detail, Templates, and Membership

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the board surface unit 0 started, and migrate the membership lifecycle — the largest write surface Phase E has attempted.

**Architecture:** `docs/superpowers/plans/phase-e-conventions.md` is the specification for _how_; this plan says _what_. Where they disagree, the conventions win and this plan is wrong — say so rather than following it.

## Global Constraints

- **Read `phase-e-conventions.md` in full before starting.** Items 2, 3, 7, 8, 11 and 13 were all amended during wave 1, several more than once. Do not work from memory.
- **Authorization is declared before `.input()`.** Every mutation carries a **deletion test and a reorder pin**.
- **A refusal test asserts `FORBIDDEN`.** One asserting `BAD_REQUEST` survives guard deletion while proving nothing.
- **An FK from client input needs a tenant-scoped existence check** — Postgres FK checks bypass RLS (item 3). This wave writes `board_member`, `user_account` and `invitation` rows carrying client-supplied `board_id`, `person_id` and `town_id`. It is the highest-exposure wave yet for this defect.
- **No redundant `WHERE town_id` alongside RLS** — it makes the tenancy test vacuous. But **do** scope anything RLS does not enforce.
- `packages/web/src/lib/__tests__/cache-key-parity.test.ts` now mechanises the item-7 half of the cache rule. **It does not cover item 8** — every `pathFilter()` writer still needs its pin by hand, and that half was violated twice in wave 1.
- Gates are `.github/workflows/ci.yml`'s list. `npx turbo run build --force` first; tests as `npx turbo run test --force` (anything but `0 cached` proves nothing); then `typecheck --force` and `pnpm format:check`. **Bare `npx tsc` resolves to the wrong package and prints a joke error — always go through turbo.**
- **A green vitest run is not a typecheck.** That mistake produced a false finding in the conventions during wave 1.
- `DATABASE_URL="postgres://ben@localhost:5432/postgres"`. Unique scratch DBs, dropped; leave `tmm_app`.

---

## Measured scope

At `a165049`:

| File                                            | Sites | Writes |
| ----------------------------------------------- | ----- | ------ |
| `components/members/AddMemberDialog.tsx`        | 14    | 9      |
| `components/members/MemberTransitionDialog.tsx` | 7     | 5      |
| `routes/boards.$boardId.templates.tsx`          | 6     | 4      |
| `routes/boards.tsx`                             | 3     | 0      |
| `components/boards/MemberRoster.tsx`            | 3     | 0      |
| `components/members/MemberArchiveDialog.tsx`    | 3     | 2      |
| `routes/boards.$boardId.tsx`                    | 2     | 0      |
| `components/boards/EditBoardDialog.tsx`         | 2     | 1      |
| `components/boards/AddBoardDialog.tsx`          | 1     | 1      |
| `components/members/RoleConflictDialog.tsx`     | 1     | 1      |
| `components/members/PermissionOverrideView.tsx` | 1     | 0      |
| `components/members/StaffAccountFlow.tsx`       | 1     | 0      |

**Scope correction to the spec:** the master spec placed "member dialogs" in wave 6. `AddMemberDialog` is imported by `components/boards/MemberRoster.tsx` — the board Members tab — so it belongs here. Verify that before relying on it.

**This wave is still Actor-only.** `assertCanInsertBoardMember`, `assertCanUpdateBoardMember`, `assertCanInsert/Update/DeleteAgendaTemplate` are all admin gates taking no `BoardScope`. So `requirePermission` / `requireBoardPermission` / `BoardScope` **still** have zero real call sites after this wave — a debt now three waves old, discharged only when waves 3–6 reach agenda, meeting and minutes writes. Do not reach for the board-scoped forms here.

---

## Task 0: Wave 1's parked item

**Files:** `docs/superpowers/plans/phase-e-conventions.md`

One sentence. The cache-key check's precision comes from being **forward-only** from the `invalidateQueries(` marker, not from the 250-character window: widening it to 999999 still yields zero false positives, while a bidirectional variant picks up 1, 4 and 9 of the twelve at widths 1000, 3000 and 10000. The document's "windowed versus whole-file" framing overstates what the number buys. Correct it, and commit separately.

---

## Task 1: The board and agendaTemplate routers

**Files:** `packages/api/src/trpc/routers/board.ts` (extend), a new `agenda-template.ts`, their tests, `router-wiring.test.ts`.

Wave 1 left four markers naming procedures this task owes: `board.byTown` (`settings.town.tsx`), `board.listByTown` (`StaffAccountFlow.tsx`), `boardMember.countByTown` (`ProgressChecklist.tsx`), `agendaTemplate.countForBoard` (`boards.$boardId.tsx`).

**The hazard wave 1 refused, and you must not undo.** `board.list` has **no `archived_at` filter**. `home.tsx`'s board picker and `StaffAccountFlow.tsx:64` both have `.is("archived_at", null)`. Swapping either onto `board.list` as-is would offer **archived boards when scheduling a meeting or assigning staff**. Wave 1 declined to do it and recorded why. Provide a filtered procedure, or a parameter — do not widen `board.list`'s consumers onto an unfiltered read.

Rules: `assertCanInsertBoard`, `assertCanUpdateBoard`, `assertCanInsert/Update/DeleteAgendaTemplate` — all Actor-only, all resolver-adjacent via `requireActor`.

---

## Task 2: Board list, detail tabs, and templates

**Files:** `routes/boards.tsx`, `routes/boards.$boardId.tsx`, `routes/boards.$boardId.templates.tsx`, `components/boards/AddBoardDialog.tsx`, `EditBoardDialog.tsx`, **`routes/settings.town.tsx`**, **`components/dashboard/ProgressChecklist.tsx`**.

**The last two were missing from this plan** — a gap the Task 1 review caught. Their `TODO(phase-e-wave-2)` markers name `board.byTown` and `boardMember.countByTown`, which Task 1 shipped as `board.listActive` and `board.memberCount`. Without them, both procedures ship with **no consumer** and both markers survive Task 5's sweep. Wire them and remove the markers.

**Two known facts about those files.** `settings.town.tsx` reads exactly `id, name, is_governing_board, member_count, election_method, officer_election_method` — precisely `listActive`'s six columns, verified. And `listActive` orders governing-boards-first, which matches `settings.town.tsx`'s own query but not `StaffAccountFlow`'s; if a consumer needs alphabetical, sort at the call site rather than adding a second procedure.

`boards.$boardId.tsx` was partly migrated in unit 0 — its Overview tab reads `board.detail`. The remaining tabs and its `TODO(phase-e-wave-2)` marker are yours. `AddBoardDialog` and `EditBoardDialog` already invalidate `trpc.board.pathFilter()`; check what exists before adding.

**`EditBoardDialog.tsx` writes `updated_at`, a column the `board` table does not have** — confirmed against both `schema.ts` and the live database. The untyped Supabase client let it compile; PostgREST would reject it. `board.update` correctly drops it. This is the **second** instance of this shape (wave 1 found `EditGovTitleDialog` writing `updated_at` to `user_account`), so treat a stray `updated_at` in any payload you migrate as suspect until you have checked the schema.

`boards.$boardId.templates.tsx` has four writes against `agenda_template`. Note `unit 0`'s `board.detail` returns `notice_template_blocks`; do not duplicate that read.

---

## Task 3: The board roster and AddMemberDialog

**Files:** `components/boards/MemberRoster.tsx`, `components/members/AddMemberDialog.tsx`, `StaffAccountFlow.tsx`, `PermissionOverrideView.tsx`, and a new `packages/api/src/trpc/routers/board-member.ts`.

**Move `board.memberCount` into the new `boardMember` router as your first step.** Task 1 put it in `board.ts` because no `boardMember` router existed; its subject is `board_member` rows keyed to the town, so it is the wrong noun by item 1. It has **zero consumers until Task 2 wires it**, so moving it is free now and stops being free later — coordinate with Task 2 if that has already landed.

**This is the largest single file in Phase E — 14 sites, 9 writes — and the most dangerous.** Three reasons:

1. **It writes `board_member`, `user_account` and `invitation` rows from client-supplied ids.** Every one needs a tenant-scoped existence check before insert. `assertPersonExists` and `assertBoardExists` are the existing instances.
2. **It feeds `StaffAccountFlow`, which writes the permissions matrix** — where two of five shipped templates were silently broken for five months. Read `packages/shared/src/utils/permissions.ts` first. `normalisePermissionsMatrix` accepts action **codes and names** with an **AND** conflict rule. Do not normalise or reshape what gets written.
3. **`invitation` has no router**, and invitations carry the pre-tenant bootstrap built in D1c — a token-derived tenant hint that is _used but not trusted_. Read `packages/api/src/db/invitation-bootstrap.ts` before adding an invitation write, and do not weaken that property.

Staff and board_member roles are **mutually exclusive** (Maine 30-A M.R.S.A. §2605). `checkRoleMutualExclusivity` in `packages/shared/src/utils/permissions.ts` is the existing check; find who calls it and keep it called.

---

## Task 4: Membership lifecycle

**Files:** `components/members/MemberArchiveDialog.tsx`, `MemberTransitionDialog.tsx`, `RoleConflictDialog.tsx`.

`MemberTransitionDialog` has five writes and moves a person between roles — the mutual-exclusivity rule above is its whole subject. `MemberArchiveDialog` archives a seat and may archive a `user_account` with it; wave 1 pinned its `pathFilter()` and its **negative** case (only the seat archived), so check what exists.

---

## Task 5: Close-out

- Run the item 11 greps and record the numbers.
- Every `TODO(phase-e-wave-2)` marker this wave discharges must be **removed**, not left. Report the count before and after.
- **Report which conventions items this wave amended and what its writes taught.** Wave 1's equivalent produced the ordering rule, the FK rule and the cache-key check. Waves 3–6 inherit whatever you write.

---

## Self-review notes

- **Scope measured, not inherited.** `AddMemberDialog` moved here from the spec's wave 6 because `MemberRoster` imports it; the plan says to verify rather than trust that.
- **Still Actor-only**, so the board-scoped middleware debt survives this wave. Stated so nobody assumes it is discharged.
- **The item-8 half of the cache rule is still manual.** It was violated twice in wave 1 and the new check does not cover it. Expect it to be the most likely blocking finding here, and sweep for it before submitting rather than after review.
