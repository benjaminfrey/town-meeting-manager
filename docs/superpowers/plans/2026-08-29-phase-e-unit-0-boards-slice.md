# Phase E, Unit 0 — The Boards Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put one screen on tRPC end-to-end and, in doing so, establish the client, the conventions, and the test idiom that the remaining six waves of Phase E copy.

**Architecture:** A typed tRPC client in the web package talks to the router already mounted at `/api/trpc`. Board reads become procedures on a new `boardRouter`; the screen's seven direct PostgREST calls become `useQuery` calls through that client. Authorization stays on the server where it is already proven; web tests mock at the typed tRPC boundary; one smoke test per router runs against the real router to catch wrong-procedure wiring that a typed mock cannot.

**Tech Stack:** tRPC 11.18.0 (server already mounted), `@trpc/client` + `@trpc/tanstack-react-query` at the same version, TanStack Query v5, Drizzle, Vitest, React Router v7.

## Global Constraints

- **This unit is reviewed before any later wave starts.** Its shape is copied ~80 times; a defect in it is a defect 80 times.
- `packages/api/src/db/with-tenant.ts` uses `set_config(..., true)` — `SET LOCAL`, transaction-scoped. That is the entire tenancy safety property. Do not weaken it.
- Client package versions must match `@trpc/server@11.18.0` exactly. A mismatched client/server pair in tRPC v11 fails at runtime with type errors that read as application bugs.
- `packages/api/src/db/__tests__/` stays byte-identical and its isolation gate passes unedited.
- Gates are the list in `.github/workflows/ci.yml`. Run tests as `npx turbo run test --force`; `pnpm test --force` is not a valid command, and a run reporting anything but `0 cached` proved nothing.
- Rebuild `@town-meeting/shared` (`npx turbo run build --force`) before trusting any test result. A stale `dist` has produced both false failures and false passes in this repo.
- `DATABASE_URL="postgres://ben@localhost:5432/postgres"`. Scratch databases get unique names and are dropped; leave the `tmm_app` role.
- **There is no parity baseline — for the RENDERING.** The screen shows nothing today, because the browser sends no credential and `get_current_town_id()` cannot resolve for a PostgREST request. But the **query you are replacing is a specification**: its filters, ordering and limits state intent even though it returns zero rows. Dropping one of its clauses is a behaviour change, and must be deliberate and stated.

---

## File Structure

**Create:**

- `packages/web/src/lib/trpc.ts` — the typed client and its TanStack Query integration. One responsibility: construct the client and expose the options proxy.
- `packages/api/src/trpc/routers/board.ts` — board read procedures.
- `packages/api/src/trpc/routers/__tests__/board.test.ts` — real-Postgres tests for those procedures.
- `packages/api/src/trpc/__tests__/router-wiring.test.ts` — the wiring smoke test, extended once per router for the rest of Phase E.
- `docs/superpowers/plans/phase-e-conventions.md` — the template the waves copy.

**Modify:**

- `packages/web/package.json` — add the two client dependencies.
- `packages/api/src/trpc/router.ts` — mount `boardRouter`.
- `packages/web/src/providers/QueryProvider.tsx` — provide the tRPC client alongside the QueryClient.
- `packages/web/src/routes/boards.$boardId.tsx` — replace 7 PostgREST calls.
- `packages/web/src/routes/__tests__/boards.$boardId.test.tsx` — new; this screen has no test today.

---

## Task 1: The tRPC client

**Files:**

- Modify: `packages/web/package.json`
- Create: `packages/web/src/lib/trpc.ts`
- Modify: `packages/web/src/providers/QueryProvider.tsx`
- Test: `packages/web/src/lib/__tests__/trpc.test.ts`

**Interfaces:**

- Consumes: `AppRouter` type from `packages/api/src/trpc/router.ts` (already exported).
- Produces: `trpc` (the TanStack Query options proxy) and `trpcClient` (the raw client), both from `@/lib/trpc`. Every later wave imports `trpc` from here and nothing else.

- [ ] **Step 1: Add the dependencies at the matching version**

```bash
cd packages/web
pnpm add @trpc/client@11.18.0 @trpc/tanstack-react-query@11.18.0
```

Verify they match the server: `grep '@trpc/server' ../api/package.json` must show `11.18.0`.

- [ ] **Step 2: Write the failing test**

