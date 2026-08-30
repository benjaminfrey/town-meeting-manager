# Phase E, Wave 1 — Identity, Settings, Town Profile, People

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the town-level screens — home, settings, town profile and the people directory — on tRPC, and in doing so exercise the write path the template has never run.

**Architecture:** Follow `docs/superpowers/plans/phase-e-conventions.md`. That document is the specification for _how_; this plan says _what_. Where the two disagree, the conventions document wins and this plan is wrong — say so rather than following it.

**Tech Stack:** tRPC 11.18.0, TanStack Query v5, Drizzle, Vitest, React Router v7.

## Global Constraints

- **Read `docs/superpowers/plans/phase-e-conventions.md` first, in full.** It is 13 rules, each carrying the unit-0 failure that produced it. Every one of them cost a review round to learn.
- **This is the first wave with writes.** Unit 0 migrated reads only. Item 2's authorization rules have been transcribed but never run against a real mutation, so expect to amend that item rather than assuming it is right.
- **All of this wave's writes are Actor-only** — `assertCanUpdateTown`, `assertCanInsertPerson`, `assertCanUpdatePerson`, `assertCanInsertUserAccount`, `assertCanUpdateUserAccount`, `assertCanInsertTownNotificationConfig`, `assertCanUpdateTownNotificationConfig`. **None takes a `BoardScope`.** Per item 2 that means the resolver form, not the middleware form. `requirePermission` / `requireBoardPermission` remain unexercised after this wave; do not reach for them here.
- **A read owns its cache key** (item 7). The commit that moves a read also updates every writer that invalidated the key it abandoned, in that same commit. This is a completion gate.
- **The query you are replacing is a specification.** Its filters, ordering and limits state intent even though it returns zero rows today. Dropping a clause is a behaviour change and must be deliberate and stated. Task 2 of unit 0 dropped a `.neq("status","cancelled")` under cover of the "no parity baseline" framing.
- **The column audit covers props handed to children, not just the screen's own JSX** (item 10). That is how unit 0 shipped a regression: `ArchiveBoardDialog` read `board.town_id` off an object the screen passed down.
- Gates are the list in `.github/workflows/ci.yml`. Run tests as `npx turbo run test --force`; anything but `0 cached` proved nothing. Run `npx turbo run build --force` first.
- **A green vitest run does not prove type correctness.** vitest does not typecheck. Run `npx turbo run typecheck --force` before believing a test.
- `DATABASE_URL="postgres://ben@localhost:5432/postgres"`. Scratch databases get unique names and are dropped; leave the `tmm_app` role.
- `packages/api/src/db/__tests__/` stays byte-identical; its isolation gate passes unedited.

---

## Measured scope

At `3cba9b5`, chain entries excluding tests:

| File                                             | Sites | Writes |
| ------------------------------------------------ | ----- | ------ |
| `routes/home.tsx`                                | 4     | 0      |
| `routes/people.tsx`                              | 3     | 0      |
| `routes/settings.town.tsx`                       | 2     | 0      |
| `routes/settings.notifications.tsx`              | 2     | 1      |
| `routes/settings.meeting-notices.tsx`            | 2     | 1      |
| `routes/settings.minutes-workflow.tsx`           | 2     | 1      |
| `components/dashboard/TownSettingsEditor.tsx`    | 1     | 1      |
| `components/dashboard/MeetingDefaultsEditor.tsx` | 1     | 1      |
| `components/dashboard/MeetingRolesEditor.tsx`    | 1     | 1      |
| `components/dashboard/RetentionPolicyModal.tsx`  | 1     | 1      |
| `components/dashboard/ProgressChecklist.tsx`     | 3     | 0      |
| `components/members/AddPersonDialog.tsx`         | 4     | 3      |
| `components/members/EditPersonDialog.tsx`        | 2     | 1      |
| `components/members/EditGovTitleDialog.tsx`      | 1     | 1      |
| `components/members/StaffAccountFlow.tsx`        | 1     | 0      |

**Out of scope, and verify this before assuming otherwise:** `AddMemberDialog` (14 sites) is wave 6 — `AddPersonDialog` only _mentions_ it in a comment, it does not import it. `MemberArchiveDialog`, `MemberTransitionDialog`, `PermissionOverrideView` and `RoleConflictDialog` are board-member operations belonging to wave 2 with the board Members tab; confirm by checking their importers before touching them.

---

## Task 0: Clear unit 0's parked debt

**Files:** `docs/superpowers/plans/phase-e-conventions.md`

Two items were adjudicated and parked at unit 0's cap. They are wave 1's opening task because the document is about to be used by five more waves.

- [ ] **Step 1: Warn that a green vitest run is not a typecheck**

Unit 0's final fix wave wrote two pin tests with an under-typed `setQueryData` payload. Vitest passed them; only `turbo run typecheck --force` caught it. Add this to item 8's floor and to item 13, with that incident as the evidence.

- [ ] **Step 2: Stop item 7 citing a bare line number**

