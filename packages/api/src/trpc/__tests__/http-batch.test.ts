/**
 * Phase E, wave 5, Task 7's fix round — the shape no test in this repository
 * had ever built: **more than one procedure on ONE HTTP request.**
 *
 * `httpBatchLink` (`packages/web/src/lib/trpc.ts`) is the client's default
 * transport. It coalesces the queries a screen fires in the same tick into a
 * single GET — `/api/trpc/a,b,c?batch=1` — and tRPC's adapter builds ONE
 * context for that request and resolves the calls CONCURRENTLY.
 *
 * `bindTenantAccess`'s reentrancy guard held a per-REQUEST boolean, so the
 * first call to reach `ctx.withTenant` set it and every sibling on the batch
 * was refused:
 *
 *     $ curl -b cookies 'localhost:3001/api/trpc/board.list,town.detail?batch=1&input=%7B%7D'
 *     [{"result":{"data":[…3 boards…]}},
 *      {"error":{"message":"ctx.withTenant() called while a transaction from an EARLIER,
 *        still-open ctx.withTenant() call on this same request has not finished. …"}}]
 *
 * The live meeting screen's own loader batches five, received four refusals
 * and a `207 Multi-Status`, and rendered blank. It had been that way since
 * Stage 1, Task D1, behind 1725 green tests, because every router test drives
 * ONE procedure through `createCaller` and the web suite stubs the transport
 * (conventions item 8) so it never builds a batch at all. A test that calls
 * procedures one at a time cannot see this, however many of them there are.
 *
 * Hence a real Fastify server and a real batched GET, in the shape
 * `__tests__/sse-bounds.test.ts` already established for "this is a claim about
 * what the adapter does, so drive the adapter". No `@trpc/client` dependency is
 * added for it: the batch URL format is part of the HTTP contract, it is what
 * the curl reproduction above used, and building it by hand is what lets this
 * file assert on the RAW envelope (a `207` and a per-item `error`) that a
 * client would have thrown away as an exception.
 *
 * ─── What is real here and what is a stand-in ─────────────────────────────
 *
 * Real: the Fastify adapter, the batching, the one-context-per-request
 * behaviour, `createTrpcContextFactory` (the production context factory), and
 * therefore `bindTenantAccess` — the function that had the defect.
 *
 * A stand-in: the router, and the raw `withTenant` under the guard. The router
 * is this file's own because `appRouter`'s procedures need a session, a tenant
 * and a database, none of which say anything about batching; the raw
 * `withTenant` is a timer because what is under test is WHICH CALLS THE GUARD
 * REFUSES, and a refusal is thrown before any database work would begin. The
 * database-backed version of the same property — two concurrent
 * `ctx.withTenant` calls on one context, through a real connection — is
 * `__tests__/context.test.ts`'s "allows two CONCURRENT ctx.withTenant calls on
 * ONE context".
 *
 * ─── The mutation that proves this file is load-bearing ───────────────────
 *
 * In `context.ts`, replace the `openTransactionScopes` store with the
 * per-request boolean it replaced:
 *
 *     let inTransaction = false;
 *     const withTenant = async (fn) => {
 *       if (inTransaction) throw new Error("…");
 *       inTransaction = true;
 *       try { return await rawWithTenant(fn); } finally { inTransaction = false; }
 *     };
 *
 * "resolves every procedure of a batch" must go red, reporting the refusal
 * message on items 2 and 3. Run in this task's fix round; see the report.
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { initTRPC } from "@trpc/server";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { createTrpcContextFactory, type TrpcContext } from "../context.js";
import type { TenantTx } from "../../db/with-tenant.js";

/** A town id shaped the way a real one is. Nothing reads it but `loadActor`. */
const TOWN_ID = "0f1c9d64-6a5f-4a2e-9c3b-7c5f0a1b2c3d";

const t = initTRPC.context<TrpcContext>().create();

/**
 * How many `ctx.withTenant` calls are open at once, at the high-water mark.
 *
 * Asserted below, and it is the difference between this file testing
 * concurrency and this file testing three sequential calls that happen to be
 * spelled as a batch. If the adapter ever stopped resolving a batch
 * concurrently, the pass would be vacuous and this number says so.
 */
let openNow = 0;
let openHighWaterMark = 0;

/**
 * Stands in for `req.withTenant` — Task B3's real one, minus the database.
 *
 * The delay is what makes the overlap real: without it each call would finish
 * inside its own microtask and three "concurrent" procedures would never
 * actually be open at the same moment.
 */
