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
  app.get("/api/health", async () => ({ status: "ok" }));
  await app.register(documentRoutes, { prefix: "/api" });
  await app.register(minutesRoutes, { prefix: "/api" });
  await app.register(portalRoutes, { prefix: "/api/portal" });

  return app;
}
