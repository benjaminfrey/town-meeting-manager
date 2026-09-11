# Phase E, Wave 4 — The Agenda Surface, and Authorization Two Joins Deep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the agenda builder, its item and exhibit writes, and template instantiation — and close the two live authorization holes wave 3 found and deliberately left.

**Architecture:** `docs/superpowers/plans/phase-e-conventions.md` is the specification for _how_; this plan says _what_. Where they disagree, the conventions win and this plan is wrong — say so rather than following it.

## Why this wave is different

Wave 3 discharged the board-scope debt on `meeting`, where `board_id` is a **column on the row being written**. Every write in wave 4 is one or two joins away from its board:

```
agenda_item  → meeting.board_id                        (one hop)
exhibit      → agenda_item → meeting.board_id          (two hops)
```

`agenda_item` has **no `board_id` column** — verified against `schema.ts`. So wave 3's `assertMatchesAuthorizedBoard(ctx, meeting.board_id)` pattern does not transcribe: there is no `board_id` on the row to compare against. The resolver must **derive** the board by join, inside the same transaction, before re-authorizing.

This is the shape waves 5 and 6 inherit for `motion`, `vote_record`, `minutes_section` and `meeting_attendance`. Get it right here and record it; get it wrong here and it is wrong five more times.

**Expect to amend conventions item 2.** Its board-mismatch section was written from `meeting`, where the board is one column lookup away. Report what survives the join and what does not.

## Global Constraints

- **Read `phase-e-conventions.md` in full first.** Items 2, 3, 7, 8, 11, 13 and 14 were amended across three waves, several more than once.
- **Authorization is declared before `.input()`.** Every mutation carries a **deletion test and a reorder pin**. A refusal test asserts **`FORBIDDEN`** — one asserting `BAD_REQUEST` survives guard deletion while proving nothing.
- **Resolve `ctx.actor()` BEFORE opening `ctx.withTenant`.** The reentrancy guard in `bindTenantAccess` refuses an unsettled actor inside a transaction. It is deliberately stricter than the hazard. Write `const actor = await ctx.actor()` above the transaction.
- **An FK from client input needs a tenant-scoped existence check.** Reproduced **five** times, most recently during wave 3's review, where removing `assertBoardExists` let a cross-tenant write succeed _silently_. `assertBoardExists` is exported from `board.ts`; `assertMeetingExists` from `meeting.ts`.
- **No redundant `WHERE town_id` alongside RLS** — it makes the tenancy test vacuous. Do scope what RLS does not enforce. `agenda_item_tenant_isolation` and `exhibit_tenant_isolation` are both plain `FOR ALL USING (town_id = get_current_town_id())` — **verified in `packages/api/drizzle/0000_baseline.sql`**. No board predicate, no role predicate. RLS will not catch a board mismatch.
- **The query you are replacing is a specification.** Its filters, ordering and limits state intent even at zero rows. Dropping a clause is a behaviour change and must be deliberate and stated.
- Both mechanised checks run: `cache-key-parity.test.ts` (invalidation half) and `pathfilter-pin-coverage.test.ts` (pin half). **Neither catches a per-mutation miss inside a file that has other pins** — wave 3 shipped two such misses and a reviewer caught them by sweeping every call site by hand. Sweep yours before submitting.
- Gates are `.github/workflows/ci.yml`'s list. `npx turbo run build --force` first; then `typecheck --force`, `test --force` (anything but `0 cached` proves nothing), then `pnpm format:check`. **Bare `npx tsc` resolves to the wrong package — always go through turbo.** A green vitest run is not a typecheck.
- **`DATABASE_URL="postgres://ben@localhost:5432/postgres"` must be set for the api suite.** Without it every api test fails with `role "postgres" does not exist` — a red suite that proves nothing. Unique scratch DB names, dropped; leave the `tmm_app` role.

---

## Measured scope

At `418e633`. "Sites" is whole-file `supabase` mentions (header prose included); "writes" is `.insert(`/`.update(`/`.delete(`.

| File                                                    | Sites | Writes | Note                                      |
| ------------------------------------------------------- | ----- | ------ | ----------------------------------------- |
| `routes/meetings.$meetingId.agenda.tsx`                 | 10    | 2      | reorder, insert section                   |
| `components/meetings/InlineItemForm.tsx`                | 8     | 5      | update, insert, **3-step cascade delete** |
| `lib/meeting-helpers.ts`                                | 8     | 3      | `instantiateAgendaFromTemplate` — live    |
| `components/meetings/AgendaSection.tsx`                 | 6     | 3      | reorder, delete child, delete section     |
| `routes/boards.$boardId.templates.$templateId.edit.tsx` | 5     | 2      | wave-2 leftover marker                    |
| `components/meetings/PublishAgendaDialog.tsx`           | 3     | 1      | **unauthorized `agenda_status` write**    |
| `components/meetings/ExhibitUploader.tsx`               | 3     | 1      | **unauthorized raw `exhibit` insert**     |