Create `packages/web/src/lib/__tests__/trpc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { trpc, trpcClient } from "../trpc";

describe("the tRPC client", () => {
  it("exposes an options proxy and a raw client", () => {
    expect(trpc).toBeDefined();
    expect(trpcClient).toBeDefined();
  });

  it("targets the API's mounted prefix, and sends cookies", async () => {
    // The API mounts fastifyTRPCPlugin at prefix "/api/trpc" (server.ts), and
    // Better Auth sessions are cookies, so the link MUST send credentials.
    // Without them every procedure answers UNAUTHORIZED and the failure looks
    // like an authorization bug rather than a transport one.
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify([{ result: { data: null } }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await trpcClient.whoami.query().catch(() => undefined);

    expect(calls[0]?.url).toContain("/api/trpc/");
    expect(calls[0]?.init?.credentials).toBe("include");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd packages/web && npx vitest run src/lib/__tests__/trpc.test.ts`
Expected: FAIL — cannot resolve `../trpc`.

- [ ] **Step 4: Write the client**

Create `packages/web/src/lib/trpc.ts`:

```ts
/**
 * The typed tRPC client for the web application.
 *
 * Phase E, unit 0. This is the ONLY way the web package should reach the API's
 * data layer. `lib/supabase.ts` is being removed; when it is gone, an import of
 * it is a build error rather than a silent zero-row read, which is the point.
 *
 * `credentials: "include"` is load-bearing. Sessions are Better Auth cookies
 * that the API reads itself; without this every procedure answers UNAUTHORIZED,
 * and the symptom reads as an authorization bug rather than a transport one.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@town-meeting/api/trpc/router";
import { queryClient } from "./queryClient";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
```

`packages/web/src/lib/queryClient.ts` already exports the singleton that
`providers/QueryProvider.tsx` imports (verified). Import that exact module —
the options proxy and the provider must share one instance, or every
`invalidateQueries` silently no-ops against a second cache.

Note `QueryProvider.tsx:6` still imports `@/lib/supabase` for the connection
error handler. Leave it; `lib/connection-error-handler.ts` is wave 5's, and
removing the import without replacing the handler breaks the status bar.

If `@town-meeting/api` is not resolvable as a type-only import from the web
package, add it as a `devDependency` with `workspace:*` and import the type
only. Do **not** import any API runtime value into the browser bundle.

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd packages/web && npx vitest run src/lib/__tests__/trpc.test.ts`
Expected: PASS, both cases.

- [ ] **Step 6: Verify the type link is real, not `any`**

Add to the test file and run again:

```ts
it("is typed against the server's router, not any", () => {
  // If AppRouter resolved to `any`, this would compile. It must not.
  // @ts-expect-error — there is no procedure called `definitelyNotAProcedure`
  void trpcClient.definitelyNotAProcedure;
});
```

Expected: PASS, and `npx tsc --noEmit` clean. If the `@ts-expect-error` reports
as unused, the type link is broken and the whole unit is worthless — stop and
fix it before continuing.

- [ ] **Step 7: Run the gates and commit**

```bash
npx turbo run build --force && npx turbo run typecheck lint format:check
git add packages/web/package.json packages/web/src/lib/trpc.ts packages/web/src/lib/__tests__/trpc.test.ts packages/web/src/providers/QueryProvider.tsx pnpm-lock.yaml
git commit -m "Give the web package a typed client to the API it already has"
```

---

## Task 2: The board router

**Files:**

- Create: `packages/api/src/trpc/routers/board.ts`
- Create: `packages/api/src/trpc/routers/__tests__/board.test.ts`
- Modify: `packages/api/src/trpc/router.ts`

**Interfaces:**

- Consumes: `router`, `protectedProcedure` from `../trpc.js`; `toRows` from `../../db/rows.js`; `ctx.withTenant`, `ctx.tenant.townId`.
- Produces: `boardRouter` with `detail`, `stats`, `recentMeetings`. Mounted as `board` on `appRouter`, so the client calls `trpc.board.detail`.

**Authorization note — read this before writing a guard.** There is no
`assertCanSelectBoard`, and you should not add one. Reading a board was
governed by a pure tenancy policy (`town_id = get_current_town_id()`) and
nothing else; every authenticated member of a town may read that town's boards.
`protectedProcedure` + `ctx.withTenant` reproduces exactly that. Writes are
different — `assertCanUpdateBoard` and `assertCanInsertBoard` exist and are
admin-gated — but this task adds no writes.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/trpc/routers/__tests__/board.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import { seedTown, seedActor, contextFor, seedBoard } from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";

describe("board.detail", () => {
  it("returns a board of the caller's own town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      const town = await seedTown(app);
      const actor = await seedActor(app, town, { role: "staff", global: [] });
      const boardId = await seedBoard(app, town, { name: "Select Board" });

      const caller = appRouter.createCaller(contextFor(app, town, actor));
      const board = await caller.board.detail({ boardId });

      expect(board.name).toBe("Select Board");
    });
  });

  it("cannot reach a board of another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      const mine = await seedTown(app);
      const theirs = await seedTown(app, "Bristol");
      const actor = await seedActor(app, mine, { role: "staff", global: [] });
      const foreign = await seedBoard(app, theirs, { name: "Their Board" });

      const caller = appRouter.createCaller(contextFor(app, mine, actor));
      await expect(caller.board.detail({ boardId: foreign })).rejects.toThrow(/NOT_FOUND/);
    });
  });
});
```

