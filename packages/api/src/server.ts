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
import { documentRoutes } from "./routes/documents.js";
import { minutesRoutes } from "./routes/minutes.js";
import { portalRoutes } from "./routes/portal.js";
import { notificationRoutes } from "./routes/notifications.js";
import { invitationRoutes } from "./routes/invitations.js";
import { NotificationService } from "./services/notification-service.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  // ─── Plugins ─────────────────────────────────────────────────────
  await app.register(cors, {
    origin: [
      process.env.CORS_ORIGIN ?? "http://localhost:5173",
      /\.townmeetingmanager\.com$/,
    ],
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // relaxed for dev
  });

  await app.register(sensible);
  await app.register(supabasePlugin);
  await app.register(authPlugin);

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