**Out of scope, and verify before assuming:** `AgendaItemDetailPanel.tsx` writes `agenda_item` (operator notes, mark-complete) but is imported **only by `live.tsx`** — confirmed by grep. Build its procedures here so wave 5 extends rather than creates; wire the component in **wave 5**. `live.tsx`, `MeetingStartFlow`, `VotePanel`, `MotionPanel`, `AttendancePanel` are wave 5. `review.tsx`, `minutes.tsx`, `SourceDataPanel` are wave 6.

---

## The four findings this wave inherits

### 1. A5 has no rule at all

`PERMISSIONS.A5 = "publish_agenda"` is **board-scopeable** (it appears in a shipped `designated_boards` template — verified by resolving `DEFAULT_PERMISSION_TEMPLATES`). There is **no `assertCanPublishAgenda`** in `rules.ts`; the only references to `"A5"` anywhere in `packages/api` are two test fixtures.

So `PublishAgendaDialog`'s `meeting.agenda_status = 'published'` write has **no authorization check of any kind**, under a tenancy-only policy. Wave 3 found this, scoped it out honestly (its `meeting` router closed `status`, not `agenda_status`), and marked it. Closing it is this wave's job.

### 2. `ExhibitUploader` is a second, unauthorized exhibit-creation path

D1e rebuilt exhibit upload as a real feature: `hooks/useExhibitUpload.ts` posts to the API, which resolves the agenda item's board, applies rule 15 (`assertCanInsertExhibit` — A3 **or** the `board_member` role), sniffs the file's actual bytes, enforces 5 MB server-side, and inserts the row in the same tenant transaction.

`ExhibitUploader.tsx:118` **also** raw-inserts an `exhibit` row directly, for the link-a-URL path. That path has no rule, no existence check on `agenda_item_id`, and sets `town_id` from client state. Reconcile the two: one authorized server path for both file and link.

### 3. `assertMatchesAuthorizedBoard` and item 2's "narrower guard first" rule contradict each other

**Verified in `packages/api/src/trpc/trpc.ts`:** only `requireBoardActor` sets `ctx.authorizedBoardId` (`trpc.ts:594`). `assertMatchesAuthorizedBoard` throws a plain `Error` when it is missing, and its message says so outright: _"This procedure's guard must be requireBoardActor — it is the only thing that sets it."_

But item 2 tells a wave-4 author to reach for **`requireBoardPermission` first**, and `requireBoardActor` only when the rule spans more than one code. Follow both and you get a procedure that compiles, passes its `FORBIDDEN` refusal test, and then throws `INTERNAL_SERVER_ERROR` the first time a real caller reaches the resolver.

Every board-scoped write in waves 4, 5 and 6 needs the mismatch defence — that is item 2's own stated default. So as written, the "narrower first" rule is dead on arrival for all of them.

**Decide this in Task 1, before writing any procedure.** The recommendation is to make `requireBoardPermission` set `authorizedBoardId` too, so both guards support the defence and item 2's preference survives. The alternative — use `requireBoardActor` everywhere — spreads its known residual (it cannot preserve `requirePermission`'s import-time refusal for a board-scoped code with no board) across every write in three waves, to buy nothing. Whichever you pick, **amend item 2 in the same commit**: right now it gives advice that does not work.

### 4. The cascade delete is three unguarded round trips

`InlineItemForm.tsx:172-186` deletes exhibits, then child agenda items, then the item — three separate calls, no transaction. A failure between them leaves a partial delete. Move it into one server-side transaction.

**No delete rule exists** for either table: there is no `assertCanDeleteAgendaItem` and no `assertCanDeleteExhibit`. There is also no delete-specific permission code — A2 (`edit_agenda`) is the governing action. **Decide and state:** add `assertCanDeleteAgendaItem(actor, scope)` / `assertCanDeleteExhibit(actor, scope)` delegating to A2 and A3 respectively, so the call site is greppable and the rule count stays honest — or reuse the update rules and say why. Do not leave a delete authorized by nothing.

---

## Task 0: Wave 2's four leftover markers

**Files:** `components/members/AddPersonDialog.tsx`, `routes/boards.$boardId.tsx`, `routes/people.tsx`, `routes/boards.$boardId.templates.$templateId.edit.tsx`, `docs/superpowers/plans/phase-e-conventions.md`.

