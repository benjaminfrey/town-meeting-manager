/**
 * Fastify application factory.
 *
 * Creates and configures the Fastify server with plugins and routes.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import sensible from "@fastify/sensible";
import { supabasePlugin } from "./plugins/supabase.js";
import { authPlugin } from "./plugins/auth.js";
import { createAppDb } from "./auth/db.js";
import { createAuth } from "./auth/auth.js";
import { createPostmarkAuthEmailSender } from "./auth/email.js";
import { betterAuthPlugin } from "./auth/fastify.js";
import { documentRoutes } from "./routes/documents.js";
import { minutesRoutes } from "./routes/minutes.js";
import { portalRoutes } from "./routes/portal.js";
import { notificationRoutes } from "./routes/notifications.js";
import { invitationRoutes } from "./routes/invitations.js";
import { NotificationService } from "./services/notification-service.js";

export async function buildServer() {
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

  // ─── Plugins ─────────────────────────────────────────────────────
  //
  // CORS is registered BEFORE the Better Auth handler so its preflight
  // handling is in place for any route that still needs it. It should
  // increasingly need to cover nothing: `infrastructure/nginx/nginx.conf`
  // proxies `/api/` on the `app.` server block to this process, which makes
  // auth same-origin — and same-origin is what lets the session cookie stay
  // `SameSite=Lax` and have the browser enforce CSRF protection, instead of
  // `SameSite=None` plus a header check. The dev-server origin below is the
  // one genuine remaining cross-origin path.
  await app.register(cors, {
    origin: [process.env.CORS_ORIGIN ?? "http://localhost:5173", /\.townmeetingmanager\.com$/],
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
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    sendAuthEmail: createPostmarkAuthEmailSender(),
  });

  await app.register(betterAuthPlugin, { auth, db });
  app.addHook("onClose", async () => close());

  // ─── Routes ──────────────────────────────────────────────────────
  // Health check — verifies database connectivity so orchestrators and the
  // monitoring script can detect a degraded API. Returns 503 if the DB is
  // unreachable.
  app.get("/api/health", async (_request, reply) => {
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
