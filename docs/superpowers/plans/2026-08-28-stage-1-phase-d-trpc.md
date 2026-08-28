# Stage 1 Phase D — tRPC and the Authorization Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Numbering note.** Headings carry both forms — `Task 1 (D1)` — because `scripts/task-brief` matches numeric ids only, while the phase letters carry the dependency meaning. Pass the **number** to the scripts.

**Goal:** Stand up tRPC on Fastify, restore the 21 authorization rules Phase B deliberately removed — in tested TypeScript this time — and prove the whole stack on one vertical slice that becomes the template for migrating 244 call sites.

**Architecture:** tRPC procedures resolve through the Phase C tenant bridge into `withTenant()`, so every query runs inside a transaction with `app.town_id` set and RLS enforcing tenancy underneath. Permission checks sit in procedure middleware, keyed on action **codes**. The service-role Supabase client is deleted, which turns "routes can only reach the database through a tenant context" from a comment into a fact.

**Tech Stack:** tRPC 11.18.0 · Drizzle 0.45.2 · Fastify 5 · TanStack Query v5 · PostgreSQL 17.11

**Parent plan:** [2026-08-26-stage-1-platform.md](2026-08-26-stage-1-platform.md) — its Global Constraints bind every task here.

---

## Phase D Global Constraints

- **Permission lookup uses action CODES** (`A2`, `M3`, `R1`), never names (`edit_agenda`). The code/name mismatch is why authorization was inert before Phase B; `supabase/seed.sql` seeds by code.
- **Every procedure runs inside `withTenant`.** No procedure may reach the database any other way. Once `plugins/supabase.ts` is deleted (Task 1), this becomes structurally true rather than cultural — do not reintroduce a bypass.
- **Tenancy stays in RLS; permissions stay in TypeScript.** Do not add permission predicates back into policies. The split is deliberate: a tenancy bug is unrecoverable, a permission bug is a bug.
- **`board_id` must be threaded to every board-scoped check.** Rules 20 and 21 are board-scoped (`has_board_permission`), and `requirePermission` currently passes `boardId: undefined` everywhere so board overrides are never consulted. That is **not uniformly fail-closed** — an override that _grants_ is ignored, but so is one that _revokes_.
- **Do not weaken any Phase B or C artifact.** `packages/api/src/db/__tests__/` must stay byte-identical; `route-access` must stay green; the isolation gate must still pass. If something blocks you, that is a finding.
- **Every authorization rule needs a test that fails when the rule is removed.** Mutation-verify each one. This project has repeatedly found tests that passed against reverted-to-broken code.

---

## What Phases A–C handed forward

| Fact              | Detail                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy           | 27 tables, RLS + **FORCE**, proven behaviourally as `tmm_app` and on a non-superuser owner                                                                 |
| Tenant bridge     | `request.withTenant(fn)` resolves session → `person` → `town_id`, throws rather than falling through to an empty context                                   |
| Route default     | Deny unless explicitly marked public — attacked with 12 route shapes, unbroken                                                                             |
| Origin guard      | Every non-public route refuses a foreign `Origin` before session lookup                                                                                    |
| Realtime decision | SSE via `httpSubscriptionLink`, `tracked()` on every event, fed by `LISTEN/NOTIFY` — see ADR 5.1                                                           |
| **Authorization** | **Absent at the database layer.** 21 action-code rules, ~25 admin gates and 5 self-scoping rules were removed in Phase B. **This phase restores them.**    |
| Migration surface | **244 `.from()` calls across 70 files, 21 distinct tables**, 39 files importing the Supabase client                                                        |
| Concentration     | `meetings.$meetingId.live.tsx` 29 · `.review.tsx` 16 · `AddMemberDialog.tsx` 14 · `.minutes.tsx` 11 · `.agenda.tsx` 9 — the top five are ~32% of all calls |

---

## Task order

```
Task 1 (D1) tRPC + permission middleware + delete the service-role client
                              │
                              ▼
Task 2 (D2) the vertical slice: boards, end to end   ← the template
                              │
                              ▼
                    Phase E: fan out 244 call sites
```

**D2 must not start until D1 is reviewed**, and **E must not start until D2 is reviewed.** The fan-out is only mechanical because the slice already answered the questions; starting it on an unreviewed template multiplies any mistake by 70 files.

---

### Task 1 (D1): tRPC, the permission middleware, and deleting the bypass

**Files:**