Item 7 cites `packages/web/src/lib/connection-error-handler.ts:54`, which contradicts item 1's rule against line-number citation. Cite the file and the symbol.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/phase-e-conventions.md
git commit -m "Close the two conventions items parked at unit 0's cap"
```

---

## Task 1: The town router — reads

**Files:**

- Create: `packages/api/src/trpc/routers/__tests__/town.test.ts` (extend if it exists)
- Modify: `packages/api/src/trpc/routers/town.ts`, `packages/api/src/trpc/__tests__/router-wiring.test.ts`

**Interfaces produced:** `town.detail` returning the columns `settings.town.tsx` and the four dashboard editors read. This is the router `boards.$boardId.tsx` has been waiting on — its `TODO(phase-e-wave-2)` marker names it.

Read `town.ts`'s existing `portalAddress` / `setPortalAddress` for the house pattern. Audit the columns against **every consumer**, including props handed to `TownSettingsEditor`, `MeetingDefaultsEditor`, `MeetingRolesEditor` and `RetentionPolicyModal` — not just what the route's own JSX reads. Check every column name against `packages/api/src/db/schema.ts`; two live defects in this repo were queries naming columns that do not exist with the error discarded.

Follow the tenancy test shape in `routers/__tests__/board.test.ts` — including `connectAsAppRole`, without which the test passes for the wrong reason. Add the new procedures to the wiring pin.

---

## Task 2: The town router — writes, and the first exercise of item 2

**Files:** `packages/api/src/trpc/routers/town.ts` and its tests; then `settings.town.tsx`, `TownSettingsEditor`, `MeetingDefaultsEditor`, `MeetingRolesEditor`, `RetentionPolicyModal`.

**This is the wave's most important task.** It is the first mutation Phase E has written, and item 2's write-side rules have never run. Use the **resolver form** — `assertCanUpdateTown(await ctx.actor())` — because the rule is Actor-only. Do not use the middleware form; that is for board-scoped codes and there are none here.

For each write: a test proving a non-admin is refused, and a test proving an admin succeeds. **Verify the refusal by deleting the `assertCan*` call and watching the test go red.** A guard whose absence nothing notices is the defect this project has shipped five times.

Then migrate the four editors and `settings.town.tsx`, and update every writer that invalidated a key a migrated read abandoned.

**Expect to amend conventions item 2.** It was written from `rules.ts` without a mutation to check it against. Report what it got right and what it did not.

---

## Task 3: The person router and the people directory

**Files:** new `packages/api/src/trpc/routers/person.ts` and tests; then `people.tsx`, `AddPersonDialog`, `EditPersonDialog`, `EditGovTitleDialog`, `StaffAccountFlow`.

Rules: `assertCanInsertPerson`, `assertCanUpdatePerson`, `assertCanInsertUserAccount`, `assertCanUpdateUserAccount` — all Actor-only, all resolver form.

**`assertCanUpdateUserAccount` takes a required `columns` argument.** Its self-branch authorizes the row, not the columns, so a caller updating their own account may not write `role`, `permissions`, `town_id`, `person_id`, `archived_at` or `gov_title`. Pass the columns the mutation actually writes. Getting this wrong is self-promotion to administrator.

**`StaffAccountFlow` writes a permissions matrix**, and this is where two of the five shipped permission templates were broken for five months. Read `packages/shared/src/utils/permissions.ts` — the matrix is read by `normalisePermissionsMatrix`, which accepts action **codes** and **names**, with an AND conflict rule. Do not "normalise" what it writes without reading that function first.

`people.tsx` is a person-centric directory: person + user_account + active board_member, joined in JS today. Decide whether that join belongs in the procedure and say why.

---

## Task 4: Notification config and the remaining settings routes

**Files:** `settings.notifications.tsx`, `settings.meeting-notices.tsx`, `settings.minutes-workflow.tsx`, and the router work they need.

Rules: `assertCanSelectTownNotificationConfig`, `assertCanInsertTownNotificationConfig`, `assertCanUpdateTownNotificationConfig`.

`town_notification_config` holds SMTP credentials. Its select rule is admin-only for that reason — check what the procedure returns and make sure a non-admin cannot reach it, with a test that fails if the guard is removed.

---

## Task 5: Home, the progress checklist, and the wave's close-out

**Files:** `routes/home.tsx`, `components/dashboard/ProgressChecklist.tsx`.

`ProgressChecklist` displays "Set public portal subdomain" as a checklist item. `town.setPortalAddress` exists but no UI calls it — D1b built the mutation and left the wiring, because `packages/web/src/lib/trpc.ts` did not exist yet. It does now. Wire it, or state why not.

**Close-out, in the same task:**

- [ ] Update the countdown item 11 tracks: run its two greps and record the new numbers.
- [ ] Confirm `boards.$boardId.tsx`'s `TODO(phase-e-wave-2)` marker is narrowed — Task 1 delivers the `town.detail` half of what it is waiting for.
- [ ] Report which conventions items this wave amended, and what the first real mutations taught that transcription had not.

---

## Self-review notes

- **Scope boundary is measured, not assumed.** `AddMemberDialog` is wave 6; `AddPersonDialog` mentions it in a comment only. The four board-member dialogs belong to wave 2 — the plan tells the implementer to verify rather than trust that.
- **This wave does not exercise the board-scoped middleware.** Every rule it touches is Actor-only. `requirePermission` / `requireBoardPermission` / `BoardScope` still have zero non-test call sites after wave 1; that debt belongs to waves 3-6.
- **Task 2 is deliberately ordered before Task 3** even though people is the more visible feature: the town writes are the simplest possible exercise of item 2, and it is better to learn what that item got wrong on four settings editors than on the permissions matrix.