Four `TODO(phase-e-wave-2)` markers are still open, two waves past their wave. Each names a real gap:

1. `AddPersonDialog.tsx:14,120` — `invitation.insert`. No `invitation` router or rule exists. **Read `packages/api/src/db/invitation-bootstrap.ts` first**: invitations carry the pre-tenant bootstrap built in D1c, a token-derived tenant hint that is _used but not trusted_. Do not weaken that property.
2. `boards.$boardId.tsx:66` — `town.detail` **exists**; it was never wired here. One-line consumer change.
3. `people.tsx:78` — `boardMember.listByTown` or equivalent. The board-membership half of the people directory is still raw.
4. `boards.$boardId.templates.$templateId.edit.tsx:21` — `agendaTemplate.detail` and `.update` **both exist** on the router already (verified). Another wiring gap, not a missing procedure.

Two of the four are pure wiring against procedures that already shipped. Do those first and separately — they are the cheapest markers on the board.

Then run item 14's close-out **now, not at the end**: walk every Known-gaps bullet and check it by **claim, not by file**. Wave 3's Task 4 ran the sweep and still missed a bullet its own commit had falsified, because it selected bullets by the files it touched.

---

## Task 1: The `agendaItem` router

**Files:** `packages/api/src/trpc/routers/agenda-item.ts` (extend — it exists with `countByMeeting` only), its tests, `router-wiring.test.ts`, `packages/api/src/trpc/authorization/rules.ts`.

Reads: the meeting's items for the builder (ordered, with children and exhibit counts). Writes: `insert`, `update`, `reorder`, `delete` (cascading), and `instantiateFromTemplate` (bulk).

**The board derivation is the whole point of this task.** `agenda_item` has no `board_id`. Every write authorizes on a client-supplied `boardId` at the middleware, then must re-derive the row's **real** board inside the transaction and re-authorize:

```sql
SELECT m.board_id FROM agenda_item ai JOIN meeting m ON m.id = ai.meeting_id WHERE ai.id = $1
```

Wave 3's `assertMatchesAuthorizedBoard` helper takes the row's board id — it still applies, but what you hand it now comes from a join, not a column. **Settle finding 3's guard question before the first procedure**, because the helper throws unless the guard set `ctx.authorizedBoardId`, and today only `requireBoardActor` does. If the helper's signature or its doc comment assumes the board is a column on the written row, fix it here and say so.

`reorder` and `instantiateFromTemplate` write **many rows at once**. A single re-authorization is not enough if the ids can span meetings: derive the distinct board set and refuse if it is anything but the one authorized board. Prove that with a test that mixes ids from two meetings on two boards.

Four things to prove, each by mutation:

- A caller **with** A2 on that board succeeds; **without** it is refused `FORBIDDEN`.
- A caller with a **revoking board override** for A2 is refused on that board and still allowed on another.
- A caller with A2 on board X, sending an `itemId` whose meeting belongs to board Y, is **refused** — the board-mismatch case, now two joins deep.
- Removing the existence check lets a cross-tenant write succeed. Reproduce it, then confirm the guard refuses.

Add `AgendaItemDetailPanel`'s two procedures (`setOperatorNotes`, `markComplete` — or whatever the migration names them) **here**, unwired, so wave 5 extends this router rather than creating one. Say in the router header that they are unwired and which wave owns them.

---

## Task 2: A5, publish, and the exhibit router

**Files:** `rules.ts`, `packages/api/src/trpc/routers/meeting.ts` (extend), a new `exhibit.ts`, their tests, `router-wiring.test.ts`.

**Add `assertCanPublishAgenda(actor: BoardScope-taking)` checking A5**, and a `meeting.publishAgenda` mutation using `requireBoardPermission("A5", boardIdFrom())`. This is the third raw `meeting` write wave 3's router did not cover; `meeting.ts` already holds `cancel` and `updateStatus` — copy their shape exactly, including the row re-authorization.

**The exhibit router** covers the link-a-URL path and the delete. The file-upload path already lives at the D1e endpoint and **stays there** — do not duplicate it into tRPC. Read `hooks/useExhibitUpload.ts`'s header and the endpoint it posts to before designing this; the goal is one authorization story for both paths, not two.

`assertCanInsertExhibit` is one of the **two** `BoardScope` rules that is not a single `assertPermission` call — it is `A3 || isBoardMember(actor)`, so a board member may upload their own material. That is a multi-code shape: **`requireBoardActor` is the right guard here, not `requireBoardPermission`**. It is the second real call site for the shape wave 3 built. Report what it gets right and what it does not.

