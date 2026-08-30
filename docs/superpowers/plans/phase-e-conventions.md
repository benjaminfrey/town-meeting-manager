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
because its schema (`z.object({ subdomain: z.string() })`) is too permissive for almost any string
to fail — `setPortalAddress` itself is not yet converted to the middleware form as of this fix round
(see its own doc comment in `town.ts` for why, and that it still owes the conversion).

Status today: the Actor-only middleware form (`requireActor`) is exercised — the four `town.*`
mutations, with tests, each guard re-verified by deletion after the conversion, AND `updateProfile`
specifically carries a second pin that catches a REORDER (`.use()` moved back after `.input()`), not
only a deletion — see item 13 for why that distinction matters and could not be skipped. The
`PermissionCode` form (`requirePermission`) declared before `.input()` is exercised too, in
`require-permission.test.ts`'s synthetic router, including its own reorder pin — but has **zero
call sites in a real procedure**; every real Actor-only write so far is an admin gate
(`requireActor`), not a delegable code. The board-scoped form
(`requireBoardPermission`/`boardIdFrom`/`getRawInput()`) is fixed and covered by a dedicated test
proving it resolves a board and refuses correctly at the corrected position, but still has **zero
call sites outside tests** — no procedure in this repo writes anything board-scoped yet. The first
wave to add one should expect to amend this item again, not assume it settled.

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
`pathFilter()` line, watch the new test go red, restore it.

**Write the pin the same commit a writer's `pathFilter()` call lands, not on a later wave.** These
four calls already exist and already serve an already-migrated screen; deferring the pin to
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
are exactly what drifted here — twice, in two different documents, disagreeing with each other and
with the tree:

```
$ grep -rl "renderWithProviders(" packages/web/src | grep -v test/render.ts | wc -l
17
$ grep -rl 'vi.mock("@/hooks/useCurrentUser"' packages/web/src | grep -v test/render.ts | wc -l
8
$ grep -rl 'vi.mock("@/hooks/useCurrentUser"' packages/web/src | grep -v test/render.ts \
    | xargs grep -l 'vi.mock("@/providers/AuthProvider"' | wc -l
3
```

The second grep, run unfiltered against `test/render.ts`, answers 9 — that file's own doc comment
above quotes the `vi.mock` call as prose, and a bare grep cannot tell a comment from code. Exclude
it. (The first grep needs the same exclusion for the same reason: `render.ts` also quotes
`renderWithProviders(...)` in its own doc comments and defines the function itself, so it matches
without being a caller.)

Of the 17 files that call `renderWithProviders`, not one reaches `useCurrentUser` through
`MockAuthProvider`: the files that depend on identity mock the hook directly (8 repo-wide), and the
3 that also mock `@/providers/AuthProvider` return a literal from `useAuth` rather than routing to
`useMockAuth`. `useMockAuth` has **zero callers** outside its own module. `MockAuthProvider` is
inert everywhere it is used — see the Known gaps entry below for what "everywhere" is countable as.

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
26
$ grep -rl "lib/supabase\|useSupabase" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
63
```

(Re-run at Task 2's fix round — the second number was 67 when this item was written and had already
drifted to 63 one wave later. Quote the grep, not the number, is the rule this drift itself
demonstrates: re-run it rather than trusting either figure.)

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
- `setPortalAddress` (`packages/api/src/trpc/routers/town.ts`) is still resolver-form, not
  `requireActor`-form, as of Task 2's fix round. Its own permissive schema means the ordering
  defect item 2 describes cannot fire on it today, but it is inconsistent with every other write in
  the same file and owes the conversion — see its doc comment.
- `TestHandlers` rejects a missing field but accepts an extra one (item 8).
- `MockAuthProvider` is directly named in 4 files (`grep -rl "MockAuthProvider" packages/web/src`:
  `test/render.ts` and `test/mocks/auth-mock.ts`, where it is defined and wraps every render, plus
  `PermissionGate.test.tsx` and `boards.$boardId.test.tsx`, the two tests that reach it by name). It
  is inert in all of them per item 9. The other `renderWithProviders` callers receive it too, just
  implicitly — `render.ts` wraps every render in it unconditionally — so retiring it touches every
  caller, not only the 4 that name it.
- `router-wiring.test.ts` pins only the procedure names it lists.
- `boards.$boardId.tsx` still reads two things through `@/lib/supabase` because no procedure exists
  for them yet: town settings (the Overview "effective settings" rows, and the defaults passed to
  `EditBoardDialog`/`MinutesWorkflowEditor`) and the agenda template count. Both are marked with
  `// TODO(phase-e-wave-2): town.detail, agendaTemplate.countForBoard` in that file (item 11) — the
  screen still owes a `town.detail` router and an `agendaTemplate` router before the last two
  Supabase reads leave it.
