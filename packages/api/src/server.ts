/**
 * Fastify application factory.
 *
 * Creates and configures the Fastify server with plugins and routes.
 */

import Fastify, { type onRouteHookHandler } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import { supabasePlugin } from "./plugins/supabase.js";
import { authPlugin } from "./plugins/auth.js";
import { createAppDb } from "./auth/db.js";
import { createAuth } from "./auth/auth.js";
import { createPostmarkAuthEmailSender } from "./auth/email.js";
import { betterAuthPlugin } from "./auth/fastify.js";
import { PUBLIC_ROUTE } from "./auth/route-access.js";
import { documentRoutes } from "./routes/documents.js";
import { minutesRoutes } from "./routes/minutes.js";
import { portalRoutes } from "./routes/portal.js";
import { notificationRoutes } from "./routes/notifications.js";
import { invitationRoutes } from "./routes/invitations.js";
import { sessionRoutes } from "./routes/session.js";
import { NotificationService } from "./services/notification-service.js";

export interface BuildServerOptions {
  /**
   * Observe every route as it is registered.
   *
   * Exists for `routes/__tests__/public-route-inventory.test.ts`, which pins
   * the exact set of routes this API serves without a session. That test used
   * to hand-mirror the registrations below by importing the five route
   * modules, which meant a sixth route file — or a route declared inline in
   * this function, like `/api/health` — could be marked public with no test
   * pressure at all. Deny-by-default still protected such a route if it were
   * left unmarked, but the pin's whole purpose is to make MARKING something
   * public visible in a diff, and that purpose lapsed silently outside those
   * five imports.
   *
   * `buildServer` constructs its own instance, so a caller has no way to
   * attach an `onRoute` hook from outside. Hence this. It is a read-only
   * observer: it cannot alter a route, and passing nothing is the production
   * path.
   */
  onRoute?: onRouteHookHandler;
}