const rawWithTenant = async <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => {
  openNow += 1;
  openHighWaterMark = Math.max(openHighWaterMark, openNow);
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return await fn({} as TenantTx);
  } finally {
    openNow -= 1;
  }
};

const batchRouter = t.router({
  one: t.procedure.query(({ ctx }) => ctx.withTenant!(async () => "one")),
  two: t.procedure.query(({ ctx }) => ctx.withTenant!(async () => "two")),
  three: t.procedure.query(({ ctx }) => ctx.withTenant!(async () => "three")),
  /**
   * The control for the guard still being ON. Without it, a batch that passes
   * would also pass if the guard had simply been deleted.
   */
  nested: t.procedure.query(({ ctx }) =>
    ctx.withTenant!(async () => ctx.withTenant!(async () => "nested")),
  ),
});

/** How many times the adapter asked for a context. One per HTTP request. */
let contextsBuilt = 0;

async function withBatchServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server: FastifyInstance = Fastify({ logger: false });

  // What `auth/fastify.ts`'s `onRequest` gate sets on a request that carried a
  // session resolving to a town. Set here directly because the gate itself —
  // Better Auth, a session cookie, a `user_account` row — has nothing to do
  // with batching, and `createTrpcContextFactory` reads exactly these two
  // fields and nothing else.
  server.decorateRequest("tenant", undefined);
  server.decorateRequest("withTenant", undefined);
  server.addHook("onRequest", async (req) => {
    req.tenant = {
      townId: TOWN_ID,
      personId: "5b6e0e2a-1d8d-4f7b-9a11-2c3d4e5f6a7b",
      userAccountId: "7c8d9e0f-2a3b-4c5d-8e9f-0a1b2c3d4e5f",
    };
    req.withTenant = rawWithTenant;
  });

  const buildContext = createTrpcContextFactory();
  await server.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: {
      router: batchRouter,
      createContext: (opts: Parameters<typeof buildContext>[0]) => {
        contextsBuilt += 1;
        return buildContext(opts);
      },
    },
  });
  await server.listen({ port: 0, host: "127.0.0.1" });
  try {
    const address = server.server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await fn(`http://127.0.0.1:${port}/api/trpc`);
  } finally {
    await server.close();
  }
}

/** One batched GET, in the wire format `httpBatchLink` produces. */
async function batchGet(baseUrl: string, paths: string[]): Promise<{ status: number; body: [] }> {
  const response = await fetch(`${baseUrl}/${paths.join(",")}?batch=1`);
  return { status: response.status, body: (await response.json()) as [] };
}

describe("a tRPC HTTP batch, which shares ONE context across concurrently-resolved procedures", () => {
  it("resolves every procedure of a batch, not just the first", async () => {
    contextsBuilt = 0;
    openHighWaterMark = 0;

    await withBatchServer(async (baseUrl) => {
      const { status, body } = await batchGet(baseUrl, ["one", "two", "three"]);

      // The whole defect, in one assertion. Before the fix this was a 207 with
      // `error` on items 2 and 3.
      expect(body).toEqual([
        { result: { data: "one" } },
        { result: { data: "two" } },
        { result: { data: "three" } },
      ]);
      expect(status).toBe(200);

      // The two facts that make the assertion above mean what it says.
      expect(contextsBuilt, "one context for the whole batch, not one per call").toBe(1);
      expect(
        openHighWaterMark,
        "the batch's transactions must genuinely overlap, or this test proves nothing",
      ).toBeGreaterThan(1);
    });
  }, 20_000);

  it("still refuses a genuinely NESTED ctx.withTenant() call reached through the same transport", async () => {
    await withBatchServer(async (baseUrl) => {
      const { body } = await batchGet(baseUrl, ["nested"]);

      const [entry] = body as unknown as [{ error?: { message: string } }];
      expect(entry.error?.message).toMatch(
        /ctx\.withTenant\(\) called from INSIDE a still-open ctx\.withTenant\(\)/,
      );
    });
  }, 20_000);

  it("refuses the nested call WITHOUT taking down its batch siblings", async () => {
    await withBatchServer(async (baseUrl) => {
      const { status, body } = await batchGet(baseUrl, ["one", "nested", "two"]);

      const entries = body as unknown as Array<{
        result?: { data: string };
        error?: { message: string };
      }>;
      expect(entries[0]?.result?.data).toBe("one");
      expect(entries[1]?.error?.message).toMatch(/ctx\.withTenant\(\) called from INSIDE/);
      expect(entries[2]?.result?.data).toBe("two");

      // Mixed outcomes on one request are a 207, which is how the browser
      // check first noticed the defect at all.
      expect(status).toBe(207);
    });
  }, 20_000);
});