Owner decisions already made, do not relitigate: **5 MB limit, replace not versioned, `board_only` exhibits stay out of the portal.** Verify the last one holds through whatever you build — an exhibit's `visibility` defaults to `public`, so a link-path insert that ignores the field publishes by default.

---

## Task 3: The agenda builder screen

**Files:** `routes/meetings.$meetingId.agenda.tsx`, `components/meetings/AgendaSection.tsx`, `components/meetings/InlineItemForm.tsx`, `components/meetings/PublishAgendaDialog.tsx`, `components/meetings/ExhibitUploader.tsx`.

`agenda.tsx` reads `meeting`, `agenda_item`, `board`, `town` and `exhibit`. `board.detail` and `town.detail` both already exist — check what they return before adding anything.

**Every read this migrates owns its cache key.** The commit that moves a read updates every writer that invalidated the abandoned key, **in the same commit**, with a `pathFilter()` **and a pin per call site**. `agendaItems` and `exhibits`: the first is already in `cache-key-parity.test.ts`'s `MIGRATED` map, the second is **not** — adding it will surface violations in wave 5/6 files. Add it anyway and fix them all. This call has been made four times and overturned four times; the fifth answer is the same.

**Silent refusals.** Closing the publish hole makes `FORBIDDEN` reachable on that button for the first time. Wave 3 shipped two silent refusals for exactly this reason — a kanban no-op and an unhandled rejection. Every mutation here surfaces its error.

---

## Task 4: Template instantiation

**Files:** `lib/meeting-helpers.ts`, `components/meetings/CreateMeetingDialog.tsx`, `routes/templates.tsx`.

`instantiateAgendaFromTemplate` is **live** — `CreateMeetingDialog:244` calls it on every create-from-template, and wave 3 marked it rather than fixing it. Today it writes `agenda_item` rows through the dead client, so **creating a meeting from a template silently produces an empty agenda**. Move it onto `agendaItem.instantiateFromTemplate` from Task 1.

The dialog's other two markers: one wants a procedure that does not exist yet (read its header — it says what), one wants `town.detail`, which does. `routes/templates.tsx` wants `agendaTemplate.listByTown`; the router has `list` — decide whether that is the same thing or a genuinely different read, and say which.

Watch the ordering: `instantiateAgendaFromTemplate` runs **after** `meeting.insert` returns. If the instantiation now refuses, the meeting already exists. Decide whether that is acceptable or whether creation and instantiation belong in one procedure, and state the reasoning.

---

## Task 5: Close-out

- Run item 11's greps and record the numbers, **each anchored to this wave's SHA**. Two bullets drifted in wave 3 because they quoted a bare number; item 11's own rule is "quote the grep, not the number."
- Discharge or re-label every marker this wave closes. Report the count before and after, re-derived against `git archive 418e633` rather than trusting a prior report.
- **Sweep every `pathFilter()` call site this wave adds, by deletion.** The pin check credits a writer imported alongside a genuinely-pinned writer. Wave 3 shipped two unpinned calls that the green check did not catch.
- **Report what item 2's board-mismatch section got right once the board is behind a join**, what finding 3's guard decision changed, and what waves 5 and 6 need that item 2 does not currently say. Four of the seven tables named in item 2 now have their RLS checked (`meeting`, `agenda_item`, `meeting_attendance`, `minutes_document`, plus `exhibit` this wave makes five); fold the result back into item 2 rather than leaving it in a router header.

---

## Self-review notes

- **Scope measured at `418e633`, not inherited.** `AgendaItemRow.tsx` and `AgendaNavigationPanel.tsx` appear in the import graph but touch Supabase **zero** times — measured, not assumed. `AgendaItemDetailPanel` writes `agenda_item` but belongs to wave 5 by its only importer.
- **The join is the new thing.** Wave 3's pattern assumed the board was a column on the row. It is not, for any table this wave or the next two touch. This plan says so at the top rather than letting an implementer discover it at the first mismatch test.
- **Three live holes, all found by wave 3 and left deliberately** — A5, the second exhibit path, the unguarded cascade. Each was marked, not hidden. Closing them is scoped into the tasks that touch their files rather than deferred again.
- **Two pieces of shipped guidance contradict each other**, and a wave-4 author following both would ship a procedure that throws at the first real call. Found by reading `trpc.ts` while planning rather than by an implementer hitting it — which is the only reason it is a paragraph here instead of a fix round.
- **`meeting-helpers.ts` is not dead code.** It looks like a leftover; it is on the create-from-template path, and that path currently produces an empty agenda. Verified by tracing the call site, because "unused helper" was the wrong guess.
