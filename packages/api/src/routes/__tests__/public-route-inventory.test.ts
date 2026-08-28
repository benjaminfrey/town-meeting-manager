/**
 * Stage 1, Task G1 — the list of routes this API serves without a session.
 *
 * `auth/__tests__/route-access.test.ts` proves the DEFAULT: an unmarked route
 * is refused. That makes forgetting safe. It does nothing about the opposite
 * mistake — someone marking a route public because a 401 was in their way,
 * which is how a considered exemption becomes an unconsidered one.
 *
 * So this enumerates every route the five route files register and asserts the
 * public ones are EXACTLY the list below. Marking one more route public fails
 * this test until the author adds it here, which is a diff a reviewer can see.
 * Adding an authenticated route needs no change: that direction is already
 * safe.
 *
 * Two public routes are registered outside these files and so are not in the
 * list: `GET /api/health` in `server.ts`, and Better Auth's own
 * `GET|POST /api/auth/*` in `auth/fastify.ts`. Both are marked with the same
 * mechanism and both carry a comment saying why.
 *
 * No database and no network: `onRoute` fires at registration, and the
 * decorators the route files read at registration time are stubbed. The point
 * is the route table, not the handlers.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { documentRoutes } from "../documents.js";
import { minutesRoutes } from "../minutes.js";
import { portalRoutes } from "../portal.js";
import { notificationRoutes } from "../notifications.js";
import { invitationRoutes } from "../invitations.js";

/**
 * Every route these files serve without a session.
 *
 * Each line is a decision. The reasoning lives in each file's header — the
 * portal's review of all fifteen of its routes, invitations' three, and the
 * Postmark webhook's Basic-auth verification — and belongs there rather than
 * duplicated here, where it would drift.
 */
const EXPECTED_PUBLIC_ROUTES = [
  "GET /api/invitations/validate",
  "GET /api/portal/:townId/boards",
  "GET /api/portal/:townId/boards/:boardId",
  "GET /api/portal/:townId/calendar",
  "GET /api/portal/:townId/meetings",
  "GET /api/portal/:townId/meetings/:meetingId",
  "GET /api/portal/:townId/meetings/:meetingId/agenda",
  "GET /api/portal/:townId/meetings/:meetingId/agenda/pdf",
  "GET /api/portal/:townId/meetings/:meetingId/minutes",
  "GET /api/portal/:townId/meetings/:meetingId/minutes/pdf",
  "GET /api/portal/:townId/robots.txt",
  "GET /api/portal/:townId/search",
  "GET /api/portal/:townId/sitemap.xml",
  "GET /api/portal/resolve",
  "GET /api/portal/robots",
  "GET /api/portal/sitemap",
  "GET /api/unsubscribe",
  "POST /api/invitations/accept",
  "POST /api/webhooks/postmark",
];

interface CollectedRoute {
  readonly signature: string;
  readonly isPublic: boolean;
}

async function collectRoutes(): Promise<CollectedRoute[]> {
  const server = Fastify({ logger: false });
  await server.register(sensible);

  // The route files read these at REGISTRATION time — `const supabase =
  // app.supabase`, and `[app.verifyAuth, requirePermission(...)]` in preHandler
  // arrays — so they have to exist. Neither is called: no handler runs here.
  server.decorate("supabase", {} as never);
  server.decorate("verifyAuth", async () => {});

  const collected: CollectedRoute[] = [];
  server.addHook("onRoute", (route) => {
    // Fastify expands a route with several methods into one `onRoute` call
    // carrying an array. Flattening keeps `HEAD` (which Fastify adds beside
    // every GET) from being silently dropped.
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      collected.push({
        signature: `${method} ${route.url}`,
        isPublic: route.config?.auth === "public",
      });
    }
  });

  // Same prefixes as `server.ts`. A mismatch here would test a route table
  // that does not exist.
  await server.register(documentRoutes, { prefix: "/api" });
  await server.register(minutesRoutes, { prefix: "/api" });
  await server.register(portalRoutes, { prefix: "/api/portal" });
  await server.register(notificationRoutes, { prefix: "/api" });
  await server.register(invitationRoutes, { prefix: "/api" });
  await server.ready();
  await server.close();

  return collected;
}

describe("the public route inventory", () => {
  it("serves exactly these routes without a session, and no others", async () => {
    const routes = await collectRoutes();

    // `HEAD` is auto-registered alongside each `GET` and inherits its config,
    // so it would double every portal line without adding a decision.
    const publicSignatures = routes
      .filter((r) => r.isPublic && !r.signature.startsWith("HEAD "))
      .map((r) => r.signature)
      .sort();

    expect(publicSignatures).toEqual([...EXPECTED_PUBLIC_ROUTES].sort());
  });

  it("finds the routes at all — a plugin that registered nothing would pass vacuously", async () => {
    const routes = await collectRoutes();
    // Guards the test above: if a refactor made `collectRoutes` return an
    // empty list, its `toEqual` would fail loudly for public routes but the
    // suite would still be asserting nothing about the authenticated ones.
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.some((r) => r.signature === "POST /api/invitations/:id/send")).toBe(true);
  });

  it("leaves every notification route except the webhook requiring a session", async () => {
    const routes = await collectRoutes();
    const notificationRouteSignatures = routes.filter(
      (r) =>
        !r.signature.startsWith("HEAD ") &&
        (r.signature.includes("/api/admin/notifications") ||
          r.signature.includes("/api/notifications/") ||
          r.signature.includes("/api/webhooks/")),
    );

    const publicOnes = notificationRouteSignatures
      .filter((r) => r.isPublic)
      .map((r) => r.signature);

    // The specific regression this task closed: ten routes in one file, none
    // of them requiring anything.
    expect(publicOnes).toEqual(["POST /api/webhooks/postmark"]);
  });

  it("has no /test/ routes left in the served table", async () => {
    const routes = await collectRoutes();
    // `POST /api/test/push` was deleted rather than authenticated: it was
    // guarded only by `NODE_ENV !== "production"`, which fails open whenever
    // that variable is unset. This asserts it did not come back, and that no
    // sibling debug route joined it.
    expect(routes.filter((r) => r.signature.includes("/test/"))).toEqual([]);
  });
});
