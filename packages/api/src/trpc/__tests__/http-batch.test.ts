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

import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { initTRPC } from "@trpc/server";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { TRPC_BATCH_PATH_LENGTH_LIMIT } from "@town-meeting/shared";
import { createTrpcContextFactory, type TrpcContext } from "../context.js";
import type { TenantTx } from "../../db/with-tenant.js";
import { buildServer } from "../../server.js";

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

/**
 * ─── The THIRD defect, surfaced by the reentrancy fix above ────────────────
 *
 * Once a batch actually resolves every procedure concurrently, the live
 * meeting screen composes a real one: `boardMember.activeCountForBoard` plus
 * the five reads its loader does not prime (`exhibit.byMeeting`,
 * `voteRecord.byMeeting`, `guestSpeaker.byMeeting`,
 * `agendaItemTransition.byMeeting`, `executiveSession.byMeeting`) all land in
 * one React Query tick. Joined by `httpBatchLink` into
 * `/api/trpc/exhibit.byMeeting,voteRecord.byMeeting,...` that path segment is
 * 151 characters — over Fastify's *default* `maxParamLength` of 100, so
 * `find-my-way` answers 404 before the request reaches tRPC's adapter at
 * all, let alone a resolver. Bisected directly against a running server: 5
 * procedures / 89 characters got 200, 6 procedures / 107 characters got 404.
 *
 * It was invisible in the browser because `QueryClient`'s `retry: 2` retries
 * each failed query independently, and by the time it does the in-flight set
 * has changed shape — the retried batch happens to be smaller and fits under
 * 100 characters, so the screen renders completely on the second pass. See
 * `docs/superpowers/plans/phase-e-conventions.md` item 13's new paragraph on
 * retry as a harness hazard for the full account of why nothing short of
 * driving the real transport would have caught this.
 *
 * `TRPC_BATCH_PATH_LENGTH_LIMIT` (`@town-meeting/shared`) is the fix:
 * `server.ts` passes it as Fastify's `maxParamLength`, and that constant's
 * own doc comment carries the sizing argument (why 4096 is safe to raise to,
 * and why `TRPC_BATCH_URL_LIMIT` on the CLIENT is the other half — it caps
 * the url `httpBatchLink` will build so a batch too large ever splits into
 * more than one request instead of ever depending on the server's ceiling).
 *
 * Two things are pinned below, mirroring `sse-bounds.test.ts`'s own split
 * between a config-shape claim and a behaviour claim:
 *
 *  1. The PRODUCTION server actually carries the raised bound — built with
 *     real `buildServer()`, the same way `public-route-inventory.test.ts`
 *     does (env vars only; no query ever runs, so no database round trip is
 *     needed to make this assertion true).
 *  2. A batch shaped exactly like the live meeting screen's real one — same
 *     six procedure names, same ~151-character path — actually resolves at
 *     that bound, AND still 404s at the OLD default. The second half is a
 *     permanent regression control: it does not require mutating source to
 *     prove the assertion is real, because it demonstrates the failure mode
 *     directly, the same role `sse-bounds.test.ts`'s `endsCleanly` control
 *     plays for its own claim.
 *
 * ─── The mutation that proves this file is load-bearing ───────────────────
 *
 * In `server.ts`, delete the `maxParamLength: TRPC_BATCH_PATH_LENGTH_LIMIT`
 * option from the `Fastify({...})` call (restoring the implicit default of
 * 100). "carries the raised maxParamLength bound" must go red, reporting 100
 * where it expects 4096. Run in this task's fix round; see the report.
 */
describe("the production server's batch-path bound (Phase E, wave 5, Task 7)", () => {
  /**
   * The environment `buildServer` refuses to boot without. The two `SUPABASE_*`
   * entries that used to sit here were dropped at Phase E's close-out (wave 6,
   * Task 7) — nothing in `packages/api/src` reads either, and `server.ts` asks
   * only for `BETTER_AUTH_SECRET` and `DATABASE_URL`.
   */
  const REQUIRED_ENV = {
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost:5432/postgres",
  } as const;

  const savedEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [key, previous] of Object.entries(savedEnv)) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("carries the raised maxParamLength bound, from the exported constant", async () => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }

    // No query ever runs — `postgres.js` pools lazily and `createClient`
    // does no I/O — so this proves the config shape, not connectivity.
    const app = await buildServer();
    try {
      expect(app.initialConfig.maxParamLength).toBe(TRPC_BATCH_PATH_LENGTH_LIMIT);
    } finally {
      // Closing clears the notification retry interval and the database pool.
      await app.close();
    }
  });
});

/**
 * The live meeting screen's real batch, named exactly as production has it —
 * see the header above. `t.router({ exhibit: t.router({ byMeeting: ... }) })`
 * nesting is what produces the dotted `exhibit.byMeeting` path tRPC's client
 * builds for a real sub-router procedure; a flat `exhibitByMeeting` key would
 * not reproduce the real path shape.
 */
const t2 = initTRPC.create();
const longBatchRouter = t2.router({
  exhibit: t2.router({ byMeeting: t2.procedure.query(() => "exhibit") }),
  voteRecord: t2.router({ byMeeting: t2.procedure.query(() => "voteRecord") }),
  guestSpeaker: t2.router({ byMeeting: t2.procedure.query(() => "guestSpeaker") }),
  agendaItemTransition: t2.router({
    byMeeting: t2.procedure.query(() => "agendaItemTransition"),
  }),
  executiveSession: t2.router({ byMeeting: t2.procedure.query(() => "executiveSession") }),
  boardMember: t2.router({
    activeCountForBoard: t2.procedure.query(() => "boardMember"),
  }),
});

/** The exact six paths the live meeting screen batches — ~151 characters joined. */
const LIVE_MEETING_BATCH_PATHS = [
  "exhibit.byMeeting",
  "voteRecord.byMeeting",
  "guestSpeaker.byMeeting",
  "agendaItemTransition.byMeeting",
  "executiveSession.byMeeting",
  "boardMember.activeCountForBoard",
];

async function withLongPathServer(
  maxParamLength: number | undefined,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: FastifyInstance = Fastify({ logger: false, maxParamLength });
  await server.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: { router: longBatchRouter, createContext: () => ({}) },
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

describe("a batch path sized like the live meeting screen's real one", () => {
  it("returns 200 with all six results at the raised bound", async () => {
    await withLongPathServer(TRPC_BATCH_PATH_LENGTH_LIMIT, async (baseUrl) => {
      const { status, body } = await batchGet(baseUrl, LIVE_MEETING_BATCH_PATHS);

      expect(status).toBe(200);
      // Each stub resolver returns its own top-level router name — see
      // `longBatchRouter` above — so this proves all six actually resolved,
      // not merely that six envelopes came back.
      expect(body).toEqual(
        LIVE_MEETING_BATCH_PATHS.map((path) => ({
          result: { data: path.split(".")[0] },
        })),
      );
    });
  }, 20_000);

  // The permanent regression control: proves the assertion above is real by
  // reproducing the actual bisected failure (6 procedures / ~151 characters,
  // over the OLD default of 100) with no source mutation needed to see it.
  it("404s the identical batch at Fastify's OLD default of 100 — the bug this file pins", async () => {
    await withLongPathServer(undefined, async (baseUrl) => {
      const { status } = await batchGet(baseUrl, LIVE_MEETING_BATCH_PATHS);
      expect(status).toBe(404);
    });
  }, 20_000);
});
