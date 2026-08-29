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
checked. `board.detail` names its 20 columns and cites the two line ranges of the screen it was
derived from:

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
  expect.arrayContaining(["board.detail", "board.recentMeetings", "board.stats" /* yours */]),
);
```

Note `arrayContaining` pins only what it names: `permissions` and `town.setPortalAddress` are
real router surface and currently unpinned. Grow the list as you add procedures.

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

**Bare `invalidateQueries()` with no filter is banned.** It invalidates every query in the cache,
which hides exactly the bug this item is about.

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
// packages/web/src/routes/__tests__/boards.$boardId.test.tsx
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

const stub = installTRPCFetchStub({
  "board.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return { id: "b1", name: server.boardName /* ...every column the procedure selects... */ };
  },
  "board.stats": () => ({ active_members: 3, meetings: 7 }),
  "board.recentMeetings": () => [],
});
```

`TestHandlers` is keyed by `AppRouter`'s flattened procedure paths, and each handler's input and
output are inferred from the procedure. Both halves verified by mutation:

| Mutation                          | Result                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `name:` → `nayme:` in the payload | `TS2322: Property 'name' is missing ...`                                               |
| `"board.stats"` → `"board.statz"` | `TS2353: '"board.statz"' does not exist in type 'Partial<{ ... "board.detail" ... }>'` |

Because the real proxy runs, the query keys are real, and the assertion that was impossible before
is now routine:

```tsx
it("refetches when a writer invalidates trpc.board.pathFilter()", async () => {
  const stub = installStub();
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
`EditBoardDialog`, `NoticeTemplateEditor` and `MinutesWorkflowEditor` still have **no such pin** —
whichever wave migrates each one owns writing it.

### The floor

If a payload genuinely cannot go through `installTRPCFetchStub`, it still carries
`satisfies inferProcedureOutput<...>` (or `satisfies RouterOutputs["router"]["procedure"]`, which
`packages/web/src/lib/trpc.ts` exports for exactly this). A mocked payload with no `satisfies` is
not reviewable.

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

`gcTime: Infinity` — not the `0` that `createTestQueryClient()` uses — is deliberate and was found
by a failing assertion, not by reasoning. A per-render client dies with the test, so immediate
collection costs nothing there. Here the cache outlives the render, and an invalidation assertion
reads a query with no observer left: under `gcTime: 0` that entry is already gone,
`getQueryState()` answers `undefined`, and the assertion goes quietly vacuous. `clear()` on both
edges is what keeps files isolated.

Components with no tRPC read may keep using the default fresh client.

### Identity: `vi.mock("@/hooks/useCurrentUser")`, always

**`renderWithProviders`' `user` option does not reach `useCurrentUser()`.** `MockAuthProvider`
publishes its own `AuthContext`, created in `test/mocks/auth-mock.ts`. `useCurrentUser()` calls
`useAuth()` from `@/providers/AuthProvider`, which reads a **different** context object. Passing
`user:` configures a context the component under test never reads.

This is not a hypothesis. Of the 14 files that call `renderWithProviders`, not one reaches
`useCurrentUser` through `MockAuthProvider`: the files that depend on identity mock the hook
(9 repo-wide), and the 3 that also mock `@/providers/AuthProvider` return a literal from `useAuth`
rather than routing to `useMockAuth`. `useMockAuth` has **zero callers** outside its own module.
`MockAuthProvider` is inert everywhere it is used.

The rule for Phase E is therefore one mechanism, the one that works:

```tsx
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));
```

Do not add a second. (Retiring `MockAuthProvider` entirely is worth doing, but it touches 13 files
across five waves' territory and was not done here.)

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

Task 4 left a careful ten-line prose comment and no token. With 66 non-test files in
`packages/web/src` still importing Supabase, a completeness sweep would have read that file as
done.

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

- `EditBoardDialog`, `NoticeTemplateEditor` and `MinutesWorkflowEditor` have their `pathFilter()`
  calls but no test pinning them. Deleting any of those three lines is still green. The wave that
  migrates each screen writes the pin.
- `MockAuthProvider` remains inert in 13 files. Item 9 rules on which mechanism to use; it does
  not remove the other one.
- `router-wiring.test.ts` pins only the procedure names it lists.
