# Phase E conventions — the template the six waves copy

Phase E moves roughly 80 web screens off `@/lib/supabase` and onto tRPC. Unit 0 migrated exactly
one screen (`routes/boards.$boardId.tsx`, Overview data only) and reviewed it hard, precisely so
that the mistakes would happen once instead of eighty times.

Every rule below has evidence attached, and the evidence is a thing that actually went wrong in
that one screen. Where a rule says "verified by mutation", someone deleted the guard, watched the
test go red, and restored it byte-identical. Nothing here is a preference.

Read items 8, 9 and 13 before writing your first test. They are the ones that decide whether the
suite you leave behind can fail.

---

## 1. Where a query goes

One router per domain noun, in `packages/api/src/trpc/routers/`, mounted by name in
`packages/api/src/trpc/router.ts`.

```ts
// packages/api/src/trpc/router.ts
import { townRouter } from "./routers/town.js";
import { boardRouter } from "./routers/board.js";

export const appRouter = router({
  town: townRouter,
  board: boardRouter,
  whoami: protectedProcedure.query(async ({ ctx }) => {
    /* ... */
  }),
});

export type AppRouter = typeof appRouter;
```

**Never `SELECT *`.** List the columns the screen reads, and say in the doc comment where you
checked — **by symbol or tab, never by line number.** `board.detail` names its 20 columns and, as
written today, cites the tab and the mapping it was checked against:

```ts
// packages/api/src/trpc/routers/board.ts
detail: protectedProcedure
  .input(z.object({ boardId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{ id: string; name: string; /* ...18 more, each named... */ }>(
        await tx.execute(sql`
          SELECT id, name, elected_or_appointed, member_count, election_method,
            /* ... */ auto_publish_on_approval_override
          FROM board WHERE id = ${input.boardId}
        `),
        (message) => new Error(`board.detail: ${message}`),
      ),
    );
    const row = rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    return row;
  }),
```

An explicit list means a schema change that drops a column this screen depends on fails at the
query, not as `undefined` deep inside a settings form. It also makes omissions deliberate and
documented — `board.detail` leaves out `board_type` because nothing on that screen reads it, and
says so. Add it back the day something does.

**Do not cite a line range.** `board.detail` and `board.recentMeetings` both did, at
`boards.$boardId.tsx:215-228`/`:603-616` and `:163-167`. By the time this was reviewed, Task 4 had
already rewritten that screen once and both citations pointed at the wrong code — one at an
unrelated Supabase query, the other split across a loading branch and an unrelated mapping. A line
range is correct only until the cited file's next edit, and this document exists because every one
of ~80 wave migrations edits the file it cites. Point at a symbol (`const b = { ... }`, a component
name) or a tab (`activeTab === "meetings"`) instead — either survives a rewrite that a line number
cannot.

Casts in SQL are load-bearing and belong in a comment. `postgres.js` returns `count(*)` as the
**string** `"0"`, so `board.stats` casts `::int` — and its test asserts `typeof`, not just the
value, because a missing cast renders correctly and passes a loose comparison.

---

## 2. Reads versus writes

**A read whose old policy was tenancy-only gets `protectedProcedure` and no guard.**
`protectedProcedure` + `ctx.withTenant` _is_ that policy: RLS makes another town's rows invisible.
Adding a second town-id comparison in TypeScript creates a weaker duplicate that people
eventually trust instead. `board.ts` states this at the top of the file rather than leaving the
absent guard to look like an oversight:

> No permission guard, deliberately: `board` carried a pure tenancy policy and nothing else, so
> any authenticated member of a town may read that town's boards.

**A write gets the matching `assertCan*` rule from `packages/api/src/trpc/authorization/rules.ts`.**
Do not invent a check. If the rule does not exist, add it there, next to its siblings.

**Rewritten (Task 2 fix round, wave 1).** The item used to frame the remaining question as
"resolver versus middleware." That framing was wrong, not incomplete — see "What this item
originally got wrong" below — and it produced a real defect in the first four mutations wave 1
wrote. The actual rule:

**Authorization goes in middleware, declared BEFORE `.input()`.** That is the only position input
parsing cannot preempt. Measured, not assumed — two probes against tRPC 11.18.0:

**Probe 1 — declaration order controls whether a guard can be preempted.**

| form                        | error returned | guard ran |
| --------------------------- | -------------- | --------- |
| `.use(guard).input(schema)` | `FORBIDDEN`    | **yes**   |
| `.input(schema).use(guard)` | `BAD_REQUEST`  | **no**    |

**Probe 2 — a middleware before `.input()` cannot see the parsed input.**

| middleware position | `opts.input`       | `await opts.getRawInput()` |
| ------------------- | ------------------ | -------------------------- |
| before `.input()`   | **`undefined`**    | `{boardId: "b-1"}`         |
| after `.input()`    | `{boardId: "b-1"}` | `{boardId: "b-1"}`         |

`.input(...).use(guard)` — declaring the parser first — REINTRODUCES the defect: a refused caller
whose input also fails validation gets BAD_REQUEST before the guard ever runs. This is not a
hypothetical ordering mistake; it is exactly how `town.updateProfile` first shipped (resolver form,
which is textually always after `.input()` — see below), and the first version of its own refusal
test caught it by accident, sending a town name containing `(` and getting BAD_REQUEST back where
FORBIDDEN was expected.

**Actor-only rules** — `.use(requirePermission(code))` before `.input()`, for any rule keyed by one
of the thirty `PermissionCode`s in `PERMISSIONS`:

```ts
protectedProcedure
  .use(requirePermission("C2", { action: "to read the notification log" }))
  .input(z.object({ ... }))
  .mutation(...)
```

**Admin gates that are NOT `PermissionCode`-keyed** — `assertCanUpdateTown` and its siblings in
`rules.ts`'s "Phase B report §4b" section — do NOT go through `requirePermission`. They check the
caller's role directly, deliberately outside the delegable-permission-matrix system;
`packages/api/src/storage/__tests__/documents.test.ts` pins exactly why for this rule: "there is no
action code that grants editing the town record, so an actor with a maximal matrix must still be
refused." Routing one of these through `requirePermission("T1", ...)` would answer identically
today (nothing currently grants `T1` in any matrix) but would make "never delegable" an accident of
configuration instead of a fact TypeScript enforces — the exact "quietly becomes delegable" failure
this document's `BOARD_SCOPED_CODES` section warns about for a different set of codes. Use
`requireActor` instead, added in the fix round specifically for this category:

```ts
// packages/api/src/trpc/routers/town.ts
updateProfile: protectedProcedure
  .use(requireActor(assertCanUpdateTown))
  .input(z.object({ ... }))
  .mutation(async ({ ctx, input }) => { ... }),
```

`requireActor` needs no board id and therefore no `getRawInput()` read — it only calls
`ctx.actor()`. `translateAuthorizationErrors` still does the FORBIDDEN mapping for both forms; that
part of the item was correct and is unchanged.

**Parked, not closed:** `requireActor`'s generic-plus-conditional-tuple type check (see its own doc
comment in `trpc.ts`) closes the realistic accidental path — `requireActor(isAdmin)` and
`requireActor(isBoardMember)` both fail to compile — but a predicate explicitly WIDENED to
`(actor: Actor) => void`, or `as`-cast at the call site, still passes silently, because that is
ordinary TypeScript structural typing rather than a hole this file's mechanism can close. Ruled real
but low-priority in Task 2's review: closing it needs a nominal brand on `assertCanX`'s return type
across roughly 46 assert functions, priced and deliberately declined rather than spent here — noted
so a future wave does not spend a round rediscovering the option instead of finding this sentence.

**Board-scoped rules** — `.use(requireBoardPermission(code, boardIdFrom()))` before `.input()`,
which now WORKS at that position only because of a matching fix: `requirePermission`'s board
extractor used to read `opts.input`, which probe 2 shows is `undefined` before `.input()` runs — a
board-scoped guard placed at the position this item requires would have refused every single call
before the fix, fail-closed but dead. It now reads `await opts.getRawInput()` instead — the
UNVALIDATED body. That is safe: `boardIdFrom` already narrows at runtime and returns `undefined` on
anything that is not a non-empty string at the key, and the guard already refuses when the
extractor yields nothing, so reading unvalidated input widens nothing a junk value could exploit.

```ts
protectedProcedure
  .use(requireBoardPermission("A1", boardIdFrom()))
  .input(z.object({ boardId: z.uuid() }))
  .mutation(...)
```

**One hazard this fix introduces, stated so it does not get rediscovered the hard way:** the guard
now authorizes against the PRE-validation board id (from `getRawInput()`) while the resolver acts
on the POST-validation one (from `input`, after `.input()` parses). Those are the same value today
for every board-scoped procedure in this repo. They would NOT be the same if an input schema ever
applied `.transform()` to the board id field — the guard would authorize one board while the
resolver acted on another. **Do not transform a value a guard authorizes on.**

**Two more write-guard shapes shipped this wave (Task 3), and neither fits the two named above.**
Both belong here rather than staying visible only in one router's own header comment, because the
next wave's author is the one who needs to find them.