`connectAsAppRole` is **not optional**. `withTestDb` hands back the database
owner, which is a superuser in every supported setup, so RLS does not bind it —
a cross-tenant test written on the default handle passes for the wrong reason
and proves nothing. This has already caught one agent mid-task.

`seedBoard` does **not** exist and you must add it to
`packages/api/src/trpc/__tests__/fixtures.ts`. Note what is already there:
`seedBoardSeat(db, town, personId, boardId, status)` seats a person on a
board that must already exist — it does not create one. Follow its shape:
`export async function seedBoard(db, town, opts: { name: string }): Promise<string>`,
inserting through `withTenant(db, { townId: town.townId }, ...)` and
returning the new id. Check `board`'s NOT NULL columns in
`packages/api/src/db/schema.ts` before writing the INSERT.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/api && npx vitest run src/trpc/routers/__tests__/board.test.ts`
Expected: FAIL — `board.detail` is not a function.

- [ ] **Step 3: Write the router**

Create `packages/api/src/trpc/routers/board.ts`:

```ts
import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { toRows } from "../../db/rows.js";

/**
 * Board reads.
 *
 * No permission guard, deliberately: `board` carried a pure tenancy policy and
 * nothing else, so any authenticated member of a town may read that town's
 * boards. `protectedProcedure` + `ctx.withTenant` is exactly that rule. Writes
 * are admin-gated (`assertCanUpdateBoard`) and are not in this router yet.
 *
 * A board in another town answers NOT_FOUND rather than FORBIDDEN: RLS returns
 * no row, and "you may not see this" would itself disclose that it exists.
 */