- Create: `packages/api/src/trpc/{context.ts,trpc.ts,router.ts}`, `packages/api/src/trpc/middleware/permission.ts`
- Create: `packages/api/src/trpc/__tests__/permission.test.ts`
- Modify: `packages/api/src/server.ts`
- Delete: `packages/api/src/plugins/supabase.ts`

**Interfaces:**

- Produces: `publicProcedure`, `protectedProcedure`, `requirePermission(code, opts?)`, and an `appRouter` mounted at `/api/trpc`. Task 2 and all of Phase E consume these.

- [ ] **Step 1: Write the permission tests first — all 21 rules**

Before any tRPC wiring. Use the real-Postgres harness (`withTestDb`). Each rule gets a test that a caller **with** the permission succeeds and a caller **without** it is refused. The full checklist is in §"The 21 rules" below — it carries the _rule_, not just the code, and several are more than a simple code check.

Pay particular attention to the five that are not simple:

- **#5** `vote_record` INSERT — M3 **or** the caller is a board member casting their own vote.
- **#9** `minutes_document` SELECT — R4 **or** `status IN ('approved','published')`.
- **#14** `exhibit` SELECT — three visibility tiers with different rules each.
- **#18** `notification_delivery` SELECT — C2 **or** `subscriber_id` is the current person (this is the owner's Task 3 `person` decision, expressed as a read rule).
- **#20/#21** `meeting` INSERT/UPDATE — **board-scoped**, not global.

- [ ] **Step 2: Run them and watch every one fail.** Record the count.

- [ ] **Step 3: Build the tRPC context on the tenant bridge**

Context carries `{ tenant, user, withTenant }` from Phase C's `request`. `protectedProcedure` requires a session; `publicProcedure` does not and must be used deliberately, mirroring the route-level `PUBLIC_ROUTE` marking.

- [ ] **Step 4: Implement `requirePermission`**

Keyed on codes. It must accept an optional `boardId` and **actually use it** — board overrides are currently never consulted. Where a rule is board-scoped, the procedure must supply the board.

Admin short-circuits, but note `sys_admin` needs explicit handling: the shared `hasPermission` handles `admin` but **not** `sys_admin`, which would otherwise fall through to staff resolution.

- [ ] **Step 5: Run the tests and watch them pass.**

- [ ] **Step 6: Mutation-verify every rule.** For each of the 21, remove the check and confirm its test fails. **Paste the evidence.** A rule whose test still passes is not protected — report it rather than moving on.

- [ ] **Step 7: Delete `plugins/supabase.ts`**

This is what makes the tenant guarantee structural. All five route files currently use `request.server.supabase`; they must move to `withTenant` or the deletion will not typecheck — which is the point. Then update the comment in `auth/fastify.ts` that Phase C had to soften, because it becomes true here.

- [ ] **Step 8: Verify Phases B and C are intact** — `db/__tests__/` byte-identical, `route-access` green, isolation gate passing, `build-db-from-repo.sh` exit 0.

- [ ] **Step 9: Commit.**

---

### Task 2 (D2): The vertical slice — boards, end to end

**Boards is the right slice**: it exercises reads, writes, tenancy and a board-scoped permission, it is small enough to review closely, and `boards.$boardId.tsx` has only 7 `.from()` calls. It is deliberately _not_ the live meeting (29 calls, realtime, the most complex screen in the product) — that is Phase E's hardest case, and it should be migrated last, against a proven template.

**Files:**

- Create: `packages/api/src/trpc/routers/boards.ts` + tests
- Create: `packages/web/src/lib/trpc.ts` (client, wired to TanStack Query)
- Modify: `packages/web/src/routes/boards.tsx`, `boards.$boardId.tsx`, and the board dialogs

**Interfaces:**

- Produces: **the template.** Phase E copies its shape 70 times, so what it gets wrong gets multiplied.

- [ ] **Step 1: Write the router's tests first**, using the harness — list, get, create, update, archive. Include a cross-tenant test: a board from another town is invisible through the procedure, not merely filtered in the UI.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement the boards router**, every procedure inside `withTenant`, with `requirePermission` where the rules demand it.

- [ ] **Step 4: Wire the tRPC client** into `packages/web`, integrated with the existing TanStack Query setup. Preserve the query-key discipline in `lib/queryKeys.ts` — or replace it deliberately with tRPC's own keys and say which.

- [ ] **Step 5: Migrate the board screens.** Zero `.from()` calls should remain in them.

- [ ] **Step 6: Prove the slice end to end** against a real database: a signed-in admin of town A sees A's boards and none of B's, can create one, and a caller lacking the permission is refused.