export async function buildServer(options: BuildServerOptions = {}) {
  // `trustProxy` matters for auth specifically (Stage 1, Task C1). Better Auth
  // reconstructs the request URL from `request.protocol` + `request.host` and
  // compares its origin against `baseURL`. Without this, a request that arrived
  // at nginx over TLS is seen here as `http://…` — the origins disagree and
  // sign-in is rejected in production while working perfectly in development.
  //
  // Trusting the header is safe in this topology and only in this topology:
  // `infrastructure/docker-compose.production.yml` publishes nginx alone
  // ("the only host-published service"), the API listens on the private
  // network, and nginx sets `X-Forwarded-Proto` itself — overwriting anything
  // a client sent. If the API is ever exposed directly, this must be narrowed
  // to the proxy's address.
  const app = Fastify({ logger: true, trustProxy: true });

  // Registered before anything else so it sees every route, including those
  // inside encapsulated children (`onRoute` propagates down).
  if (options.onRoute) app.addHook("onRoute", options.onRoute);

  // ─── Plugins ─────────────────────────────────────────────────────
  //
  // CORS is registered BEFORE the Better Auth handler so its preflight
  // handling is in place for any route that still needs it.
  //
  // ─── Task C2: the dev-server origin is gone from this list ────────────
  //
  // It used to read `process.env.CORS_ORIGIN ?? "http://localhost:5173"`,
  // which made the Vite dev server a credentialed cross-origin caller — a
  // second cookie topology alongside the same-origin one nginx serves in
  // production, and the one shape guaranteed to produce a "works locally,
  // fails in production" session bug. `packages/web/vite.config.ts` proxies
  // `/api` to this process WITHOUT rewriting the Host header, so development
  // is now same-origin exactly as `infrastructure/nginx/nginx.conf` makes it
  // in production, and the browser needs no CORS allowance at all.
  //
  // A developer who bypasses the proxy and points a page straight at
  // `localhost:3001` now gets a CORS error. That is the intended, loud
  // outcome: the session cookie would not have been sent anyway, and a silent
  // half-working setup is what this removal exists to prevent.
  await app.register(cors, {
    // Non-browser callers on the `api.` server block only. `CORS_ORIGIN` is
    // still honoured so an operator can add one deliberately.
    origin: process.env.CORS_ORIGIN
      ? [process.env.CORS_ORIGIN, /\.townmeetingmanager\.com$/]
      : [/\.townmeetingmanager\.com$/],
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // relaxed for dev
  });

  await app.register(sensible);
  await app.register(supabasePlugin);
  await app.register(authPlugin);

  // ─── Better Auth and the tenant bridge (Stage 1, Task C1) ────────
  //
  // `plugins/auth.ts` above is the Supabase-era JWT verifier, still in place
  // because the routes registered below use `verifyAuth`. Task C2 and Phase D
  // move those onto `request.tenant`; deleting it here would break them all in
  // one commit for no security gain, since it is only reachable on routes
  // that opt into it.
  //
  // What is registered here is the replacement: Better Auth's handler at
  // `/api/auth/*`, plus the preHandler that resolves a session to a town and
  // REFUSES rather than continuing with no tenant context. See
  // `auth/tenant-context.ts` for why that refusal is the load-bearing part.
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required (at least 32 bytes; `openssl rand -base64 32`). " +
        "It signs session cookies and verification tokens — booting without it would " +
        "mean every session was forgeable.",
    );
  }

  const { db, close } = createAppDb();
  const auth = createAuth({
    db,
    secret,
    // The origin the BROWSER loads the app from — not this process's own
    // listen address. Better Auth derives `trustedOrigins` from it and refuses
    // any state-changing request whose `Origin` header does not match, so
    // pointing it at the API's port makes every sign-in a 403 INVALID_ORIGIN.
    //
    // The development default is the Vite dev server, which proxies `/api` here
    // without rewriting `Host`; production is the `app.` host, which nginx
    // proxies the same way. Same value, same meaning, both environments.
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
    sendAuthEmail: createPostmarkAuthEmailSender(),
  });

  await app.register(betterAuthPlugin, { auth, db });
  app.addHook("onClose", async () => close());

  // ─── Routes ──────────────────────────────────────────────────────
  // Health check — verifies database connectivity so orchestrators and the
  // monitoring script can detect a degraded API. Returns 503 if the DB is
  // unreachable.
  // Public: an orchestrator's liveness probe and `scripts/health-check.sh`
  // have no session and must not need one — a health endpoint that returns 401
  // when auth is misconfigured reports "unhealthy" for the wrong reason, or
  // (worse) reports healthy because the probe treats any response as up. It
  // discloses only up/degraded and a process uptime.
  app.get("/api/health", { config: { ...PUBLIC_ROUTE } }, async (_request, reply) => {
    let database: "connected" | "disconnected" = "disconnected";
    try {
      const { error } = await app.supabase
        .from("town")
        .select("id", { head: true, count: "exact" })
        .limit(1);
      if (!error) database = "connected";
    } catch {
      database = "disconnected";
    }
    return reply.code(database === "connected" ? 200 : 503).send({
      status: database === "connected" ? "ok" : "degraded",
      uptime: Math.round(process.uptime()),
      database,
    });
  });
  await app.register(documentRoutes, { prefix: "/api" });
  await app.register(minutesRoutes, { prefix: "/api" });
  await app.register(portalRoutes, { prefix: "/api/portal" });
  await app.register(notificationRoutes, { prefix: "/api" });
  await app.register(invitationRoutes, { prefix: "/api" });
  await app.register(sessionRoutes, { prefix: "/api" });

  // ─── Retry processor — runs every 60 seconds ─────────────────────
  const retryInterval = setInterval(() => {
    const service = new NotificationService(app.supabase);
    service.processRetries().catch((err) => {
      app.log.error({ err }, "Notification retry processor error");
    });
  }, 60_000);

  app.addHook("onClose", async () => clearInterval(retryInterval));

  return app;
}
