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
`require-permission.test.ts`'s synthetic router, including its own reorder pin — but has **zero
call sites in a real procedure**; every real Actor-only write so far is an admin gate
(`requireActor`), not a delegable code. The board-SCOPED form specifically
(`requireBoardPermission`/`boardIdFrom` keyed to one of the 18 `BOARD_SCOPED_CODES`) is fixed and
covered by a dedicated test proving it resolves a board and refuses correctly at the corrected
position, but still has **zero call sites outside tests** — no procedure in this repo authorizes
anything board-scoped yet. The first wave to add one should expect to amend this item again, not
assume it settled. **The underlying `getRawInput()` TECHNIQUE this form popularized is a different
claim and is no longer test-only** — `person.ts`'s `requireOwnAccountColumns` (the subject-carrying
shape documented above) reads a different field off `getRawInput()` the identical way, for a
different reason, and ships in a real procedure today. Do not read "zero call sites outside tests"
as covering the mechanism in general; it is scoped to the board-scoped form specifically.

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
  // ...
};
```

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
names a `queryKeys.<namespace>` for a namespace in its hand-maintained `MIGRATED` map (currently
`towns`/`boards`/`persons`), the same file must also call the matching `trpc.<router>.pathFilter()`
somewhere. The match is scoped to roughly 250 characters measured from inside the `invalidateQueries(`
call itself, not the whole file — a whole-file version of this check raises 12 false positives at
HEAD (files that read a migrated key in a `useQuery` far from an unrelated `invalidateQueries()`
call); the windowed version raises zero.

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

Those 8 lines name 7 distinct gaps: `ProgressChecklist.tsx` (`boardMember.countByTown`),
`StaffAccountFlow.tsx` (`board.listByTown` — stale, see the Known-gaps bullet below),
`AddPersonDialog.tsx` (`invitation.insert`, marked twice), `home.tsx` (`meeting.byTown` /
`minutesDocument.pendingByTown` / a board-picker read), `settings.town.tsx` (`board.byTown`),
`boards.$boardId.tsx` (`agendaTemplate.countForBoard`), `people.tsx`
(`boardMember.listByTown`). Whether the count is 15, 8, or 7 depends entirely on what you constrain
the grep to — quote the grep used, always, and prefer describing the gaps by name (as the bullets
below do) over reporting a bare count that a reader cannot check without also re-deriving which
lines you meant.

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

- The board-scoped authorization form in item 2 is fixed and unit-tested (Task 2's fix round —
  `requirePermission`'s board extractor now reads `getRawInput()` so the form actually works
  declared before `.input()`) but still has **zero call sites in a real procedure** — no shipped
  router calls `requireBoardPermission` yet. The mechanism is proven; the first real use is not.
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
- **`cache-key-parity.test.ts` (item 7) checks only that a `pathFilter()` call exists in the file —
  not that every `pathFilter()`-calling writer is itself pinned by a writer test (item 8).** That
  second check — "does every file calling `trpc.<router>.pathFilter()` have a test that asserts the
  invalidation actually happens" — is the one that would reach "the four person writers at
  `3b22df8`" (the finding the shipped check above cannot). Deliberately not shipped this round: an
  earlier pass at it was reported to raise three false positives at HEAD and to need tuning before it
  could ship without teaching people to ignore it (item 13's exact concern with a check that cries
  wolf). Not reattempted here either — this task's brief named it explicitly out of scope. Available
  as a starting point for whichever wave next hits this gap, not as a finished check; re-derive the
  false-positive count rather than trust three.
- `boards.$boardId.tsx` still reads two things through `@/lib/supabase`: town settings (the
  Overview "effective settings" rows, and the defaults passed to
  `EditBoardDialog`/`MinutesWorkflowEditor`) and the agenda template count. **Not the same gap for
  both, as of Task 5 (confirmed, not newly true — Task 2's fix round already narrowed the marker
  this way):** `town.detail` shipped in Task 1, so the town-settings read has a procedure to move
  onto and simply has not been migrated to it yet — real work (retyping two components' props,
  re-checking the effective-settings mapping), not a missing router. The agenda-template count is
  the only one with genuinely **no procedure at all**. The file's own marker reflects exactly this:
  `// TODO(phase-e-wave-2): agendaTemplate.countForBoard` — one item, not two, and has read that way
  since Task 2. An earlier version of this bullet (through Task 4's fix round) quoted the marker as
  `town.detail, agendaTemplate.countForBoard`, which was already stale when quoted; kept accurate
  here now rather than re-drifting.
- `home.tsx` (Task 5) moved its town-name/state header onto `town.detail`, but three reads stay on
  Supabase, all named in the file's own `// TODO(phase-e-wave-2)` marker: `meetingRows` and
  `minutesDocs` have no router at all (`meeting`, `minutesDocument`); `boardRows` — the "which board
  is meeting" picker — has a near-miss in `board.list` (added by Task 4, extended by Task 5) that is
  DELIBERATELY not used, because `board.list` does not filter `archived_at` (by design — its two
  existing callers both need archived boards visible: `settings.meeting-notices.tsx`, for the "copy
  template" picker, and `ProgressChecklist.tsx`, for its totalSeats/notice-template-completion
  aggregates — the second joined `board.list` in the same task, Task 5, that wrote this bullet)
  while the picker's original Supabase query does. Reusing `board.list` here would
  silently start offering archived boards as places to schedule a NEW meeting — a regression smuggled
  into a read migration, the exact failure mode item 1's "the query you are replacing is a
  specification" language exists to prevent. The board picker still needs its own procedure (an
  archived-filtered `board.listActive` or an `activeOnly` argument on `board.list`), not a reuse of
  the existing one.
- `ProgressChecklist.tsx` (Task 5) moved two of its three own reads (`totalSeats`, the notice-
  template counts) onto the same extended `board.list`. Its third, `memberCount` — a count of
  actual, filled `board_member` rows — stays on Supabase: that table is board-membership territory
  this wave deliberately does not touch (the task brief's own self-review notes: the four
  board-member dialogs are wave 2's), and `person.ts`'s own doc comment already declines to join
  `board_member` for the identical reason. Marked `// TODO(phase-e-wave-2): boardMember.countByTown
(or equivalent)`.
- The wave inherited one existing, unrelated staleness while Task 5 was in the neighborhood:
  `StaffAccountFlow.tsx`'s `// TODO(phase-e-wave-2): board.listByTown` marker says "no procedure
  exists yet that lists every board for a town" — no longer true; `board.list` has existed since
  Task 4. **This IS the same gap as `home.tsx`'s board picker above, not a different one** —
  corrected here after a reviewer caught the first version of this bullet claiming otherwise:
  `StaffAccountFlow.tsx:64` filters `.is("archived_at", null)`, identical to `home.tsx`'s board
  picker, for the identical reason (offering an archived board as a place to assign a new staff
  account's board seat is the same wrong answer as offering it as a place to schedule a meeting).
  Whichever wave migrates this file must NOT swap it onto `board.list` as-is — that would ship
  exactly the archived-board regression Task 5 declined for `home.tsx`. `StaffAccountFlow.tsx`
  itself was not touched by this task's declared scope (`routes/home.tsx` and
  `components/dashboard/ProgressChecklist.tsx` only), so the stale comment is documented here rather
  than edited on the strength of reading it alone. Left for whichever wave touches that file next.
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