- [ ] **Step 7: Write down the template.** A short section in the report: what a migrated screen looks like, what to do about loading and error states, how to handle a query that used a PostgREST embed, and what to do when a screen needs data from two tables. **Phase E reads this, not the code.**

- [ ] **Step 8: Commit.**

---

## The 21 rules

Restored verbatim from Task 5's checklist. Every one needs a procedure guard **and** a mutation-verified test.

| #   | Table                                | Cmd    | Code     | The rule                                                                                                             |
| --- | ------------------------------------ | ------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `agenda_item`                        | INSERT | A2       | A2 required                                                                                                          |
| 2   | `agenda_item`                        | UPDATE | A2       | A2 required                                                                                                          |
| 3   | `motion`                             | INSERT | M3       | M3 required                                                                                                          |
| 4   | `motion`                             | UPDATE | M3       | M3 required (recording outcome)                                                                                      |
| 5   | `vote_record`                        | INSERT | M3 (+M8) | M3 **or** caller is a board member casting their own vote                                                            |
| 6   | `vote_record`                        | UPDATE | M3       | M3 required (correcting a vote)                                                                                      |
| 7   | `meeting_attendance`                 | INSERT | M2       | M2 required                                                                                                          |
| 8   | `meeting_attendance`                 | UPDATE | M2       | M2 required                                                                                                          |
| 9   | `minutes_document`                   | SELECT | R4       | R4 **or** `status IN ('approved','published')`                                                                       |
| 10  | `minutes_document`                   | INSERT | R1       | R1 required                                                                                                          |
| 11  | `minutes_document`                   | UPDATE | R1       | R1 required                                                                                                          |
| 12  | `minutes_section`                    | INSERT | R1       | R1 required                                                                                                          |
| 13  | `minutes_section`                    | UPDATE | R1       | R1 required                                                                                                          |
| 14  | `exhibit`                            | SELECT | A3       | `public` → all town users; `board_only` → admin **or** A3 **or** role `board_member`; `admin_only` → admin **or** A3 |
| 15  | `exhibit`                            | INSERT | A3       | A3 **or** role `board_member` (A4 board uploads)                                                                     |
| 16  | `exhibit`                            | UPDATE | A3       | A3 required (including changing visibility)                                                                          |
| 17  | `notification_event`                 | SELECT | C2       | C2 required                                                                                                          |
| 18  | `notification_delivery`              | SELECT | C2       | C2 **or** `subscriber_id` is the current person                                                                      |
| 19  | `subscriber_notification_preference` | SELECT | C2       | own preferences **or** C2                                                                                            |
| 20  | `meeting`                            | INSERT | A1       | A1 **for that board** — board-scoped                                                                                 |
| 21  | `meeting`                            | UPDATE | A1, M1   | admin **or** A1 for that board **or** M1 for that board                                                              |

Phase B also removed ~25 admin gates, 5 self-scoping rules and the exhibit/minutes visibility tiers. Task 5's report §4b enumerates them; D1 should restore those too, or record explicitly which are deliberately not being restored and why.

---

## Phase D exit criteria

- [ ] All 21 rules have a procedure guard and a **mutation-verified** test
- [ ] `packages/api/src/plugins/supabase.ts` is deleted; no service-role client exists
- [ ] Every tRPC procedure runs inside `withTenant`
- [ ] Board screens have zero `.from()` calls, and boards work end to end for a signed-in user
- [ ] A cross-tenant board is invisible **through the procedure**, not merely filtered in the UI
- [ ] `board_id` is threaded to every board-scoped check
- [ ] Phase B's `db/__tests__/` byte-identical; `route-access` green; isolation gate passing
- [ ] `build-db-from-repo.sh` exits 0; all gates 0; CI green on PostgreSQL 17.11
- [ ] The template is written down for Phase E

---

## Open questions for the owner

Neither blocks starting D1.

1. **Do we keep `lib/queryKeys.ts`?** tRPC brings its own query keys. Keeping both means two conventions; replacing it touches every migrated screen. D2 should decide and Phase E follows — but it is a preference worth knowing.

2. **What should a permission denial look like to a clerk?** Right now there is no answer, because authorization has never worked end to end. A 403 toast, a disabled control with a reason, or a hidden control are all defensible, and the choice affects every migrated screen. _Consideration: hiding a control makes a misconfigured permission look like a missing feature, which is hard to report and hard to diagnose._