export const boardRouter = router({
  detail: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{
          id: string;
          name: string;
          board_type: string;
          quorum_rule: string | null;
          archived_at: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, name, board_type, quorum_rule, archived_at
            FROM board WHERE id = ${input.boardId}
          `),
          (message) => new Error(`board.detail: ${message}`),
        ),
      );
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  stats: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ active_members: number; meetings: number }>(
          await tx.execute(sql`
            SELECT
              (SELECT count(*)::int FROM board_member
                 WHERE board_id = ${input.boardId} AND status = 'active') AS active_members,
              (SELECT count(*)::int FROM meeting
                 WHERE board_id = ${input.boardId}) AS meetings
          `),
          (message) => new Error(`board.stats: ${message}`),
        ),
      );
      return rows[0] ?? { active_members: 0, meetings: 0 };
    }),

  recentMeetings: protectedProcedure
    .input(
      z.object({ boardId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(5) }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) =>
        toRows<{ id: string; title: string; scheduled_date: string; status: string }>(
          await tx.execute(sql`
            SELECT id, title, scheduled_date, status
            FROM meeting WHERE board_id = ${input.boardId}
            ORDER BY scheduled_date DESC LIMIT ${input.limit}
          `),
          (message) => new Error(`board.recentMeetings: ${message}`),
        ),
      );
    }),
});
```

Check the column names against `packages/api/src/db/schema.ts` before running.
Two of this project's live defects were queries naming columns that do not
exist, with the error discarded — `exhibit.file_url` and
`postmark_server_token`. A wrong column here must fail the test, not return
empty.

- [ ] **Step 4: Mount it**

In `packages/api/src/trpc/router.ts`, import `boardRouter` and add `board: boardRouter` beside `town: townRouter`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/api && npx vitest run src/trpc/routers/__tests__/board.test.ts`
Expected: PASS, both cases.

- [ ] **Step 6: Prove the tenancy test can fail**

Temporarily change `detail` to run its query outside `ctx.withTenant` (use the
raw handle). Re-run. The cross-town case MUST go red. Restore, re-run, green.
Record both outcomes in your report. A tenancy test that cannot fail is the
exact failure this project has shipped four times.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/trpc/routers/board.ts packages/api/src/trpc/routers/__tests__/board.test.ts packages/api/src/trpc/router.ts packages/api/src/trpc/__tests__/fixtures.ts
git commit -m "Give boards a tRPC router, gated by tenancy exactly as its policy was"
```

---

## Task 3: The wiring smoke test

**Files:**

- Create: `packages/api/src/trpc/__tests__/router-wiring.test.ts`

**Interfaces:**

- Consumes: `appRouter` from `../router.js`.
- Produces: a pattern extended by one block per router for the remainder of Phase E.

**Why this exists.** Web tests mock at the typed tRPC boundary, which catches a
wrong input _shape_ but not a wrong _procedure_: `trpc.board.stats` where
`trpc.board.recentMeetings` was meant type-checks and mocks cleanly, and ships.
This is the cheap structural cover for that, and it is the one place in Phase E
that runs against the real router.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { appRouter } from "../router.js";

describe("router wiring", () => {
  it("exposes exactly the procedures the web package calls, by name", () => {
    // Adding a procedure is fine; RENAMING or REMOVING one that a screen calls
    // is what this catches, at the moment it happens rather than at runtime in
    // a browser with an empty page and no error.
    const procedures = Object.keys(appRouter._def.procedures).sort();
    expect(procedures).toEqual(
      expect.arrayContaining([
        "board.detail",
        "board.recentMeetings",
        "board.stats",
        "town.portalAddress",
        "whoami",
      ]),
    );
  });

  it("every pinned procedure validates its input", () => {
    // NOT via createCaller with an empty context: protectedProcedure's
    // requireTenant middleware runs BEFORE input parsing, so such a call
    // rejects with UNAUTHORIZED and the assertion passes for the wrong
    // reason — it would still pass with the input schema deleted. Parse the
    // schema directly instead. Real input handling end-to-end is covered by
    // board.test.ts, which has a real context.
    for (const name of ["board.detail", "board.stats", "board.recentMeetings"]) {
      const def = appRouter._def.procedures[name]._def;
      const schema = def.inputs?.[0];
      expect(schema, `${name} has no input schema`).toBeDefined();
      expect(() => schema.parse({ boardId: "not-a-uuid" })).toThrow();
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd packages/api && npx vitest run src/trpc/__tests__/router-wiring.test.ts`
Expected: PASS.

- [ ] **Step 3: Prove it catches a rename**

Rename `stats` to `statistics` in `routers/board.ts`. Re-run. Expected: FAIL. Restore. Re-run: PASS. Record both.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/trpc/__tests__/router-wiring.test.ts
git commit -m "Pin the procedure names the web package calls"
```

---

## Task 4: Migrate the board detail screen

**Files:**

- Modify: `packages/web/src/routes/boards.$boardId.tsx` (7 call sites; the loader at ~:95 and the queries from ~:123)
- Create: `packages/web/src/routes/__tests__/boards.$boardId.test.tsx` (there is no existing test for this screen — `__tests__/` holds only login, people, reset-password and wizard)

**Interfaces:**

- Consumes: `trpc` from `@/lib/trpc`; `board.detail`, `board.stats`, `board.recentMeetings`.
- Produces: the conventions Task 5 documents.

- [ ] **Step 1: Write the screen's test first, against the typed mock**

This screen has no test today, so there is nothing to adapt — which is the
better starting point. Elsewhere in Phase E you will meet the 14 files that do
mock Supabase: rewrite those, never adapt them. This project has shipped four
suites that could not fail, and each began as an adapted mock.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    board: {
      detail: {
        queryOptions: (input: unknown) => ({
          queryKey: ["board.detail", input],
          queryFn: async () => ({
            id: "b1",
            name: "Select Board",
            board_type: "select",
            quorum_rule: null,
            archived_at: null,
          }),
        }),
      },
      stats: {
        queryOptions: (input: unknown) => ({
          queryKey: ["board.stats", input],
          queryFn: async () => ({ active_members: 3, meetings: 7 }),
        }),
      },
      recentMeetings: {
        queryOptions: (input: unknown) => ({
          queryKey: ["board.recentMeetings", input],
          queryFn: async () => [],
        }),
      },
    },
  },
}));

describe("board detail", () => {
  it("shows the board's name and its member and meeting counts", async () => {
    renderRoute("/boards/b1");
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(await screen.findByText("7")).toBeInTheDocument();
  });

  it("shows an error state when a query rejects, not an empty page", async () => {
    // The failure mode this whole phase exists to end is a screen that renders
    // nothing and says nothing. An error must be visible.
    renderRoute("/boards/b1", { detailRejects: true });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
```

Follow the existing render helper in `packages/web/src/test/` if one exists;
otherwise write `renderRoute` locally with the QueryClientProvider wrapper.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/web && npx vitest run src/routes/__tests__/boards.\$boardId.test.tsx`
Expected: FAIL — the screen still imports `@/lib/supabase`.

- [ ] **Step 3: Replace the seven call sites**

Each `useQuery({ queryKey: ..., queryFn: async () => { const { data } = await supabase... } })` becomes:

```tsx
const { data: board } = useQuery(trpc.board.detail.queryOptions({ boardId }));
const { data: stats } = useQuery(trpc.board.stats.queryOptions({ boardId }));
const { data: recentMeetings = [] } = useQuery(
  trpc.board.recentMeetings.queryOptions({ boardId, limit: 5 }),
);
```

The two separate count queries collapse into `stats`. Delete the
`import { supabase } from "@/lib/supabase"` line. Keep the existing
`queryKeys` factory usage only where a key is still hand-built; tRPC supplies
its own keys, so prefer them and delete the now-dead entries from
`lib/query-keys.ts` rather than leaving both.

Add a visible error state — `isError` rendering an element with `role="alert"`.
A screen that fails silently is the condition this phase exists to end.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/web && npx vitest run src/routes/__tests__/boards.\$boardId.test.tsx`
Expected: PASS, both cases.

- [ ] **Step 5: Confirm the screen no longer references Supabase**

Run: `grep -n supabase packages/web/src/routes/boards.\$boardId.tsx`
Expected: no output.

- [ ] **Step 6: Run every gate and commit**

```bash
npx turbo run build --force
npx turbo run typecheck lint format:check
npx turbo run test --force   # must report 0 cached
git add packages/web/src/routes/boards.\$boardId.tsx packages/web/src/routes/__tests__/boards.\$boardId.test.tsx packages/web/src/lib/query-keys.ts
git commit -m "Put the board detail screen on tRPC"
```

---

## Task 5: Write down the template

**Files:**

- Create: `docs/superpowers/plans/phase-e-conventions.md`

This is the deliverable the other six waves actually consume, so it is a task,
not a footnote. Write what the previous four tasks settled, with a real example
of each taken from the code you just wrote — not a description of it.

- [ ] **Step 1: Write the document**

Cover, each with a code example lifted from Task 2 or Task 4:

1. **Where a query goes.** Procedure on a router in `packages/api/src/trpc/routers/`, one router per domain noun, mounted in `router.ts`.
2. **Reads versus writes.** Reads that were tenancy-only policies get `protectedProcedure` and no guard. Writes get the matching `assertCan*` rule from `authorization/rules.ts` — and if the action is one of the 18 board-scoped codes, the guard takes a `BoardScope` and the procedure must resolve the board.
3. **NOT_FOUND, not FORBIDDEN**, for a row in another town — and why.
4. **The client call shape.** `useQuery(trpc.<router>.<procedure>.queryOptions(input))`, plus mutation + `invalidateQueries`.
5. **Error and loading states are required, and `role="alert"` is the pin.**
6. **The test idiom**: typed mock per screen; authorization not re-proven on the web; one wiring entry per new router.
7. **The rule that outranks the rest:** for every security-relevant assertion, delete the guard and watch the test go red before believing it. List the four suites in this repo that could not fail, so the next author knows this is a live habit and not a slogan.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/phase-e-conventions.md
git commit -m "Write down the conventions the rest of Phase E copies"
```

---

## Self-review notes

- **Spec coverage.** This plan covers the spec's unit 0 only. Waves 1–6, the SSE transport, the 8 `hasPermission` display fixes, and the definition-of-done removal of `lib/supabase.ts` are **not** covered here by design — the spec requires unit 0 be reviewed before they start, and detailing 80 files against an unproven template would be planning against a shape that does not exist. Each wave gets its own plan, written after this one lands.
- **Known gap, deliberate.** `boards.$boardId.tsx` has tabs (Overview, Members, Meetings, Templates, Settings) whose other tabs make their own calls. This unit migrates the Overview data only; the remaining tabs belong to wave 2. The screen will import `trpc` and, briefly, nothing else — verify no `supabase` import survives in this file even though sibling files still have theirs.
- **Prerequisite.** D1f must land first. It is migrating `routes/minutes.ts`, `routes/documents.ts` and `services/minutes-assembler.ts` and deletes `plugins/supabase.ts`; starting unit 0 against a moving API is avoidable churn.
