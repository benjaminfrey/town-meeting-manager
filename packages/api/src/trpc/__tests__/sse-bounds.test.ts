/**
 * Phase E, wave 5, Task 1 — the two SSE bounds, pinned.
 *
 * `SSE_MAX_STREAM_DURATION_MS` is not a resource knob. It is the whole
 * authorization-staleness story for every subscription in this API: a stream's
 * session, account, tenant and middleware chain are evaluated when the stream
 * opens and NOT again until the client reconnects, and this bound is the only
 * thing that forces a reconnect. `context.ts`'s header states that in those
 * words. `SSE_PING_INTERVAL_MS` is what stops an intermediary reaping an idle
 * stream — a meeting in recess produces no events for a long time.
 *
 * Both were referenced by ZERO tests when this file was written. Replacing
 * `initTRPC.context<TrpcContext>().create({ sse: { … } })` in `trpc.ts` with a
 * bare `create()` — deleting the bound and the keep-alive together — left the
 * api suite at 886 passed, zero failures. A `create()` call is exactly the
 * shape a tidying pass simplifies, and `context.ts`'s exposure statement
 * becomes false the moment one does.
 *
 * Two tests, because there are two separate claims and neither covers the
 * other:
 *
 *  1. The PRODUCTION router carries both values. That is a config-shape
 *     assertion on `appRouter` and it is what goes red for the mutation above.
 *  2. `sse.maxDurationMs` does what the header says it does — the response
 *     ENDS at the deadline, and ends in the way that makes a client reconnect
 *     rather than stop. That is a behaviour claim about tRPC's adapter, so it
 *     runs against a real Fastify server over real HTTP at a duration short
 *     enough to wait for (1.2s), with a router of this file's own.
 *
 * No `eventsource` dependency: `docs/advisory-resolutions/5.1-realtime-transport.md`
 * declines to carry one, and it is not needed. SSE is a text protocol over an
 * ordinary GET — `fetch` plus a `ReadableStream` reader reads it directly, and
 * reading the raw frames is what lets test 2 assert on the absence of a frame
 * (`event: return`), which an EventSource client would have swallowed.
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { initTRPC } from "@trpc/server";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "../router.js";
import { SSE_MAX_STREAM_DURATION_MS, SSE_PING_INTERVAL_MS } from "../trpc.js";

describe("the production router's SSE bounds", () => {
  it("carries both the stream-duration bound and the keep-alive, from the exported constants", () => {
    // `_def._config` is where `initTRPC.create()`'s options end up, and it is
    // reached from the router rather than from `t` because the router is what
    // `server.ts` hands the adapter — the value the adapter actually reads.
    const sse = appRouter._def._config.sse;

    expect(sse, "appRouter declares no sse options at all — see this file's header").toBeDefined();
    expect(sse?.maxDurationMs).toBe(SSE_MAX_STREAM_DURATION_MS);
    expect(sse?.ping).toEqual({ enabled: true, intervalMs: SSE_PING_INTERVAL_MS });

    // The constants are tunable and this file does not pin their exact values
    // — but a bound that is absent, zero, or effectively infinite is not a
    // tuning, it is the property being deleted by other means. A ping longer
    // than the bound it lives inside would never fire.
    expect(SSE_MAX_STREAM_DURATION_MS).toBeGreaterThan(0);
    expect(SSE_MAX_STREAM_DURATION_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(SSE_PING_INTERVAL_MS).toBeGreaterThan(0);
    expect(SSE_PING_INTERVAL_MS).toBeLessThan(SSE_MAX_STREAM_DURATION_MS);
  });
});

/**
 * A router of this file's own, at durations a test can wait for.
 *
 * It cannot be `appRouter`: the bound there is five minutes by design, and the
 * behaviour claim needs the deadline to actually arrive. What carries over is
 * the OPTION SHAPE — the same `sse.ping` / `sse.maxDurationMs` keys the test
 * above asserts `appRouter` carries. Nothing here needs a context, a database
 * or a session; the claim is about how the adapter ends a stream.
 */
const t = initTRPC.create({
  sse: { ping: { enabled: true, intervalMs: 200 }, maxDurationMs: 1_200 },
});

const boundsRouter = t.router({
  /**
   * Yields nothing and ends only when tRPC aborts it.
   *
   * `require-yield` is disabled deliberately and not worked around: tRPC's
   * `.subscription()` requires an async GENERATOR, and the whole claim this
   * procedure supports is that a stream which never yields is still ended by
   * the adapter's own deadline. Adding a `yield` to satisfy the rule would
   * delete the case under test.
   */
  // eslint-disable-next-line require-yield
  neverEnds: t.procedure.subscription(async function* ({ signal }) {
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }),
  /**
   * The control for the `event: return` assertion below.
   *
   * Without it, "the deadline response contains no `event: return`" would
   * also pass if this adapter never emitted that frame under any
   * circumstances, and the test would prove nothing about WHY a client
   * reconnects after a deadline.
   */
  // See `neverEnds` above: an immediately-returning generator IS the control
  // here, so it must not yield.
  // eslint-disable-next-line require-yield
  endsCleanly: t.procedure.subscription(async function* () {
    return;
  }),
});

async function withBoundsServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server: FastifyInstance = Fastify({ logger: false });
  await server.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: { router: boundsRouter, createContext: () => ({}) },
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

/** Read an SSE response to completion, returning the raw frames and how long it took. */
async function readStream(url: string): Promise<{ body: string; elapsedMs: number }> {
  const startedAt = Date.now();
  const response = await fetch(url, { headers: { accept: "text/event-stream" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  return { body, elapsedMs: Date.now() - startedAt };
}

describe("what sse.maxDurationMs does to a real stream", () => {
  it("ends an open stream at the deadline, keeping it alive with pings until then", async () => {
    await withBoundsServer(async (baseUrl) => {
      const { body, elapsedMs } = await readStream(`${baseUrl}/neverEnds`);

      // The generator's only exit is tRPC's abort, so the stream ending at
      // all is the bound firing. The window is generous on the upper side
      // because it is bounded by CI scheduling, not by the claim; the lower
      // bound is the one that matters — a stream that ended immediately
      // would mean something else closed it.
      expect(elapsedMs).toBeGreaterThan(1_000);
      expect(elapsedMs).toBeLessThan(10_000);

      // Roughly one per 200ms for 1.2s. Asserted as "more than one" rather
      // than an exact count: the timer is real and the count is scheduling-
      // dependent, but zero pings would mean the keep-alive is off and an
      // idle stream is at the mercy of every proxy between here and the
      // client.
      const pings = body.split("event: ping").length - 1;
      expect(pings).toBeGreaterThan(1);
    });
  }, 20_000);

  it("ends it WITHOUT event: return, which is what makes the client reconnect rather than stop", async () => {
    await withBoundsServer(async (baseUrl) => {
      // `httpSubscriptionLink` stops on a completed subscription and resumes
      // on a dropped connection, and `event: return` is how the server says
      // which happened. A deadline that emitted it would silently turn the
      // five-minute bound into a five-minute session limit — every live
      // meeting going dead after five minutes, with no error anywhere.
      const deadline = await readStream(`${baseUrl}/neverEnds`);
      expect(deadline.body).not.toContain("event: return");

      // The control, in the same test: this adapter DOES emit `event: return`
      // when a generator finishes on its own, so the absence above is a fact
      // about the deadline and not about the frame.
      const clean = await readStream(`${baseUrl}/endsCleanly`);
      expect(clean.body).toContain("event: return");
    });
  }, 20_000);
});
