/**
 * A Fastify instance carrying the public portal routes and nothing else,
 * wired exactly the way `server.ts` wires them.
 *
 * Shared by `routes/__tests__/portal-tenancy.test.ts` and
 * `storage/__tests__/serving-surface.test.ts`, which both need to ask the real
 * routes real questions. It lives here rather than in either file because a
 * second private copy of this boot sequence is a second place for the
 * registration ORDER to drift — and the order is a security property, not a
 * detail: `betterAuthPlugin` installs the root deny-by-default gate, and the
 * portal's own tenant hook has to run inside it.
 */

import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { createAuth } from "../auth/auth.js";
import { betterAuthPlugin } from "../auth/fastify.js";
import { portalRoutes } from "../routes/portal.js";

/**
 * @param client a connection as `tmm_app` — the non-owner runtime role. Pass
 * the owner and row level security is bypassed, which would make every
 * tenancy assertion in the callers meaningless.
 */
export async function buildPortalApp(client: postgres.Sql): Promise<FastifyInstance> {
  const db = drizzle(client);
  const server = Fastify({ logger: false });
  await server.register(sensible);
  // The portal's tenant hook reads `fastify.tenantDb`, which this plugin
  // decorates, and the root deny-by-default gate it installs runs in front of
  // every portal route — so registering it here also proves the two hooks
  // compose in the right order.
  await server.register(betterAuthPlugin, {
    auth: createAuth({
      db,
      secret: "0123456789abcdef0123456789abcdef",
      baseURL: "http://localhost:3000",
      sendAuthEmail: async () => {},
    }),
    db,
    allowedOrigins: ["http://localhost:3000"],
  });
  await server.register(portalRoutes, { prefix: "/api/portal" });
  return server;
}
