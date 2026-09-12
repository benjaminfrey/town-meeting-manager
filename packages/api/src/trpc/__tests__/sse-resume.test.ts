/**
 * Phase E, wave 5, Task 7's fix round — **the resume handshake, at the frame
 * level, because that is the level the defect lived at.**
 *
 * `realtime.onMeetingChange` gates its catch-up on `input.lastEventId != null`,
 * and that is the right question. What was missing was any way for a browser to
 * answer it. `EventSource` sends the `Last-Event-ID` header only once it has
 * received an `id:` frame, and tRPC attaches an id to exactly one kind of frame
 * — a `tracked()` yield. `event: connected` carries none and neither does
 * `event: ping`. So a stream that had been connected QUIETLY reconnected at the
 * `SSE_MAX_STREAM_DURATION_MS` deadline as a FRESH subscribe and lost
 * everything published during the 3.0 s gap: silently, permanently, on exactly
 * the streams nobody is watching. A meeting in recess is most of a meeting.
 *
 * `routers/__tests__/realtime.test.ts` drives the same procedure through
 * `createCaller`, which is the right level for "which topics does it yield" and
 * the WRONG level for this: `createCaller` hands back `tracked()` envelopes
 * directly and never serialises a frame, so an `id:` that is never written to
 * the wire looks identical to one that is. Nothing in that file could have
 * failed. This one reads the bytes, in the shape `__tests__/sse-bounds.test.ts`
 * established — a real Fastify server, the real `appRouter`, plain `fetch` and
 * a `ReadableStream` reader, and no `eventsource` dependency
 * (`docs/advisory-resolutions/5.1-realtime-transport.md` declines to carry
 * one).
 *
 * ─── What is real here and what is a stand-in ─────────────────────────────
 *
 * Real: the Fastify adapter, the SSE producer, `appRouter` (so the procedure,
 * its middleware chain, its input schema and its `sse` options are the ones
 * `server.ts` mounts), the `Last-Event-ID` HEADER path through
 * `@trpc/server`'s `resolveResponse`, and `bindTenantAccess`.
 *
 * A stand-in: the database behind `ctx.withTenant` (one `SELECT id FROM
 * meeting`, answered with a row) and the realtime bus (a stream that yields
 * nothing, which is the QUIET stream this file is about). The database-backed
 * version of this procedure — real RLS, a real `LISTEN` connection, a real
 * `pg_notify` — is `routers/__tests__/realtime.test.ts`.
 *
 * ─── The mutation that proves this file is load-bearing ───────────────────
 *
 * Delete the `yield tracked(String(sequence++), { topic: null })` handshake
 * from `routers/realtime.ts`. "a FIRST connection emits an id-bearing frame
 * before anything else" goes red — and so does "a reconnect carrying that id
 * gets the catch-up", because there is no id to carry. Run in this task's fix
 * round; see the report.
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "../router.js";
import { bindTenantAccess, type TrpcContext } from "../context.js";
import type { TenantTx } from "../../db/with-tenant.js";
import type { RealtimeBus } from "../../realtime/bus.js";
import { LIVE_MEETING_TOPICS } from "../../realtime/events.js";

const TOWN_ID = "0f1c9d64-6a5f-4a2e-9c3b-7c5f0a1b2c3d";
const MEETING_ID = "2a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";

/**
 * A bus that never delivers anything, for the whole life of the stream.
 *
 * That is not a convenience: it IS the case under test. A stream that produces
 * events produces ids as a side effect and resumes correctly, which is why the
 * ADR's spike — it emitted `tracked()` continuously — never exercised this and
 * recorded resume as a verified property. Quiet is the untested state.
 */
