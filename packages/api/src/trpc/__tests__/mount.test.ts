/**
 * Stage 1, Task D1 — the tRPC mount is behind the deny-by-default gate.
 *
 * `server.ts` registers `/api/trpc/*` with NO `PUBLIC_ROUTE` marking, which is
 * the whole design: `publicProcedure` relaxes the tRPC-level requirement, and
 * the HTTP gate in `auth/fastify.ts` still runs in front of it. Without this
 * test that property is a comment — and the exact failure it guards against
 * (a mount that quietly serves without a session) is the one Task G1 found ten
 * instances of in `routes/notifications.ts`.
 *
 * Driven over `inject()` against a real Fastify instance for the same reason
 * `route-access.test.ts` is: every historical failure in this area was in the
 * wiring, not in the predicate.
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { betterAuthPlugin } from "../../auth/fastify.js";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "../router.js";
import { createTrpcContext } from "../context.js";

async function buildApp(client: postgres.Sql): Promise<FastifyInstance> {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: "http://localhost:3000",
    sendAuthEmail: async () => {},
  });

  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(betterAuthPlugin, { auth, db, allowedOrigins: ["http://localhost:3000"] });
  // Registered exactly as `server.ts` registers it — no `config`, so the gate
  // applies. If someone adds `config: { ...PUBLIC_ROUTE }` there, this fails.
  await server.register(fastifyTRPCPlugin, {
    prefix: "/api/trpc",
    trpcOptions: { router: appRouter, createContext: createTrpcContext },
  });
  return server;
}

async function withServer(fn: (server: FastifyInstance) => Promise<void>): Promise<void> {
  await withTestDb(async (owner) => {
    const app = await connectAsAppRole(owner);
    try {
      const server = await buildApp(app);
      try {
        await fn(server);
      } finally {
        await server.close();
      }
    } finally {
      await app.end();
    }
  });
}

describe("the /api/trpc mount", () => {
  it("refuses a sessionless query with 401, before any procedure runs", async () => {
    await withServer(async (server) => {
      const response = await server.inject({ method: "GET", url: "/api/trpc/whoami" });
      expect(response.statusCode).toBe(401);
      // The gate's message, not tRPC's — proving the refusal happened in
      // `onRequest` rather than inside the router.
      expect(response.body).toContain("requires a signed-in session");
    });
  });

  it("refuses a sessionless mutation too, not only GETs", async () => {
    await withServer(async (server) => {
      const response = await server.inject({
        method: "POST",
        url: "/api/trpc/whoami",
        payload: {},
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ─── Phase E wave 5, Task 1: the SSE surface is not a second door ──────
  //
  // A subscription is a GET with an `accept: text/event-stream` header, which
  // is a shape no other route in this API has. It is served by the same mount
  // and therefore by the same gate — but "therefore" is exactly the kind of
  // reasoning `route-access.test.ts` exists because of, so it is a request
  // here rather than an inference. A long-lived unauthenticated stream would
  // be worse than a leaked query: it stays open.
  it("refuses a sessionless SUBSCRIPTION with 401, before any stream is opened", async () => {
    await withServer(async (server) => {
      const response = await server.inject({
        method: "GET",
        url:
          "/api/trpc/realtime.onMeetingChange?input=" +
          encodeURIComponent(JSON.stringify({ meetingId: "00000000-0000-4000-8000-000000000000" })),
        headers: { accept: "text/event-stream" },
      });
      expect(response.statusCode).toBe(401);
      // The gate's own message, so this is not a tRPC-level refusal that
      // happened to produce the same status.
      expect(response.body).toContain("requires a signed-in session");
      // And emphatically not a stream: a 401 that arrived as `text/event-stream`
      // would mean the response had already been committed as one.
      expect(response.headers["content-type"]).not.toContain("text/event-stream");
    });
  });

  it("refuses a cross-origin call to the mount before looking for a session", async () => {
    await withServer(async (server) => {
      const response = await server.inject({
        method: "GET",
        url: "/api/trpc/permissions",
        headers: { origin: "https://another-town.townmeetingmanager.com" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.body).toContain("application's own origin");
    });
  });
});