**A subject-carrying middleware.** `assertCanUpdateUserAccount` in `rules.ts` does not fit
`requireActor`'s `(actor: Actor) => R` shape — it takes a second argument,
`subject: { userAccountId, columns }`, because its self-branch authorizes the ROW ("is this the
caller's own account?"), not the actor alone. `packages/api/src/trpc/routers/person.ts`'s
`updateGovTitle` (~line 186) handles this with `requireOwnAccountColumns`, a one-off local
middleware — not a new export on `trpc.ts`; nothing else in the app needs this exact shape yet, and
that file's own header warns that being wrong there is "wrong 70 times over." Declared before
`.input()`, it reads `userAccountId` off the UNVALIDATED body via `getRawInput()` — the identical
mechanism `requireBoardPermission`/`boardIdFrom` already use for a board id — and supplies `columns`
as a compile-time constant per call site, never derived from input. **This is the example to send a
wave-3 author who has a rule keyed on something other than the actor alone:** the board-scoped form
below is still unexercised outside its own tests, but this shape is not — it is live, in `person.ts`,
today.

**A write with no `assertCan*` at all, correctly.** `packages/api/src/trpc/routers/notification-preference.ts`'s
`setMine` carries no guard, and that is deliberate too — but for a different reason than `board.ts`'s
"tenancy is enough" reads above. `setMine` writes a person's OWN notification preferences, and
`person_id` is taken from `ctx.tenant.personId` — the caller's own bridged session — never from the
request body. There is no `personId` input field a caller could substitute, so scoping holds by
construction; an application-level `assertCan*` check would add nothing on top of "there is nothing
to authorize against." **Read the rule above ("A write gets the matching `assertCan*` rule … If the
rule does not exist, add it there") as conditional on there being something to authorize, not as
unconditional.** An author with a genuinely self-scoped write who follows it literally has two ways
to go wrong: invent a rule that only duplicates what construction already guarantees, or — the
dangerous branch — add a `personId` input parameter so there is something to authorize against,
which reopens exactly the hole this design closes. Check first whether the write's own scoping value
comes from `ctx.tenant` rather than client input; if it does, no guard is the correct answer, and
`notification-preference.ts`'s own header states the reasoning in full.

**Row-level rules stay in the resolver by necessity, unchanged from before.** "These minutes are
still a draft" cannot be decided before the row is read. `rules.ts` provides three shapes for
SELECT — `canX` answers, `assertCanX` throws, `visibleX` filters — so pick rather than improvise: a
list endpoint that threw on the first invisible row would be unusable, and a detail endpoint that
filtered would return 200 with nothing.

**The refusal-test rule, restated (it was over-strict the first time — see item 13 for the full
correction, which is where this belongs since it is general test discipline, not specific to this
item's defect):** a refusal test must assert **FORBIDDEN**. That is the whole rule. An earlier
version of this item said "on input that parses," which is a heuristic that happened to fit the
first symptom found, not the actual discriminator — and stated as an absolute it forbids the
ordering pin two paragraphs down, which is deliberately built on input that does NOT parse, because
that is the only way to catch a guard declared in the wrong position. What actually distinguishes a
real pin from a vacuous one is the asserted CODE: a test asserting `BAD_REQUEST` can stay green with
the guard fully deleted (the parser alone still produces `BAD_REQUEST` for bad input, guard or no
guard) — which is exactly how the first version of `town.updateProfile`'s regression-pin test
stayed green when a reviewer deleted `assertCanUpdateTown` entirely. A test asserting `FORBIDDEN`
cannot pass that way, regardless of whether its input happens to parse.

**What this item originally got wrong.** Not "resolver versus middleware" — that framing named one
instance of the defect (the resolver form is textually always after `.input()`, since `.mutation()`
is the terminal step of the chain) and missed the general rule: **anything declared after
`.input()` can be preempted by it**, including a middleware placed there by choice. The original
item's own `setPortalAddress` example was resolver-form and never caught the ordering bug only
because its schema (`z.object({ subdomain: z.string() })`) WAS too permissive for almost any string
to fail. **Historical note, not current status — see below:** at the time this paragraph was
written (Task 2's fix round), `setPortalAddress` was still unconverted and its schema was still
that permissive bare `z.string()`. Both are fixed now (Task 5): the procedure is
`.use(requireActor(...)).input(...)` like every other write in `town.ts`, and its schema is real
enough to carry its own reorder pin — see its own doc comment in `town.ts` for the conversion, and
the "Status today" paragraph immediately below for the current count.

Status today: the Actor-only middleware form (`requireActor`) is exercised — six `town.*`
mutations now: `updateProfile`, `updateMeetingDefaults`, `updateMeetingRoles`,
`acknowledgeRetentionPolicy` (Task 2's fix round) and `updateMinutesWorkflow` (Task 4) were already
converted; Task 5 converts `setPortalAddress`, the sixth and last write in `town.ts`, with tests,
each guard re-verified by deletion after the conversion. Five of the six carry a SECOND pin that
catches a REORDER (`.use()` moved back after `.input()`), not only a deletion — see item 13 for why
that distinction matters and could not be skipped: `updateProfile` (Task 2's fix round),
`updateMinutesWorkflow` (Task 4), and `updateMeetingDefaults`/`updateMeetingRoles`/`setPortalAddress`
(all three added in the review round after Task 5 first shipped — the first version of this task had
the pin only on `setPortalAddress` itself, and a reviewer caught that
`updateMeetingDefaults`/`updateMeetingRoles` had shipped without one despite both being
`.input()`-bearing `requireActor` writes exactly like the others). `acknowledgeRetentionPolicy` is
the one procedure with no reorder pin and none needed: it takes no `.input()` at all (the server
decides the timestamp, not the caller — see its own doc comment), so there is no parseable-or-not
input for a reordered guard to be preempted by; "every mutation gets a reorder pin" only applies
where there is an input to preempt with. `setPortalAddress`'s own reorder pin is also the proof
that the item 2 rewrite's diagnosis was right: its schema used to be a bare `z.string()`, "too
permissive for almost any string to fail," and literally could not have supported a reorder pin
until Task 5 tightened it — see that procedure's own doc comment. The
`PermissionCode` form (`requirePermission`) declared before `.input()` is exercised too, in
`require-permission.test.ts`'s synthetic router, including its own reorder pin — but the GLOBAL
shape (a code with no board) still has **zero call sites in a real procedure** as of wave 3; every
real Actor-only write so far is an admin gate (`requireActor`), not a delegable code, and this
wave's own delegable-code write (`meeting.insert`) is board-scoped, not global. ~~The board-SCOPED
form specifically ... still has **zero call sites outside tests** — no procedure in this repo
authorizes anything board-scoped yet.~~ — **closed in wave 3, Task 1.** `meeting.insert` calls
`requireBoardPermission("A1", boardIdFrom())` for real — see "Wave 3, Task 1 — the board-scoped
form's first real call site, and what it found" below for what that first use found the item got
right and what it did not yet say. **The underlying `getRawInput()` TECHNIQUE this form popularized
is a different claim and is no longer test-only** — `person.ts`'s `requireOwnAccountColumns` (the
subject-carrying shape documented above) reads a different field off `getRawInput()` the identical
way, for a different reason, and ships in a real procedure today. Do not read "zero call sites" for
the GLOBAL `requirePermission` form as covering the board-scoped form too; they are tracked
separately here because they answer different questions, and only one of the two closed this wave.

**Wave 3, Task 1 — the board-scoped form's first real call site, and what it found.** `meeting.insert`
(`packages/api/src/trpc/routers/meeting.ts`) is `.use(requireBoardPermission("A1", boardIdFrom())).input(...)`,
exactly the shape this item's example code has shown for three waves with nothing behind it. The case
this whole mechanism exists for — a global grant REVOKED on one board refuses there and still allows
the same actor elsewhere, and the mirror case the two `designated_boards` templates actually produce
(nothing globally, granted on one board only) — is now exercised by a real procedure for the first
time (`meeting.test.ts`'s "honours a REVOKING board override" / "honours a GRANTING board override"
tests). **What the item got right:** the mechanism worked exactly as specified, first try, for a
single-code write. `requireBoardPermission("A1", boardIdFrom())` needed no changes and no fix round —
`assertCanInsertMeeting(actor, scope)` and `assertPermission(actor, "A1", {boardId, ...})` are the
identical call, so using the code form through the middleware IS calling the rule, not a shortcut
around it (see `meeting.ts`'s own header for why it does not additionally import and call
`assertCanInsertMeeting` directly).

**What the item got wrong, or rather did not yet say: a `BoardScope`-taking rule with more than one
code needs a FIFTH guard shape this item does not catalogue.** `assertCanUpdateMeeting` is
`isAdmin(actor) OR A1@board OR M1@board` — not reducible to one `PermissionCode`, so
`requireBoardPermission` (which always resolves exactly one code via `assertPermission`) cannot
express it, the identical reason `requireActor` cannot express a subject-carrying rule like
`assertCanUpdateUserAccount`. `meeting.ts`'s `cancel` procedure needed a fourth shape — a **board-scoped
custom middleware** (`requireCanUpdateMeeting`, local to that file, not a new `trpc.ts` export, per
this item's own "keep a single-use shape local until a second caller needs it" precedent for
`requireOwnAccountColumns`) that reads `boardId` via the exported `boardIdFrom()` helper and calls the
real `assertCanUpdateMeeting(actor, {boardId})` rather than a single-code stand-in. This item's
existing catalogue (requirePermission/requireBoardPermission for one code; requireActor for no board;
a subject-carrying middleware for a row/column subject) had no entry for "BoardScope, more than one
code" until this task.

**A second, sharper finding, specific to `cancel` and worth generalizing: a board-scoped UPDATE whose
target is named by a DIFFERENT id than the board itself reopens the `.transform()` hazard by a new
route.** This item already warns "do not `.transform()` a value a guard authorizes on" for the case
where a schema transform changes a board id between the guard's read and the resolver's read of the
SAME field. `cancel` never transforms anything, and the hazard shows up anyway: its input is
`{meetingId, boardId}`, the guard authorizes the CLIENT-CLAIMED `boardId`, but the row the resolver
actually writes is selected by `meetingId` — a value the guard never inspects. `meeting`'s own RLS
(`meeting_tenant_isolation`) is tenancy-only, no board predicate, so any town member can already see
any meeting's true board via `detail`/`byTown`; nothing stops a caller who holds A1 on their OWN board
from naming a DIFFERENT board's meeting and claiming their own board for it. The middleware, doing
exactly what `boardIdFrom` always does, authorizes the board the caller NAMED, not the board the write
is actually about. The fix is not a schema change (there is no `.transform()` to remove) — it is a
SECOND, independent authorization check in the resolver, re-running `assertCanUpdateMeeting` against
the ROW's real `board_id` read fresh from the database, before the write. Generalize this as: **any
board-scoped write whose target is identified by something OTHER than the board id itself (a row id,
not the board id, as the mutation's key) needs the resolver to re-verify the guard's authorized value
against the row's true value — the middleware's pre-check on client-claimed input is not sufficient by
itself.** `insert` does not need this (the board id it authorizes on IS the board id it writes, by
construction), which is exactly why this did not surface in Task 1's `insert` procedure, or in
`board-scope.test.ts`'s four synthetic procedures, or in `require-permission.test.ts`'s
`editAgenda`/`scheduleMeeting` — none of them target a row by an id OTHER than the board id.

**A third finding, orthogonal to authorization but found by exactly the same "verify by mutation"
discipline item 13 requires, and worth recording here because the guard's own shape is what exposed
it: resolving `ctx.actor()` for the first time INSIDE a procedure's own `ctx.withTenant` callback
self-deadlocks under a single-connection pool.** `ctx.actor()` is memoised per request
(`context.ts`), but an UNresolved call runs its own internal `withTenant` (`fixtures.ts`'s `contextFor`
and the production context both shape it this way) — a second, nested transaction on the same pooled
connection while the first is still open. `cancel`'s resolver calls `assertCanUpdateMeeting(await
ctx.actor(), {...})` for its own re-check (the finding above); normally the `requireCanUpdateMeeting`
middleware resolves `ctx.actor()` FIRST, outside any transaction, so the resolver's later call just
reads the warmed memo. Deleting that middleware to run the deletion-pin mutation item 13 requires
(see this file's own discipline, and wave 3's Task 1 report) removed the ONLY thing warming that memo
before the transaction opened — every `meeting.cancel` test hung at vitest's 30s per-test timeout
instead of failing, on the test harness's deliberately single-connection pool
(`connectAsAppRole`'s own doc comment: "one connection, so 'the same pooled connection' is a fact").
Fixed by resolving `ctx.actor()` BEFORE `ctx.withTenant` opens, in the resolver itself, so the guard's
call and the resolver's are provably the same cached promise regardless of whether the guard ran —
correct by construction, not by accident of the guard resolving it first. **Any future procedure that
re-checks authorization inside its own transaction, the way `cancel`'s does, inherits this exact trap
if it calls `ctx.actor()` for the first time from inside `ctx.withTenant`'s callback rather than
before it.**

**The example files a reader lands on now match this item's own rule.** `board-scope.test.ts`'s
four board-scoped procedures and `require-permission.test.ts`'s `editAgenda`/`scheduleMeeting` used
to declare `.input().use(guard)` — the preemptable order — because they predate this item's
rewrite and nothing about what THEY test (board-override resolution) depends on declaration order.
They were reordered in the same fix round that added the reorder pin above, specifically because an
author who greps this codebase for a working example and copies the first board-scoped procedure
they find should not land on the wrong order by accident.

**If the action is one of the 18 board-scoped codes, the guard takes a `BoardScope` and the
procedure must resolve the board.** The set is derived, not hand-written —
`BOARD_SCOPED_CODES` in `packages/api/src/trpc/trpc.ts` computes it from the two shipped
`designated_boards` permission templates, and today resolves to `A1 A2 A3 A5 A6 M1–M7 R1–R6`.
Passing no board is **not** fail-closed: an override that grants is ignored (a board-specific
clerk is wrongly refused) and one that revokes is ignored too (a barred clerk is wrongly
**allowed**). Use `requireBoardPermission(code, boardIdFrom())`; `requirePermission` throws at
module import time if you hand it a board-scoped code with no board, so the mistake never reaches
a request.

---

## 3. NOT_FOUND, not FORBIDDEN, for a row in another town

A board that does not exist and a board belonging to another town must be **indistinguishable** to
the caller. `FORBIDDEN` on a foreign row confirms the row exists, which turns any id-guessing loop
into an existence oracle across towns. RLS already makes the row invisible rather than merely
filtered, so `NOT_FOUND` is also the honest answer: from inside the caller's tenant context there
is nothing there.

**Answer it consistently across every procedure in a router**, including the ones that do not
naturally have an opinion. `board.stats`' correlated subqueries and `board.recentMeetings`' scan
both degrade to `{0, 0}` and `[]` for an id that never existed, exactly as they would for a real
board with no members yet — so a screen that calls `stats` without `detail` would render a
convincing, empty-but-real board for an id that is not there. `board.ts` closes that explicitly:

```ts
async function assertBoardExists(tx: TenantTx, boardId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM board WHERE id = ${boardId}`),
    (message) => new Error(`board.assertBoardExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}
```

`stats` and `recentMeetings` both call it before counting.

### A foreign key is a hole RLS does not close

Any FK pointing at a tenant-scoped row is a hole RLS does not close. PostgreSQL's own documentation
says so directly: uniqueness, primary key and foreign key constraint enforcement **bypasses row
security** to preserve data integrity. So an INSERT that takes a foreign key from client input and
relies on the FK alone to keep it in-tenant is not protected by `FORCE ROW LEVEL SECURITY` at all —
the constraint will happily reference a row RLS would otherwise hide from the caller's own `SELECT`s.

This was not theoretical. Phase E wave 1 Task 3's `person.insertStaffAccount` takes a `personId` and
inserts a `user_account` referencing it via `user_account_person_id_fkey`. Without an explicit
existence check, a reviewer reproduced this directly: as Newcastle's admin, calling
`insertStaffAccount` with **Bristol's** `personId` succeeded — no error, no refusal — and wrote
`user_account{town_id: Newcastle, person_id: <Bristol's person>}`. Bristol's own admin can neither
see this row (RLS hides it) nor delete it, and it consumes `user_account_person_id_key`, so that
Bristol person can **never** get an account in their own town — a permanent, silent `CONFLICT` for
a person who did nothing wrong.

**Every insert that takes a foreign key from client input needs an explicit tenant-scoped existence
check first**, run through `ctx.withTenant` (so RLS actually filters it) before the write that
references the id. `board.ts`'s `assertBoardExists` and `person.ts`'s `assertPersonExists` are the
two existing instances of the pattern — same shape, same reason, written independently before this
item existed to name the rule:

```ts
async function assertPersonExists(tx: TenantTx, personId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM person WHERE id = ${personId}`),
    (message) => new Error(`person.assertPersonExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}
```

This is not specific to `person`. Every FK-bearing write in the ~75 remaining screens is a candidate
— `board_member`, `invitation`, `meeting`, `minutes_*` and anything else that inserts a row carrying
a foreign key whose target table is tenant-scoped. Verify the gap the way it was found here: delete
the existence check, attempt the cross-tenant write, and confirm it is refused (NOT_FOUND) rather
than silently succeeding.

---

## 4. The client call shape

Reads:

```ts
// packages/web/src/routes/boards.$boardId.tsx
const {
  data: board,
  isLoading: isBoardLoading,
  isError: isBoardError,
  error: boardError,
} = useQuery(trpc.board.detail.queryOptions({ boardId }));

const { data: stats } = useQuery(trpc.board.stats.queryOptions({ boardId }));

// Spread when you need to add TanStack options — do not drop the ones the
// screen already had. `enabled` here is a real behaviour, not noise: without
// it this query fires on every page load regardless of which tab is open.
const { data: recentMeetings = [] } = useQuery({
  ...trpc.board.recentMeetings.queryOptions({ boardId, limit: 5 }),
  enabled: activeTab === "meetings",
});
```

Route loaders prime the same cache the component reads:

```ts
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // Not wrapped in try/catch: a nonexistent or foreign board answers NOT_FOUND
  // and letting that reject routes to RouteErrorBoundary — visible, not the
  // indefinite "Loading board..." the old select("*").limit(1) produced (an
  // empty array is neither an error nor a board).
  await queryClient.ensureQueryData(trpc.board.detail.queryOptions({ boardId: params.boardId }));
  return { boardId: params.boardId };
}
```

Writes are `useMutation` plus invalidation — see item 7 for exactly which keys.

---

## 5. Error and loading states are required, and `role="alert"` is the pin

The failure this phase exists to end is a screen that renders nothing and says nothing. Every
migrated screen needs three distinguishable states: loading, error, and content. The error state
carries `role="alert"`, which is what the test asserts on.

```tsx
if (isBoardError) {
  const notFound = isTRPCClientError(boardError) && boardError.data?.code === "NOT_FOUND";
  return (
    <div className="..." role="alert" aria-live="assertive">
      <AlertTriangle className="..." aria-hidden="true" />
      <p>
        {notFound ? "This board could not be found." : "Something went wrong loading this board."}
      </p>
      <p>
        {notFound
          ? "It may have been deleted, or it belongs to another town."
          : "Try reloading the page. If the problem continues, contact support."}
      </p>
      <Link to="/boards">Back to Boards</Link>
    </div>
  );
}

if (isBoardLoading || !board) {
  return (
    <div className="...">
      <p>Loading board...</p>
    </div>
  );
}
```

Verified by mutation: deleting the `isBoardError` branch makes the error test fail with
`Unable to find role="alert"`, and the screen sits on "Loading board..." forever — the exact
silent-failure mode being migrated away from.

---

## 6. The test idiom

- **A typed mock per screen**, built the way item 8 describes.
- **Authorization is not re-proven on the web.** It stays in the API's real-Postgres suite. Web
  tests cover rendering, interaction, loading and error states. A web test that "proves" a
  permission is proving what its own mock returned.
- **One wiring entry per new router**, in `packages/api/src/trpc/__tests__/router-wiring.test.ts`.
  This closes the one hole a typed mock cannot: calling the wrong _procedure_. Add your router's
  procedures to the pinned list:

```ts
const procedures = Object.keys(appRouter._def.procedures).sort();
expect(procedures).toEqual(
  expect.arrayContaining([
    "board.detail",
    "board.recentMeetings",
    "board.stats",
    "permissions",
    "town.portalAddress",
    "town.setPortalAddress",
    "whoami",
    /* yours */
  ]),
);
```

Note `arrayContaining` pins only what it names. Grow the list as you add procedures.

---

## 7. Cache invalidation — a read owns its key

**The commit that moves a read to tRPC also updates every writer that was invalidating the key it
abandoned, in that same commit.** This is a completion gate, not advice.

After migrating a read, run `grep -rn "queryKeys\.<entity>" packages/web/src` and update every
`invalidateQueries` hit, or record in the commit why one does not apply.

During the transition, a Supabase-backed writer invalidates **both**:

```ts
// packages/web/src/components/boards/ArchiveBoardDialog.tsx
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(boardId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.boards.byTown(townId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
  void queryClient.invalidateQueries(trpc.board.pathFilter());
  // Archives every active `board_member` row on this board — a fourth
  // writer of the legacy `queryKeys.members.byBoard` key above, added in
  // Task 3's own fix round after a reviewer caught this dialog missing it.
  void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
  // ...
};
```

(Kept in sync with the real file, not re-quoted from memory: `ArchiveBoardDialog.tsx`'s own
`onSuccess` carries both `pathFilter()` calls today. An earlier version of this example omitted the
`trpc.boardMember.pathFilter()` line — the exact line Task 3's own blocking finding added — which
matters here specifically, since this is the example roughly 80 wave migrations copy from.)

The legacy line stays because other, unmigrated screens still read that key. It goes when the last
legacy reader does — not before.

**Default to router-level `trpc.<router>.pathFilter()`, not per-procedure `queryFilter()`.** A
board edit can change what both `detail` and `stats` return, and a writer should not have to know
which procedures some screen happens to call.

**Bare `invalidateQueries()` with no filter is banned in a mutation's `onSuccess`.** It invalidates
every query in the cache, which hides exactly the bug this item is about: a writer that
invalidates everything is indistinguishable from a writer that invalidates the right key, so the
day someone narrows it, the missing key surfaces as a bug in a screen nobody touched.

The one carve-out already in the tree, and it is a real one: `initConnectionErrorHandler` in
`packages/web/src/lib/connection-error-handler.ts` calls bare `invalidateQueries()` in its
`status === "SUBSCRIBED"` reconnect branch, after a Realtime reconnect. That is not a writer —
nothing local changed; the client has no idea WHAT went stale while the socket was down, and
"everything" is the correct answer. A connection-level recovery may invalidate globally. A mutation
may not. Do not "fix" that handler on a grep. (Cited by symbol, not line number — see item 1: a
line number is correct only until the cited file's next edit.)

_Found the hard way in Task 4: four writers — `EditBoardDialog`, `ArchiveBoardDialog`,
`NoticeTemplateEditor`, `MinutesWorkflowEditor` — invalidated `queryKeys.boards.detail(boardId)`
while the screen had moved to tRPC's key. A rename left the old name on screen for the full 60s
`staleTime`, and a saved notice template came back reverted._

### This rule is now a test, not just a paragraph

This exact rule was violated three more times after Task 4 named it — blocking review in Tasks 2, 3
and 5 — by implementers who had all read this item. Naming a rule in a document a human has to
remember to re-check is not enough; `packages/web/src/lib/__tests__/cache-key-parity.test.ts` checks
it mechanically, on every `npx turbo run test`, and fails with a filename instead of waiting for a
reviewer's grep.

What it checks: for every `invalidateQueries(` call in a non-test file, if the call's own argument
names a `queryKeys.<namespace>` for a namespace in its hand-maintained `MIGRATED` map (seven entries
as of this wave's final fix round — `towns`, `boards`, `persons`, `agendaTemplates`, `members`,
`userAccounts`, `invitations` — quote `cache-key-parity.test.ts`'s own `MIGRATED` object, not this
number, which will drift the same way "currently `towns`/`boards`/`persons`" drifted here from three
to seven without this paragraph ever being updated), the same file must also call the matching
`trpc.<router>.pathFilter()` somewhere. The match is scoped to roughly 250 characters measured from
inside the `invalidateQueries(` call itself, not the whole file — a whole-file version of this check
raises 12 false positives at HEAD (files that read a migrated key in a `useQuery` far from an
unrelated `invalidateQueries()` call); the windowed version raises zero.

That contrast is real but the "windowed versus whole-file" framing above overstates what the number
`250` itself buys: the precision comes from the match being **forward-only** from the
`invalidateQueries(` marker, not from the width being small. Widening the forward-only window all
the way to 999999 characters — in effect everything from the call to the end of the file — still
raises zero false positives, while a bidirectional variant of the same check (the width measured on
both sides of the marker, rather than only ahead of it) picks up 1, 4 and 9 of the twelve at widths
1000, 3000 and 10000 respectively, climbing to the full 12 once its own width is unbounded — which
is just the whole-file check by another name. `250` could be far larger with the same result; what
actually does the work is that nothing behind the marker is ever read.

Validated against `git archive` snapshots of six real commits from this wave, not assumed: it
reproduces two of the three blocking findings a human reviewer found by hand, by file, at the commit
each shipped — `TownSealUpload.tsx`/`settings.minutes-workflow.tsx` at `841f4db`, and
`AddBoardDialog.tsx` (its only violation) at `7a17fa6` — and raises zero violations at HEAD (`2d78964`).
It does **not** reproduce the third named finding, "the four person writers at `3b22df8`" — and that
is not a scoping miss: by that commit those files already called `trpc.person.pathFilter()`; what was
actually missing and fixed at `4f8b3fc` was the WRITER TEST pinning each call (item 8's "pin the
writers, not just the readers"), a different failure mode from a missing invalidation call. See the
Known-gaps entry below for the untuned second half that would close that gap too.

---

## 8. Mock the transport, not the proxy

**This is the single highest-leverage item in this document.** It is the file 80 tests get copied
from.

### What went wrong

Task 4's screen test did `vi.mock("@/lib/trpc", ...)`, replacing the options proxy with hand-built
`queryOptions()` objects. Two facts follow, both measured rather than suspected:

1. **The suite could not catch a missing `pathFilter()` call.** A reviewer deleted
   `NoticeTemplateEditor`'s invalidation line and ran everything: **940 tests, nothing red.** The
   keys those tests exercised (`["board.detail", input]`) were invented by the tests and matched
   nothing the app produces, so no invalidation assertion was even expressible.
2. **Mocking `@/lib/trpc` wholesale binds nothing to the router.** Renaming `name` to `nayme`
   inside the mock left `tsc --noEmit` at **exit 0**, because the mock's return type was inferred
   from the mock. Any column the assertions do not name could drift from the procedure with
   typecheck and tests both green.

### What to do instead

Leave `@/lib/trpc` **unmocked**. Replace `globalThis.fetch` — the actual boundary between the app
and the API — using `packages/web/src/test/trpc.ts`:

```tsx
// packages/web/src/routes/__tests__/boards.$boardId.test.tsx — MODULE SCOPE,
// above the it(...) blocks. Not inside a test. See "scope" below.

import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

/** Mutable so a test can change what the server returns between refetches. */
const server = { boardName: "Select Board", detailRejects: false };

const stub = installTRPCFetchStub({
  "board.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return { id: "b1", name: server.boardName /* ...every column the procedure selects... */ };
  },
  "board.stats": () => ({ active_members: 3, meetings: 7 }),
  "board.recentMeetings": () => [],
});

describe("board detail", () => {
  beforeEach(() => {
    server.boardName = "Select Board";
    server.detailRejects = false;
  });
  // ...
});
```

### Scope: once per file, at collection scope

`installTRPCFetchStub` installs the stub in a `beforeEach` and restores the original `fetch` in an
`afterEach`. **Call it above your `it(...)` blocks, exactly once, and route per-test variation
through mutable state the handlers close over** — the `server` object above. Calling it from
inside a test body throws with an actionable message.

That guard is not decoration. Vitest **silently ignores** a lifecycle hook registered while a test
is running, so the first version of this helper — which called `afterEach` from wherever it
happened to be invoked — had two failure modes and no way to notice either:

| Where it was called | What happened                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inside a test body  | the hook was dropped; `fetch` stayed stubbed past the end of the file, and the doc comment's "cannot leak" promise was simply false                                                     |
| at module scope     | the hook ran and unstubbed `fetch` after test 1; every later test failed with `Unable to find an element with the text: Select Board` — a DOM error pointing nowhere near the transport |

`packages/web/src/test/__tests__/trpc-stub-scope.test.ts` pins both directions: the supported form
answers across two tests with its call log reset between them and `fetch` restored by `afterAll`,
and each helper refuses a call made from inside a test body. Verified by mutation — dropping the
scope guard, the call-log reset, or the restore each turns that file red.

`setupAppQueryClient()` carries the identical requirement, for the identical reason. Both throw
rather than degrade.

`TestHandlers` is keyed by `AppRouter`'s flattened procedure paths, and each handler's input and
output are inferred from the procedure. Both halves verified by mutation:

| Mutation                          | Result                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `name:` → `nayme:` in the payload | `TS2322: Property 'name' is missing ...`                                               |
| `"board.stats"` → `"board.statz"` | `TS2353: '"board.statz"' does not exist in type 'Partial<{ ... "board.detail" ... }>'` |

**The binding is not total, and the gap runs one way.** A missing or misspelled field is rejected;
an **extra** one is not. This compiles clean:

```ts
"board.stats": () => ({ active_members: 3, meetings: 7, bogus: 1 }),
```

Excess-property freshness is lost through the `Partial<>` and conditional mapping `TestHandlers` is
built from. So read a green typecheck as **"nothing the procedure returns is missing"**, not "this
payload is exactly the procedure's shape".

Left as-is deliberately, and the reasoning is here so it does not get re-litigated: closing it
would cost either the `Partial<>` (every file would then have to supply a handler for every
procedure on the router) or the inference itself. And the failure mode is benign — a component
reads its fields through `queryOptions()`, whose type is the real `inferProcedureOutput`, not the
mock's shape. An extra key in a handler is invisible to the component and cannot make a failing
assertion pass.

Because the real proxy runs, the query keys are real, and the assertion that was impossible before
is now routine:

```tsx
// `stub` and `server` come from the module-scope install shown above.
it("refetches when a writer invalidates trpc.board.pathFilter()", async () => {
  renderRoute("b1");
  expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
  const before = stub.countFor("board.detail");

  server.boardName = "Renamed Board";
  await queryClient.invalidateQueries(trpc.board.pathFilter());

  await waitFor(() => expect(stub.countFor("board.detail")).toBeGreaterThan(before));
  expect((await screen.findAllByText("Renamed Board")).length).toBeGreaterThan(0);
});
```

Verified by mutation: swapping `trpc.board.pathFilter()` for `trpc.town.pathFilter()` fails with
`expected 1 to be greater than 1`.

### Pin the writers, not just the readers

The 940-green-tests hole was on the **write** side, so close it there.
`packages/web/src/components/boards/__tests__/ArchiveBoardDialog.test.tsx` is the template: real
proxy, real `QueryClient`, Supabase mocked only at `@/hooks/useSupabase`.

```tsx
const detailKey = trpc.board.detail.queryOptions({ boardId: board.id }).queryKey;
queryClient.setQueryData(detailKey, board);
expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

// ...render the dialog, type the confirmation, click Archive...

await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
```

Verified by mutation: deleting `ArchiveBoardDialog`'s `pathFilter()` line turns this red.
`EditBoardDialog`, `NoticeTemplateEditor` and `MinutesWorkflowEditor` now have the same pin, in
`__tests__/EditBoardDialog.test.tsx`, `__tests__/NoticeTemplateEditor.test.tsx` and
`__tests__/MinutesWorkflowEditor.test.tsx` — all three verified the same way: delete the
`pathFilter()` line, watch the new test go red, restore it. **Two more joined in this wave's fix
round:** `AddBoardDialog.tsx`, pinned in `__tests__/AddBoardDialog.test.tsx`, and
`routes/settings.meeting-notices.tsx`, pinned in `routes/__tests__/settings.meeting-notices.test.tsx`
— both had shipped their `pathFilter()` call without the pin and were caught in review; both
verified the identical way. Six writers carry the pin as of `2d78964`. That roster is what goes
stale first, not the pin discipline itself — re-run `grep -rl "\.pathFilter()" packages/web/src`
rather than trust the count above staying current.

**Write the pin the same commit a writer's `pathFilter()` call lands, not on a later wave.** These
six calls already exist and already serve an already-migrated screen; deferring the pin to
"whichever wave migrates \[the screen]" is what let a reviewer delete one and get 947 green tests
in the meantime. A wave that adds a new writer against an already-migrated read owes it the pin in
the same commit, for the identical reason.

**`pathfilter-pin-coverage.test.ts` mechanizes this discipline, and its own credit is per TEST FILE,
not per writer inside it — named in wave 3's Task 0.** If a test file imports writer A (and
genuinely asserts `isInvalidated`/`countFor(` about A's own key) and ALSO imports writer B — for any
reason, including one that has nothing to do with B's own `pathFilter()` call — B is credited as
pinned too, purely because the file contains SOME invalidation assertion and SOME import of B.
Proven as a fixture, not asserted: `pathfilter-pin-coverage.test.ts`'s own "credits an unrelated
writer merely for being imported alongside a genuinely-pinned one" test constructs exactly this case
and shows it passes. Not audited against every real writer in the tree to confirm none currently
rides on this hole in practice — that would be the per-mutation deletion sweep two paragraphs up,
scoped to cache invalidation generally, not this specific credit-bleed shape — so treat this as a
known mechanism limit, not a claim that HEAD is clean of it. Item 14's deletion sweep is the backstop
either way. Recorded here rather than only in the check's own header because a reader of this
document who never opens that test file should not have to rediscover the limit by tripping over it.

### The floor

If a payload genuinely cannot go through `installTRPCFetchStub`, it still carries
`satisfies inferProcedureOutput<...>` (or `satisfies RouterOutputs["router"]["procedure"]`, which
`packages/web/src/lib/trpc.ts` exports for exactly this). A mocked payload with no `satisfies` is
not reviewable.

**A green vitest run is not a typecheck.** `satisfies inferProcedureOutput<...>` is checked by
`tsc`, not by vitest — vitest transpiles and runs the file without ever evaluating a `satisfies`
clause. Unit 0's own final fix wave shipped two pin tests with an under-typed `setQueryData`
payload: vitest passed both, and only `npx turbo run typecheck --force`, run as its own step,
caught the gap. Run typecheck separately every time; a passing test run says nothing about whether
a payload still matches the procedure's real shape.

---

## 9. The test harness — settled, not left to each file

### QueryClient: use `setupAppQueryClient()`

`packages/web/src/test/render.ts` builds a fresh `QueryClient` per render, but `lib/trpc.ts` binds
its options proxy to the singleton in `lib/queryClient.ts`, and every `clientLoader` calls
`ensureQueryData` on that same singleton. A tRPC screen rendered under a _different_ client has the
loader priming one cache and the component reading another.

Task 4 worked around it by calling `queryClient.setDefaultOptions({...})` on the production
singleton in its own `beforeEach` and never putting them back. Safe only under vitest's per-file
isolation — and about to be copied eighty times. **Decided and implemented in unit 0:**
`renderWithProviders` now takes a `queryClient`, and `setupAppQueryClient()` borrows the singleton
for one file with save/restore on both edges.

```tsx
import { renderWithProviders, setupAppQueryClient } from "@/test/render";

const queryClient = setupAppQueryClient();

renderWithProviders(<BoardDetailPage {...props} />, { route: "/boards/b1", queryClient });
```

It installs `retry: false, staleTime: 0, gcTime: Infinity`, clears the cache before and after each
test, and restores the production defaults in `afterEach`.

**Collection scope, once per file** — the same rule as `installTRPCFetchStub`, enforced the same
way: it registers lifecycle hooks, vitest ignores hooks registered during a running test, and a
silently-skipped `afterEach` here means the production singleton keeps test defaults for the rest
of the process. It throws if called from inside a test body.

`gcTime: Infinity` — not the `0` that `createTestQueryClient()` uses — is deliberate, and the
hazard is subtler than "the test breaks". A per-render client dies with the test, so immediate
collection costs nothing there. Here the cache outlives the render, and an invalidation assertion
reads a query with no observer left: under `gcTime: 0` that entry is already collected and
`getQueryState()` answers `undefined`.

The `.toBe(true)` assertion at the end of such a test fails **loudly** on that — reverting this
line turns both `ArchiveBoardDialog` tests red, which is what protects it. The quiet half is the
**precondition** those tests open with:

```ts
expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();
```

`toBeFalsy()` passes on `undefined` exactly as happily as on a real un-invalidated entry. Under
`gcTime: 0` that line stops witnessing anything at all — it no longer establishes that the entry
was cached and un-invalidated before the write, so the test's later assertion loses the baseline
it was contrasted against. Keep the setting; know which line it is protecting.

Components with no tRPC read may keep using the default fresh client.

### Identity: `vi.mock("@/hooks/useCurrentUser")`, always

**`renderWithProviders`' `user` option does not reach `useCurrentUser()`.** `MockAuthProvider`
publishes its own `AuthContext`, created in `test/mocks/auth-mock.ts`. `useCurrentUser()` calls
`useAuth()` from `@/providers/AuthProvider`, which reads a **different** context object. Passing
`user:` configures a context the component under test never reads.

This is not a hypothesis. Quoting the greps rather than the bare numbers, because the bare numbers
are exactly what drifted here — **three times now**, not twice: this section's own previous count
(17 / 8 / 3) was already stale by the end of this wave, which alone added 18 new test files. Re-run
these before citing them anywhere else; the figures below are current as of `2d78964` and nothing
pins them to stay that way — the commands are what stay true:

```
$ grep -rl "renderWithProviders(" packages/web/src | grep -v test/render.ts | wc -l
35
$ grep -rl 'vi.mock("@/hooks/useCurrentUser"' packages/web/src | grep -v test/render.ts | wc -l
12
$ grep -rl 'vi.mock("@/hooks/useCurrentUser"' packages/web/src | grep -v test/render.ts \
    | xargs grep -l 'vi.mock("@/providers/AuthProvider"' | wc -l
3
```

The second grep, run unfiltered against `test/render.ts`, answers 13 — that file's own doc comment
above quotes the `vi.mock` call as prose, and a bare grep cannot tell a comment from code. Exclude
it. (The first grep needs the same exclusion for the same reason: `render.ts` also quotes
`renderWithProviders(...)` in its own doc comments and defines the function itself, so it matches
without being a caller.)

Of the 35 files that call `renderWithProviders` (up from 17 when this item was first written — this
wave's 18 new test files roughly doubled it), not one reaches `useCurrentUser` through
`MockAuthProvider`: the files that depend on identity mock the hook directly (12 repo-wide, up from
8), and the 3 that also mock `@/providers/AuthProvider` return a literal from `useAuth` rather than
routing to `useMockAuth` — that count has not moved. `useMockAuth` has **zero callers** outside its
own module. `MockAuthProvider` is inert everywhere it is used — see the Known gaps entry below for
what "everywhere" is countable as.

The rule for Phase E is therefore one mechanism, the one that works:

```tsx
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));
```

Do not add a second. (Retiring `MockAuthProvider` entirely is worth doing, and was not done here.)

---

## 10. The column-parity audit covers props, not just JSX

Task 4 audited every field the screen itself reads and still shipped a regression, because
`ArchiveBoardDialog` read `board.town_id` off an object the screen passed down. `board.detail` does
not select `town_id`; the prop was typed `Record<string, unknown>`, so the read compiled and
produced `""`, invalidating `["boards","byTown",""]` instead of the real list key. An archived
board kept appearing on `/boards` for up to a minute.

**Audit the props you hand to children, not only the JSX in the file you are editing.**

**A child component receiving a tRPC payload must take `inferProcedureOutput<...>`, never
`Record<string, unknown>`.** The bag type is what made it silent.

```ts
// packages/web/src/lib/trpc.ts
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// packages/web/src/components/boards/ArchiveBoardDialog.tsx
interface ArchiveBoardDialogProps {
  board: RouterOutputs["board"]["detail"];
  /** The caller's own town id — NOT read off `board`. */
  townId: string;
  // ...
}
```

Verified by mutation: reintroducing `String(board.town_id ?? "")` is now
`TS2339: Property 'town_id' does not exist on type '{ id: string; name: string; ... }'`.

A caller still on untyped Supabase rows casts at its own call site, visibly and with a comment —
`routes/boards.tsx` does this at two call sites. Never widen the child's prop type back to the bag
to accommodate it; that is reintroducing the bug for every future caller.

---

## 11. Partial migrations need a machine-checkable marker

A file that keeps some Supabase calls because no procedure exists yet must carry a grep-able
token:

```ts
// TODO(phase-e-wave-2): town.detail, agendaTemplate.countForBoard
```

Task 4 left a careful ten-line prose comment and no token, and a completeness sweep would have read
that file as done.

Quote the grep, not the number — the count moves with what you match, which is half the reason
"82 files" drifted for so long:

```
$ grep -rl "@/lib/supabase" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
24
$ grep -rl "lib/supabase\|useSupabase" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
59
```

(Re-run at Task 5, the close of wave 1: 24 and 59, down from 26 and 63 at Task 2's fix round, which
was itself down from 67 one wave earlier. Quote the grep, not the number, is the rule this drift
itself demonstrates: re-run it rather than trusting any of these three figures.)

Do NOT run `grep -rn "TODO(phase-e-wave" packages/web/src | wc -l` and report the raw number as
"how many gaps remain" — corrected here after the first version of this document did exactly that
and reported **15**, which a reviewer showed measures the wrong thing. That count mixes actual
markers with PROSE MENTIONS of a marker (a header comment saying "see the `TODO(phase-e-wave-2)`
marker below," a test file's own comment citing one) — of the 15, only 8 are lines where the
comment's content actually IS the token, and even that undercounts distinct GAPS by one:
`AddPersonDialog.tsx` carries the identical marker twice (its file-header doc comment at line 14 AND
an inline comment at line 126, both `invitation.insert`) for what is one gap, not two. The
grep that isolates real markers — anchored so the comment's own first word must be the token, not a
sentence mentioning it — answers 8:

```
$ grep -rnE "^\s*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l
8
```

**Stale as of wave 2's own final fix round — corrected here, and timestamped the way item 9
timestamps its greps (item 9: "current as of `2d78964`"); this enumeration read as current and was
not.** The 8-lines-7-gaps count above was wave 2 Task 4's snapshot and drifted the same task it was
written in: `boards.$boardId.tsx`'s `agendaTemplate.countForBoard` and `ProgressChecklist.tsx`'s
`boardMember.countByTown` both closed (Tasks 2 and 3 respectively — before this enumeration was even
written), `StaffAccountFlow.tsx`'s `board.listByTown` marker closed the same way (Task 3), and
`settings.town.tsx`'s `board.byTown` marker closed too (its own Known-gaps entry above already says
so). Re-run at HEAD, this fix round's own commit (`bb60e295b8ebc81e26a03206dcac6aaa6548c8ed`):

```
$ grep -rnE "^\s*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l
6
```

Those 6 lines name 5 distinct gaps: `AddPersonDialog.tsx` (`invitation.insert`, marked twice),
`home.tsx` (`meeting.byTown` / `minutesDocument.pendingByTown` / `board.listActive` — exists, not
wired here, see the Known-gaps bullet below), `boards.$boardId.templates.$templateId.edit.tsx`
(`agendaTemplate.detail` / `agendaTemplate.update` — a marker this same review round added; see its
Known-gaps entry below), `boards.$boardId.tsx` (`town.detail` — exists, not wired here; this
review round restored the marker after closing the file's other gap silently dropped it, see its
own Known-gaps entry below), and `people.tsx` (`boardMember.listByTown`). Whether the count is 15,
8, 7, 6, or 5 depends entirely on what you constrain the grep to and when you ran it — quote the
grep AND the commit, always, and prefer describing the gaps by name (as the bullets below do) over
reporting a bare count that a reader cannot check without also re-deriving which lines you meant.

This countdown is not monotonic within a wave regardless of which grep measures it — a task can
legitimately raise it by naming a gap explicitly that was previously silent (Task 5 added
`ProgressChecklist.tsx`'s `memberCount` gap while closing `home.tsx`'s town-header read). It only has
to reach zero once `packages/web/src/lib/supabase.ts` itself is deleted (see this item's own closing
paragraph); tracking it per-task is for visibility, not for proving progress every single time.

The second is the honest denominator: `useSupabase()` is a one-line re-export of the same client,
and a file reaching it that way is no more migrated than one importing directly.

Track `grep -rn "TODO(phase-e-wave" packages/web/src` as a countdown to zero. It reaches zero at
the same moment `packages/web/src/lib/supabase.ts` is deleted, which is the phase's real
definition of done — with the client gone, a screen that still depends on it is a build error
rather than a silent zero-row read.

---

## 12. Which error surface is canonical

Both surfaces are needed, and they handle different moments:

| Surface                     | Handles                                                                                                                                                                                              | Where                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `RouteErrorBoundary`        | A rejection **before mount** — the `clientLoader`'s `ensureQueryData` throwing NOT_FOUND for a deleted or foreign row. There is no component yet, so there is no in-component branch to run.         | `export { RouteErrorBoundary as ErrorBoundary }` at the bottom of the route module. Let the loader reject; do not catch. |
| In-component `role="alert"` | A failure **after mount** — a refetch, a `staleTime` expiry, a query the loader did not prime (`stats`, `recentMeetings`), a tab-gated query firing later. The boundary is not re-entered for these. | The `isBoardError` branch of item 5.                                                                                     |

A migrated screen ships **both**. Neither substitutes for the other, and eighty screens will
diverge if each author picks one.

---

## 13. The rule that outranks the rest

**For every security-relevant assertion, delete the guard and watch the test go red before
believing it.** Then restore it and diff byte-identical.

This is a live habit in this repo because the alternative has already happened here, four times:

1. A `notification-service` suite written on a mock that could not express the bug it covered.
2. `lib/push.ts` mocked wholesale, leaving zero executed coverage of the module under test.
3. A portal search test whose fixture made its assertion vacuous.
4. An admin-gates test that iterated the very list it was testing, so it agreed with itself.

Unit 0 added a fifth to the list before it was fixed: 940 tests that could not notice a deleted
cache invalidation (item 8).

A sixth, also from unit 0's own final fix wave: two pin tests carried an under-typed `setQueryData`
payload, and vitest passed both. A green vitest run is not a typecheck — vitest never evaluates a
`satisfies` clause, it only runs the code around it. Only `npx turbo run typecheck --force`, run as
its own step, caught the gap (see item 8's floor). Believing "tests pass" without also running
typecheck is the same mistake as believing a mutation went red without watching it happen.

A rewritten test is not a migrated test. The remaining Supabase-mocking test files are
**rewritten**, not adapted — an adapted chainable mock is how each of the four above began.

Mutations performed in unit 0, all red then restored:

| Guard deleted or changed                                         | Result                            |
| ---------------------------------------------------------------- | --------------------------------- |
| `isBoardError` render branch                                     | `Unable to find role="alert"`     |
| `ArchiveBoardDialog`'s `trpc.board.pathFilter()` line            | invalidation test red             |
| `queryKeys.boards.byTown(townId)` → `byTown("")`                 | legacy-key test red               |
| `trpc.board.pathFilter()` → `trpc.town.pathFilter()` in the test | `expected 1 to be greater than 1` |
| `name:` → `nayme:` in a stub payload                             | `TS2322`                          |
| `"board.stats"` → `"board.statz"`                                | `TS2353`                          |
| a pinned procedure renamed in the router                         | `router-wiring.test.ts` red       |
| `board.town_id` reintroduced in `ArchiveBoardDialog`             | `TS2339`                          |
| `assertCollectionScope` guard removed from the stub              | scope test red                    |
| the stub's per-test call-log reset removed                       | `expected 2 to be 1`              |
| the stub's `afterEach` fetch restore removed                     | `afterAll` red: `[Function Mock]` |

Two of those were found by mutating something that had just been written and was passing. The
`TestHandlers` type originally keyed off `AppRouter["_def"]["procedures"]` directly: it compiled,
the tests passed, and it checked **nothing** — that type is nested, so `"board.detail"` was never
a key and `inferProcedureInput` of a sub-router is `never`. The tell was the error message naming
`board` rather than `board.detail`. The harness scope bug was the same shape: green, and untrue.

A seventh, from Task 2's fix round (wave 1): the same wave's own regression-pin test for
`town.updateProfile` asserted `BAD_REQUEST` on input that failed to parse, and "delete the guard
and watch it go red" was never actually run against it before it shipped. A reviewer ran it: with
`assertCanUpdateTown` deleted entirely, the test **stayed green**, because the parser alone still
answers `BAD_REQUEST` for bad input whether or not a guard exists to run first. This is what item 2
now states as the general rule and repeats here because test discipline is where people look for
it: **a refusal test must assert `FORBIDDEN`, full stop.** Not "on input that parses" — that
qualifier was itself an over-correction from the same fix round (see item 2), and stated as an
absolute it would have forbidden the very test that fixes this: the reorder pin below is built on
input that does NOT parse, on purpose, because that is the only way to catch a guard declared after
`.input()` instead of before it.

**A guard can be deleted-and-caught while still being misplaced, and item 13's own mutation does
not by itself tell the two apart.** Deleting a guard proves it existed. It says nothing about WHERE
it was declared, because deletion removes the guard from both a correctly-ordered and a
wrongly-ordered procedure identically. The same reviewer proved this on `town.updateProfile`
directly: moved its `.use(requireActor(...))` from before `.input()` to after it — reproducing the
exact shipped defect on live code, not a synthetic router — and ran the whole API package.
**42 files, 565 tests, all green.** Every existing refusal test on that procedure used input that
parses, so none of them could see the reorder; the parser still ran and, for valid input, still
succeeded either way. The fix was a SECOND kind of pin, not a stronger version of the first: a test
whose input does NOT parse, so that a guard which no longer runs before the parser is answered by
the parser (`BAD_REQUEST`) instead of the guard (`FORBIDDEN`) — see `town.updateProfile`'s "answers
FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)" in
`packages/api/src/trpc/routers/__tests__/town.test.ts`, and the equivalent in
`require-permission.test.ts`'s synthetic router. Verify a reorder pin the way the deletion pin is
verified — move the `.use()` after `.input()`, confirm the specific test (and only that shape of
test) goes red, restore.

If your mutation does not go red, you have not written a test. You have written a comment that
runs.

---

## 14. The close-out step: re-check every Known-gaps bullet against HEAD

Added in wave 2's final whole-branch review, after that review found **four of the five most
recent Known-gaps bullets stale — three of them CLOSED and still described as open**
(`boards.$boardId.tsx`'s agenda-template half, `ProgressChecklist.tsx`'s `memberCount`,
`StaffAccountFlow.tsx`'s board picker) and one actively **wrong** rather than merely outdated
(`home.tsx`'s board-picker bullet kept insisting no archived-filtered procedure existed after
`board.listActive` shipped and was already wired into the identical gap one file over). A fifth
bullet — item 11's own marker enumeration — was stale in the same review for the identical reason:
it quoted a marker count that had already moved by the time it was written.

**The root cause is structural, not a discipline lapse a reminder fixes.** Every task in this wave
amended `phase-e-conventions.md` when its OWN work touched a bullet — closing the bullet it was
told about, adding the bullet its own file's remaining gap needed. No task's job was ever "does
anything ELSE in this document describe my work as still open." A bullet written by Task N about a
file Task N did not finish stays exactly as Task N left it, word for word, until something
_deliberately_ re-reads it against the current tree — and nothing in the per-task workflow asked
anyone to do that, so it did not happen, four times in a row, across three different tasks' own fix
rounds.

**The step:** before ending a task (or a fix round) that touches `phase-e-conventions.md`, or before
closing out a wave, re-read every bullet under "Known gaps this document does not close" against
HEAD — not against memory, not against what the task itself changed — and retire (with the
`~~strikethrough~~ ... closed in Task N` pattern already used throughout this document) any bullet
this wave's work closed, whether or not the task that closed it was the one that wrote the bullet.
A bullet is stale exactly as easily by someone else's fix landing nearby as by the task that named
it forgetting to update it — check the file, not the diff.

This is intentionally scoped to Known-gaps, not "audit the whole document every time" — item 11's
own countdown grep already does the analogous job for `TODO(phase-e-wave-*)` markers in the
CODEBASE; this step is the same discipline applied to the PLAN DOCUMENT's own claims about that
codebase, which no automated check can verify because "is this bullet's prose still true" is not a
grep-able property.

---

## Files to copy from

| Concern                                                  | File                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Router, explicit columns, `NOT_FOUND` parity             | `packages/api/src/trpc/routers/board.ts`                                   |
| Procedure-name pin                                       | `packages/api/src/trpc/__tests__/router-wiring.test.ts`                    |
| Client, `RouterOutputs`                                  | `packages/web/src/lib/trpc.ts`                                             |
| Migrated screen: loader, three states, tab-gated query   | `packages/web/src/routes/boards.$boardId.tsx`                              |
| Screen test: real proxy, stubbed transport, invalidation | `packages/web/src/routes/__tests__/boards.$boardId.test.tsx`               |
| Writer test: pins an invalidation                        | `packages/web/src/components/boards/__tests__/ArchiveBoardDialog.test.tsx` |
| Test harness                                             | `packages/web/src/test/trpc.ts`, `packages/web/src/test/render.ts`         |
| Typed props into a child                                 | `packages/web/src/components/boards/ArchiveBoardDialog.tsx`                |

## Known gaps this document does not close

- ~~The board-scoped authorization form in item 2 is fixed and unit-tested ... but still has **zero
  call sites in a real procedure** — no shipped router calls `requireBoardPermission` yet.~~ —
  **closed in wave 3, Task 1.** `meeting.insert` (`packages/api/src/trpc/routers/meeting.ts`) calls
  `requireBoardPermission("A1", boardIdFrom())` for real, and the case this whole mechanism exists
  for — a revoking board override refusing on the barred board while still allowing the same actor
  elsewhere — is exercised by a real procedure for the first time (`meeting.test.ts`'s "honours a
  REVOKING board override" tests, on both `insert` and `cancel`). See wave 3's Task 1 report for what
  this first real use found item 2 got right and wrong. Not fully closed, though: `cancel` does NOT
  use `requireBoardPermission` — `assertCanUpdateMeeting` is admin-OR-A1-OR-M1, not one code, so it
  needed a fourth guard shape (a `BoardScope`-taking local middleware, `meeting.ts`'s own
  `requireCanUpdateMeeting`) that item 2 does not yet catalogue. `requireBoardPermission` itself has
  exactly one real call site as of this task; the broader claim "the board-scoped mechanism has real
  users" is now true, but "every board-scoped write fits the two shapes item 2 names" is not.
- `assertCanSelectTownNotificationConfig` / `assertCanInsertTownNotificationConfig` /
  `assertCanUpdateTownNotificationConfig` are tested as pure functions
  (`packages/api/src/trpc/__tests__/admin-gates.test.ts`) but **no procedure calls them** — wave 1
  Task 4 built one, a reviewer proved it was the wrong direction, and it was deleted. The reasoning
  that survives, for whichever wave builds the real screen: `town_notification_config`'s RLS
  (`town_notification_config_tenant_isolation`, `0000_baseline.sql`) is **tenancy-only** over the
  town's SMTP/Twilio credentials, exactly like `board`'s policy — but unlike `board`, tenancy is not
  enough here, and today NOTHING client-reachable queries this table at all (the browser's Supabase
  client sends no service credential, so a request against it resolves no rows). Do not pattern-match
  `board.ts`'s "no guard, tenancy is enough" comment onto this table: that reasoning is exactly how an
  implementer ships a `select` that hands the raw Postmark token to any admin's browser, turning zero
  client exposure into admin-gated-but-still-client-reachable exposure — a real improvement over an
  ungated read that does not exist, and still the wrong direction for a screen nobody has designed.
  Separately, and worth recording rather than fixing in passing: the column is named
  `postmark_server_token_encrypted` and its own DB comment says "decrypted only at send time," but
  nothing in this repository encrypts or decrypts it — `lib/postmark.ts` reads and uses it as a
  plaintext token (see that file's own doc comment). Any future write path for this column inherits
  that contradiction and should not paper over it.
- ~~`setPortalAddress` is still resolver-form~~ — **closed in Task 5.** Converted to
  `.use(requireActor(assertCanUpdateTown)).input(...)`, and the schema tightened from a bare
  `z.string()` to `min`/`max` on `SUBDOMAIN_MAX_LENGTH`, which is what let the reorder pin exist at
  all (`packages/api/src/trpc/__tests__/town-portal-address.test.ts`) — see `town.ts`'s own doc
  comment on that procedure. Same task also gave it its first UI caller ever
  (`SetPortalAddressModal.tsx`, opened from `ProgressChecklist`'s "portal-subdomain" row) — the
  mutation had existed since Phase D with nothing in the product able to call it.
- `TestHandlers` rejects a missing field but accepts an extra one (item 8).
- `test/trpc.ts`'s `TestErrorCode` union had five members, not every code a real procedure can
  answer — found in Task 5 writing `SetPortalAddressModal.test.tsx`, the first test in this codebase
  to simulate a MUTATION's error response rather than a query's. **Corrected here after the review
  round: the first version of this bullet claimed `trpcTestError("CONFLICT")` "typechecked fine (the
  string is not itself constrained at the call site)" and called the gap "not a compile-time gap."
  Both halves are false, and `test/trpc.ts`'s own doc comment on `TestErrorCode` now says so — this
  bullet previously contradicted it.** `trpcTestError`'s parameter is plainly typed `TestErrorCode`,
  and `TestHandlers`' own typing infers a handler's input/output from the real router, so a string
  literal outside the union was never going to compile; verified by mutation, removing `| "CONFLICT"`
  from the union answers `TS2345: Argument of type '"CONFLICT"' is not assignable to parameter of
type 'TestErrorCode'` at the `SetPortalAddressModal.test.tsx` call site and `TS2353: ... 'CONFLICT'
does not exist in type 'Record<TestErrorCode, number>'` in `test/trpc.ts` itself — the check is in
  the function signature, not in `TestHandlers`, and it fires at the call site. What actually
  happened: `SetPortalAddressModal.test.tsx` was written and run with `vitest` alone, which does not
  evaluate types, so the missing union member surfaced instead as a confusing RUNTIME failure —
  `@trpc/client`'s own `transformResult` throwing `TransformResultError` ("Unable to transform
  response from server"), because `code: undefined` reached it before the type question was ever
  asked. Seeing a confusing runtime failure and concluding something about the type system without
  running `tsc` first is exactly the mistake item 8's "floor" section warns against — a green vitest
  run is not a typecheck, and a RED vitest run is not a type verdict either. The union genuinely was
  incomplete, though — that part of the original diagnosis holds, and closing it is real work, not a
  false alarm: fixed by adding `CONFLICT` to the union and both records (`-32009` / `409`, from
  `@trpc/server`'s own `TRPC_ERROR_CODES_BY_KEY`) — a three-place edit (the union, `JSONRPC_CODE`,
  `HTTP_STATUS`) — and the same shape of gap exists for every other `TRPC_ERROR_CODE_KEY` this
  harness does not yet list (`PAYMENT_REQUIRED`, `PRECONDITION_FAILED`, `TOO_MANY_REQUESTS`, …) — add
  the next one the same way, at the point a real procedure needs a test to simulate it, not
  preemptively.
- `MockAuthProvider` is directly named in 4 files (`grep -rl "MockAuthProvider" packages/web/src`:
  `test/render.ts` and `test/mocks/auth-mock.ts`, where it is defined and wraps every render, plus
  `PermissionGate.test.tsx` and `boards.$boardId.test.tsx`, the two tests that reach it by name). It
  is inert in all of them per item 9. The other `renderWithProviders` callers receive it too, just
  implicitly — `render.ts` wraps every render in it unconditionally — so retiring it touches every
  caller, not only the 4 that name it.
- `router-wiring.test.ts` pins only the procedure names it lists.
- ~~`cache-key-parity.test.ts` (item 7) checks only that a `pathFilter()` call exists in the file —
  not that every `pathFilter()`-calling writer is itself pinned by a writer test (item 8).\*\*
  ... Deliberately not shipped this round ... Available as a starting point for whichever wave next
  hits this gap, not as a finished check.~~ — **shipped in this wave's final whole-branch review**,
  as `packages/web/src/lib/__tests__/pathfilter-pin-coverage.test.ts`: for every non-test file whose
  comment-stripped code calls `trpc.<router>.pathFilter()`, at least one test file must import it (a
  static `from "..."` or a `vi.mock("...")`, resolving both `@/` and relative specifiers) and itself
  assert `isInvalidated` or call `countFor(`. Matching by import graph rather than filename was
  deliberate — a filename-only matcher fails on `routes/boards.$boardId.templates.$templateId.edit.test.tsx`
  (lives outside any `__tests__/` directory) and would be fooled by a plausible-but-wrong name like
  `Foo.pathfilter.test.tsx` that does not actually import `Foo.tsx` (see the check's own fixture
  tests for both). Comment-stripping is load-bearing the identical way item 11's marker grep needs
  it to be: without it, `routes/people.tsx` and `test/trpc.ts` both false-positive as writers because
  each mentions `trpc.<router>.pathFilter()` in a comment, not real code — 28 files contain the raw
  substring at HEAD, 26 after stripping, and 26 is the number the check's own history-validation
  section (below) confirms is right. Validated against `git archive` snapshots of three real commits,
  not assumed: HEAD (26 writers, 0 violations), `3b22df8` (16 writers, 3 violations —
  `AddMemberDialog.tsx`, `MemberArchiveDialog.tsx`, `MemberTransitionDialog.tsx`), `081a27e` (25
  writers, 1 violation — `MemberRoster.tsx`) — all three matching this wave's own named findings by
  file and by count, the same discipline `cache-key-parity.test.ts`'s own history section uses.
  **Still bounded exactly as originally scoped**, and the boundary is worth restating precisely: a
  test that imports the writer and asserts `isInvalidated`/`countFor(` ANYWHERE in the file passes,
  even for a totally unrelated procedure — this reaches item 8's "a writer is tested at all", not the
  harder claim "the RIGHT procedure is tested". See the next bullet for why that harder claim is not
  worth chasing with a static check, and what to do instead.
- **The per-mutation half — "is the RIGHT procedure being pinned, not just A procedure" — is not
  statically mechanisable, and this wave's review tried before concluding that.** Task 3's real
  failure (three of nine invalidations shipped unpinned, INSIDE files that already had other pins —
  so a whole-file "does this file call `pathFilter()` and does some test in it assert an
  invalidation" check would have called those files fine) is exactly the shape the check above
  cannot see: the file-level pin exists, it is just pinning a different mutation than the one that
  shipped broken. A prototype requiring a test to name the SPECIFIC procedure it is asserting on
  (e.g. matching `stub.countFor("board.detail")`'s string literal against the particular
  `pathFilter()` call's router) caught **nothing** beyond what the coarser check above already
  catches, because `installTRPCFetchStub`'s handler map already keys on every real procedure path —
  a test asserting the wrong procedure name would not compile in the first place (the same shape
  item 8's own "`board.statz`" mutation example demonstrates), so there is no "names the wrong
  procedure and passes" failure mode left for a stricter static check to add value against. What
  actually catches a missing invalidation on a specific mutation, proven by Task 3's own fix round,
  is a **scripted deletion sweep** run as a close-out step, not a new assertion shape: comment out
  each `pathFilter()` call one at a time (`~21` sites at HEAD — `grep -rl "\.pathFilter()"
packages/web/src | grep -v __tests__ | grep -v '\.test\.'`, minus the two comment-only false
  positives item 4's own check already excludes), run the web suite, confirm something goes red,
  restore. At roughly 10 seconds per site that is about 4 minutes for the whole tree — cheap enough
  to run as a matter of course before closing out a task that touched cache invalidation, and it is
  the only thing in this document that has actually caught a missing-but-plausible-looking pin.
- **Re-checked in the wave's final whole-branch review (current as of `9e87b7b`) — four of the
  five bullets that used to sit here were stale, three of them CLOSED and described as open. This
  is exactly the drift item 14 above (the standing close-out step) exists to catch, and the fact
  that four slipped through at once is why that step got added.**
- `boards.$boardId.tsx`: the agenda-template-count half of the old two-item bullet here is
  **closed** — `agendaTemplate.countForBoard` is wired (in the `Overview` tab's template-count
  `useQuery`) and the file's marker naming it is gone, exactly as an earlier version of this bullet
  predicted it would be. The
  town-settings half is still open — `town.detail` shipped in Task 1 but this file has not been
  migrated onto it (real work: retyping two components' props, re-checking the effective-settings
  mapping) — and **closing the other half had silently dropped this file's marker entirely**, which
  the whole-branch review caught as its own small instance of item 11's hole: `town.detail` existing
  elsewhere reads as "done" to a bare grep unless the file's own marker says otherwise. Restored:
  `// TODO(phase-e-wave-2): town.detail (exists, not yet wired here for the Overview "effective
settings" read)`.
- ~~`home.tsx` ... The board picker still needs its own procedure (an archived-filtered
  `board.listActive` or an `activeOnly` argument on `board.list`), not a reuse of the existing
  one.~~ — **Wrong as of Task 4, not just stale wording: `board.listActive` shipped there, doing
  exactly the archived-filtering job this bullet said did not exist yet, and Task 5 wired it into
  `StaffAccountFlow.tsx`'s identical picker gap (see the next bullet) in the very same task that
  last touched this sentence.** `home.tsx` itself was rewritten by this wave's own final commit
  (`9e87b7b`) — two commits after `board.listActive` shipped, one after `StaffAccountFlow` started
  using it for the identical gap — and its comment still claimed no such procedure existed; the rot
  here was being actively refreshed, not merely left alone. Corrected directly in `home.tsx` and its
  marker in this same round: `board.listActive` exists and is not a blind swap, because its ordering
  (governing board first, then alphabetical — see its own doc comment) differs from this picker's
  plain `.order("name")`, a real behavior difference whoever migrates this file next needs to check,
  not a missing procedure. ~~`meetingRows`/`minutesDocs` still have no router at all
  (`meeting`/`minutesDocument`) and stay open exactly as before.~~ — **`meetingRows`'s half closed in
  wave 3, Task 0/1**: a `meeting` router now exists (`packages/api/src/trpc/routers/meeting.ts`,
  Task 1) and `home.tsx`'s own marker was retagged to say so (Task 0) — the screen itself is not
  wired onto it yet (that is Task 2 territory and explicitly out of this wave's Task 1 scope), only
  the marker's claim changed. `minutesDocs` still has no router at all and stays open, now scoped to
  wave 6 in `home.tsx`'s own retagged marker (that wave owns `minutes.tsx`/`review.tsx` per this
  wave's own plan).
- ~~`ProgressChecklist.tsx` (Task 5) ... Its third, `memberCount` ... stays on Supabase ... Marked
  `// TODO(phase-e-wave-2): boardMember.countByTown (or equivalent)`.~~ — **closed in Task 3.**
  `boardMember.memberCount` (the relocated procedure — see `board-member.ts`'s own header, "Task 1,
  wave 2") is what `ProgressChecklist.tsx` reads today, in its "board members added" progress row's
  `useQuery`, and the file carries no `TODO(phase-e-wave-2)` marker any more. This bullet described
  a gap Task 3 had already closed by the time it was written.
- ~~The wave inherited one existing, unrelated staleness ... `StaffAccountFlow.tsx`'s ...
  marker ... Left for whichever wave touches that file next.~~ — **closed in Task 3.**
  `StaffAccountFlow.tsx` was in Task 3's own file list (`081a27e`, `f80a074`) and now reads
  `trpc.board.listActive.queryOptions()` in its board-picker `useQuery`, with no
  `TODO(phase-e-wave-2)` marker left. "Left for whichever wave touches that file next" was true when
  Task 4 wrote it and false one task later — the exact shape of drift the standing close-out step
  (item 14) exists to catch before it reaches a fifth or sixth wave.
- **Named wave-2 item: `SetPortalAddressModal` has exactly one door, and it disappears.**
  `ProgressChecklist`'s "portal-subdomain" row (`onSetPortalAddressClick`) is the ONLY UI path to
  `SetPortalAddressModal` anywhere in the product. Once every checklist item is complete — not
  hypothetically; this is the intended end state of onboarding — `ProgressChecklist` stops rendering
  the row list at all (see the next bullet) and nothing else opens that modal, so an administrator
  who wants to CHANGE an already-set subdomain later has no path to do it. `RetentionPolicyModal` has
  the identical one-door shape and it is fine there, because retention acknowledgment is genuinely
  one-time; a portal subdomain is not — the product may need to rename a town, correct a typo, or
  free up a name. Reviewer's recommendation, to save whoever picks this up from re-deriving it: the
  right home is a permanent field in `settings.town.tsx`'s "Your Town" `SettingsSection` (next to
  town name/state/municipality — see that section's existing `summary`/`editor` shape), not another
  onboarding-checklist row — an administrator looking to rename their portal address would look in
  town settings, not in a setup checklist they already finished. Not built in Task 5: out of that
  task's two named files (`routes/home.tsx`, `components/dashboard/ProgressChecklist.tsx`), and
  `settings.town.tsx` is a third file with its own accordion sections this task did not otherwise
  touch beyond mounting the modal itself.
- **`ProgressChecklist`'s "all complete" state is a swap, not a disappearance — precise mechanism,
  since a wave-5 report first stated this imprecisely and a reviewer corrected it.** When
  `completedCount === items.length`, the component does not render nothing: it renders a _different_
  card ("Setup complete!", `PartyPopper` icon, two lines of static text) in place of the checklist
  rows. The user-visible effect is the same either way — the "portal-subdomain" row, and every other
  row, stops being reachable — but "the card hides" and "the card is replaced by a different card"
  are different claims, and only the second is what the component's own `if (allComplete) { return
<Card>...</Card>; }` branch actually does.
- **Both doors from staff to board_member dead-end at `RoleConflictDialog`.** Wave 2, Task 3 shipped
  `AddMemberDialog`'s server-side mutual-exclusivity check in `boardMember.addBoardMember`
  (`packages/api/src/trpc/routers/board-member.ts`), and a review round of that same task found the
  archived-account-reuse defect immediately upstream of it (sequenced here for exactly that reason —
  both are the same underlying question: what does an EXISTING `user_account` row mean when a new
  write wants to seat its person as something else). `RoleConflictDialog.tsx`'s `archiveAccount`
  mutation only sets `archived_at` on the conflicting account; it does not delete the row, and
  `user_account_person_id_key` is unique on `person_id` alone, unfiltered by `archived_at`. So after
  an admin resolves a staff→board_member conflict through that dialog, the row conflicting a moment
  ago still exists with `role = 'staff'` — and `addBoardMember`'s mutual-exclusivity check (correctly)
  refuses it again, every time, with no way through. An administrator correcting a mis-assigned role
  under Maine 30-A M.R.S.A. §2605 has nowhere to go today through THIS door.

  **Corrected in Task 4, wave 2 — the sentence above about a second, identical door is wrong; the rest
  of this bullet is not.** This paragraph originally also claimed "the identical trap exists in
  `MemberTransitionDialog.tsx`'s `to_board_member` transition, which routes through the same
  `RoleConflictDialog`." Checked directly: that transition has no UI path at all — `MemberRoster.tsx`
  is the only caller of `MemberTransitionDialog`, always with `member.role: "board_member"`, and the
  dialog's own `RadioGroup` never renders a "convert to board_member" option (dead at `081a27e`,
  before this task, too — not a regression this task introduced). `handleTransitionSelect` and the
  mutual-exclusivity `useMemo` both still branch on `"to_board_member"`, so the TYPE and the dead
  branches exist, but nothing in the component ever sets `transition` to that value. There was never a
  second live door here to dead-end. **This does NOT close the bullet.** The `AddMemberDialog` door —
  `boardMember.addBoardMember`'s mutual-exclusivity check (the `checkRoleMutualExclusivity` call at
  the top of the `if (existing)` branch, which runs BEFORE that branch's reactivation logic) — still
  refuses every time, exactly as the rest of this bullet, including its last paragraph's fix-shape
  citation, already says. One of the two doors described here was never real; the other is still
  shut.

  The review confirmed `RoleConflictDialog`'s own refusal is correct and should NOT change: the old,
  pre-migration code hit this identical case as an uncaught `23505` with no `onError` and no toast at
  all — strictly worse — and the unique constraint really is unconditional, so refusing is the honest
  answer for a write that has not decided what an archived row means. Inventing an un-archive policy
  inside a port would be a design decision smuggled into a migration, which is exactly the failure
  mode conventions item 1's "the query you are replacing is a specification" exists to prevent.

  The fix shape already exists in this codebase and should not be re-derived: `MemberTransitionDialog
.tsx`'s `convertToStaff` mutation handles the MIRROR direction (board_member → staff) correctly
  already — when the person already has an account, it `UPDATE`s that row in place
  (`role: 'staff', archived_at: null, ...`) rather than archiving it and inserting a fresh one.
  `addBoardMember`'s own reuse branch was fixed the same way in the same review round (`archived_at =
NULL` on reuse, unconditionally). Whichever wave next touches `RoleConflictDialog` or the
  board_member-seating path should apply the identical "update in place" shape to the direction that
  still dead-ends, rather than treating this as an open design question — it is not; only the wiring
  is missing.

- **A task dispatch's own "measured scope" can be wrong — verify against the file, or the plan's own
  table, before trusting it (Task 4).** A dispatch summarizing this task claimed `MemberArchiveDialog.tsx`
  was "already fully migrated, 0 supabase calls" and that only 2 raw inserts remained in
  `MemberTransitionDialog.tsx`. Both were checked directly against the files (`grep -n '\.from('`,
  accounting for a `supabase\n  .from(...)` line break the naive `grep "supabase\."` the dispatch
  presumably used would miss) and were wrong: `MemberArchiveDialog.tsx` still had all 3 of its original
  sites (1 read, 2 writes, both inside one `mutationFn`) — only its writer-invalidation lines had been
  added, not its data layer; `MemberTransitionDialog.tsx` had all 7 (2 reads, 5 writes), exactly matching
  the number the MASTER PLAN's own "measured scope" table already recorded at commit `a165049` — a
  number that document had been carrying correctly the whole time. The plan document itself was the
  authority to check against, and was right; the dispatch's own restatement of it was not. Re-run the
  grep, or re-read the plan's own table, before accepting a summary's scope claim — the same "quote the
  grep, not the number" discipline item 11 already states for marker counts applies just as much to a
  file's own remaining-sites count.
- **Recompute a client's destructive-option request server-side; do not trust the toggle
  (Task 4).** `MemberArchiveDialog`'s "also archive the user account" switch is disabled client-side
  when the person holds another active board seat — but a caller bypassing that UI could still send
  `archiveAccount: true` for a person who, by the time the mutation runs, holds one. `archiveMembership`
  answers this the way `addBoardMember`'s mutual-exclusivity check already answers a stronger version of
  the same question ("check the ACTUAL database state, not what the client believes it to be"): it
  recomputes `otherActiveCount` in the same transaction and silently declines to archive the account if
  the answer disagrees with what the client assumed, rather than trusting the boolean or throwing on a
  stale value. Silent decline, not a refusal, because this is a race on informational state the client
  read moments earlier, not an authorization boundary — the caller is still allowed to archive the seat;
  only the SECOND effect (archiving the account) is the one whose precondition gets re-checked. Contrast
  with an FK from client input (item 3), which is always refused (`NOT_FOUND`) rather than silently
  adjusted, because there the caller has no legitimate reading of "the row doesn't exist right now" to
  race against — the two are different hazards and warrant different answers, not the same guard reused
  twice.
- **`AddPersonDialog.tsx`'s `invitation.insert` and `people.tsx`'s `boardMember.listByTown` markers are
  still open — checked directly in Task 4, not assumed closed by Task 3's `boardMember` router.**
  `board-member.ts`'s `insertInvitation` is a private helper used only by `addBoardMember`/
  `addStaffMember`; it is not a callable procedure `AddPersonDialog` (which never seats anyone on a
  board) could reach, and `AddPersonDialog`'s own flow — `person.insert` → `person.insertStaffAccount` →
  a bare invitation write — has no seat to hang an invitation off of the way those two do.
  `boardMember.roster` is scoped to ONE board and `boardMember.memberCount` returns a bare count;
  neither answers `people.tsx`'s actual question ("for every person in the town, which board names do
  they hold a seat on"), which needs a town-wide `board_member` JOIN `board` grouped by person — a
  procedure that does not exist yet. Both markers stay exactly as they were.
- ~~`home.tsx`'s `meeting.byTown`/`minutesDocument.pendingByTown` marker could not be responsibly
  re-labeled to a specific wave number in Task 4.~~ ... Left as `TODO(phase-e-wave-2)` — mis-scoped
  but honestly so — for whoever writes the wave 3 plan to retag with an actual number.~~ — **the wave
  3 plan this bullet was waiting for now exists, and wave 3's own Task 0 did the retag it asked for.**
  `home.tsx`'s marker is now `TODO(phase-e-wave-6)`, naming only `minutesDocument.pendingByTown` and
  the still-unwired `board.listActive` — `meeting.byTown` dropped off the list because wave 3's Task 1
  shipped it for real, not because of a re-scoping guess. `minutesDocument.pendingByTown` is tagged
  `wave-6` on the same basis this wave's own plan already states elsewhere (its "Out of scope" note:
  "`minutes.tsx` and `review.tsx` are wave 6"), not a fresh guess — the same table this bullet's
  original version was checking against, now checkable because it exists.