function quietBus(): RealtimeBus {
  return {
    // eslint-disable-next-line require-yield
    subscribe: async function* (_subscriber, signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    subscriberCount: 0,
    close: async () => {},
  };
}

/** One `SELECT id FROM meeting WHERE id = …`, answered with a row. */
const rawWithTenant = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
  fn({ execute: async () => [{ id: MEETING_ID }] } as unknown as TenantTx);

async function withRealtimeServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server: FastifyInstance = Fastify({ logger: false });

  const tenant = {
    townId: TOWN_ID,
    personId: "5b6e0e2a-1d8d-4f7b-9a11-2c3d4e5f6a7b",
    userAccountId: "7c8d9e0f-2a3b-4c5d-8e9f-0a1b2c3d4e5f",
  };
  const bus = quietBus();

  await server.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    useWSS: false,
    trpcOptions: {
      router: appRouter,
      createContext: ({ req, res }: { req: unknown; res: unknown }): TrpcContext => {
        const boundAccess = bindTenantAccess(rawWithTenant, tenant);
        return {
          req: req as never,
          res: res as never,
          authUser: { id: "auth-user", email: "clerk@example.test", emailVerified: true },
          tenant,
          withTenant: boundAccess.withTenant,
          actor: boundAccess.actor,
          realtime: bus,
        };
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

interface Frame {
  event?: string;
  data?: string;
  id?: string;
}

/**
 * Read SSE frames off a live stream until `until` is satisfied, then hang up.
 *
 * A subscription never ends on its own, so "read the response to completion"
 * (which is what `sse-bounds.test.ts` does, because its claim is about the
 * ending) would wait five minutes here. The claim in this file is about the
 * frames at the START, so it reads until it has them and cancels.
 */
async function readFramesUntil(
  url: string,
  options: { headers?: Record<string, string>; until: (frames: Frame[]) => boolean },
): Promise<Frame[]> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/event-stream", ...options.headers },
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const frames: Frame[] = [];
    let buffer = "";
    try {
      while (!options.until(frames)) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const frame: Frame = {};
          for (const line of raw.split("\n")) {
            if (line.startsWith("event: ")) frame.event = line.slice(7);
            else if (line.startsWith("data: ")) frame.data = line.slice(6);
            else if (line.startsWith("id: ")) frame.id = line.slice(4);
          }
          if (frame.event !== undefined || frame.data !== undefined) frames.push(frame);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return frames;
  } finally {
    clearTimeout(timeout);
  }
}

function subscriptionUrl(baseUrl: string): string {
  const input = encodeURIComponent(JSON.stringify({ meetingId: MEETING_ID }));
  return `${baseUrl}/realtime.onMeetingChange?input=${input}`;
}

describe("the SSE resume handshake on a stream that delivers nothing", () => {
  it("emits an id-bearing frame on a FIRST connection, before the meeting has said anything", async () => {
    await withRealtimeServer(async (baseUrl) => {
      const frames = await readFramesUntil(subscriptionUrl(baseUrl), {
        until: (f) => f.some((frame) => frame.id !== undefined),
      });

      // The root cause, asserted rather than described: the handshake tRPC
      // sends of its own accord carries no id, so it cannot start a resume.
      const connected = frames.find((frame) => frame.event === "connected");
      expect(connected, "tRPC always opens with event: connected").toBeDefined();
      expect(connected?.id).toBeUndefined();

      // And the fix: the first id-bearing frame is this procedure's own
      // handshake. `topic: null` — there is nothing stale on a fresh subscribe,
      // and the screen has just fetched everything itself.
      const identified = frames.filter((frame) => frame.id !== undefined);
      expect(identified).toHaveLength(1);
      expect(identified[0]?.id).toBe("0");
      expect(identified[0]?.data).toBe(JSON.stringify({ topic: null }));
    });
  }, 20_000);

  it("runs the catch-up when a reconnect echoes that id back in the Last-Event-ID HEADER", async () => {
    await withRealtimeServer(async (baseUrl) => {
      // What a browser does on its own: reconnect to the same URL, with the
      // last id it saw in the header. tRPC merges the header into the
      // procedure's `lastEventId` input — no query parameter, no client code.
      const frames = await readFramesUntil(subscriptionUrl(baseUrl), {
        headers: { "last-event-id": "0" },
        until: (f) => f.filter((frame) => frame.id !== undefined).length >= 9,
      });

      const identified = frames.filter((frame) => frame.id !== undefined);
      const payloads = identified.map((frame) => JSON.parse(frame.data!) as { topic: unknown });

      // The new connection's own handshake first, then one frame per topic:
      // everything is stale, because Postgres queues nothing for an absent
      // listener and the gap is a gap in delivery.
      expect(payloads[0]).toEqual({ topic: null });
      expect(
        payloads
          .slice(1)
          .map((p) => p.topic)
          .sort(),
      ).toEqual([...LIVE_MEETING_TOPICS].sort());

      // Ids continue from the resumed one rather than restarting, so what the
      // client sees stays monotonic across the reconnect.
      expect(identified.map((frame) => frame.id)).toEqual([
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
      ]);
    });
  }, 20_000);

  it("does NOT run the catch-up without that header, so a fresh mount is not double-fetched", async () => {
    await withRealtimeServer(async (baseUrl) => {
      // The control for the test above. Without it, "a reconnect gets the
      // catch-up" would also pass if this procedure simply resynced every
      // connection — which would refetch the live screen's whole read set a
      // second time on every page load.
      const frames = await readFramesUntil(subscriptionUrl(baseUrl), {
        until: (f) => f.some((frame) => frame.id !== undefined),
      });
      expect(frames.filter((frame) => frame.id !== undefined)).toHaveLength(1);
    });
  }, 20_000);
});
