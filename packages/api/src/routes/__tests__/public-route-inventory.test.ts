/**
 * Stage 1, Task G1 — the list of routes THIS API serves without a session.
 *
 * `auth/__tests__/route-access.test.ts` proves the DEFAULT: an unmarked route
 * is refused. That makes forgetting safe. It does nothing about the opposite
 * mistake — someone marking a route public because a 401 was in their way,
 * which is how a considered exemption becomes an unconsidered one.
 *
 * So this enumerates the route table and asserts the public set is EXACTLY the
 * list below. Marking one more route public fails this test until the author
 * adds it here, which is a diff a reviewer can see. Adding an AUTHENTICATED
 * route needs no change: that direction is already safe.
 *
 * ─── Why this drives `buildServer()` and not a hand-built instance ────────
 *
 * The first version of this test imported the five route modules and
 * registered them with the prefixes `server.ts` uses. Within those five it was
 * sound — but it could not see a sixth route file, or a route declared inline
 * in `buildServer` itself, and `/api/health` is exactly that. A `PUBLIC_ROUTE`
 * marking in either place would have landed with zero test pressure, which is
 * the failure this file exists to prevent, reproduced one level up. A test
 * that mirrors the thing it is testing tests the mirror.
 *
 * `buildServer` therefore takes an optional `onRoute` observer (it builds its
 * own instance, so there is no way to attach one from outside), and this reads
 * the real table. Nothing is stubbed except the four environment variables the
 * factory refuses to boot without: no connection is opened — `postgres.js`
 * pools lazily and `createClient` does no I/O — no handler runs, and the
 * instance is closed immediately, which clears the retry interval.
 */

import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "../../server.js";

/**
 * Every route this API serves without a session.
 *
 * Each line is a decision. The reasoning lives in each file's header — the
 * portal's review of all fifteen of its routes, invitations' three, the
 * Postmark webhook's Basic-auth verification, health's probe rationale, and
 * Better Auth's own endpoints being how a session starts at all — and belongs
 * there rather than duplicated here, where it would drift.
 */
const EXPECTED_PUBLIC_ROUTES = [
  "GET /api/auth/*",
  "GET /api/health",
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
  "POST /api/auth/*",
  "POST /api/invitations/accept",
  "POST /api/webhooks/postmark",
];

/**
 * Every route this API serves to a session that resolves to NO town.
 *
 * Task C2's third category (`SESSION_WITHOUT_TENANT` in
 * `auth/route-access.ts`). It is pinned for the same reason the public set is:
 * the marker relaxes a check, and a relaxation that can be added without
 * appearing in a diff is one that will be added to make a 403 go away.
 *
 * There are exactly two moments a real identity has no town — just after
 * sign-up, and just after an invitation is accepted — and exactly two routes
 * that must work then. A third entry here should be hard to justify.
 */
const EXPECTED_TENANT_EXEMPT_ROUTES = ["GET /api/me", "POST /api/onboarding"];

interface CollectedRoute {
  readonly signature: string;
  readonly isPublic: boolean;
  readonly tenantExempt: boolean;
}

/** The environment `buildServer` refuses to boot without. */
const REQUIRED_ENV = {
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-this-test-only",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost:5432/postgres",
} as const;

const savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  for (const [key, previous] of Object.entries(savedEnv)) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

async function collectRoutes(): Promise<CollectedRoute[]> {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const collected: CollectedRoute[] = [];
  const app = await buildServer({
    onRoute(route) {
      // Fastify expands a multi-method route into one `onRoute` call carrying
      // an array — Better Auth's handler is `["GET", "POST"]`. Flattening keeps
      // one of those methods from being silently dropped.
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        collected.push({
          signature: `${method} ${route.url}`,
          isPublic: route.config?.auth === "public",
          tenantExempt: route.config?.auth === "session-without-tenant",
        });
      }
    },
  });
  // Closing clears the notification retry interval and the database pool.
  await app.close();

  return collected;
}

/** `HEAD` is auto-registered beside each `GET` and inherits its config. */
function withoutHeadTwins(routes: CollectedRoute[]): CollectedRoute[] {
  return routes.filter((r) => !r.signature.startsWith("HEAD "));
}

describe("the public route inventory", () => {
  it("serves exactly these routes without a session, and no others", async () => {
    const routes = withoutHeadTwins(await collectRoutes());

    const publicSignatures = routes
      .filter((r) => r.isPublic)
      .map((r) => r.signature)
      .sort();

    expect(publicSignatures).toEqual([...EXPECTED_PUBLIC_ROUTES].sort());
  });

  it("serves exactly these routes to a session with no town, and no others", async () => {
    const routes = withoutHeadTwins(await collectRoutes());

    const exemptSignatures = routes
      .filter((r) => r.tenantExempt)
      .map((r) => r.signature)
      .sort();

    expect(exemptSignatures).toEqual([...EXPECTED_TENANT_EXEMPT_ROUTES].sort());
  });

  it("keeps the public and tenant-exempt sets disjoint", async () => {
    const routes = withoutHeadTwins(await collectRoutes());

    // `config.auth` is a single value, so this cannot currently be violated —
    // which is the point of asserting it. If the marker ever becomes a set of
    // flags, a route that is both "reachable without a session" and "reachable
    // without a town" is a route whose author has stopped distinguishing the
    // two, and this fails before it ships.
    expect(routes.filter((r) => r.isPublic && r.tenantExempt)).toEqual([]);
  });

  it("reads the REAL route table, inline routes included", async () => {
    const routes = withoutHeadTwins(await collectRoutes());
    const signatures = routes.map((r) => r.signature);

    // The specific gap this test was rewritten to close: `/api/health` and
    // Better Auth's handler are declared inside `buildServer` and
    // `auth/fastify.ts`, not in any of the five route files. A test that
    // imported those five could not see either, so a `PUBLIC_ROUTE` marking
    // there had no test pressure at all.
    expect(signatures).toContain("GET /api/health");
    expect(signatures).toContain("GET /api/auth/*");
    expect(signatures).toContain("POST /api/auth/*");

    // And a route from each of the five files, so a registration silently
    // dropped from `server.ts` fails here rather than quietly shrinking the
    // surface this test believes it covers.
    for (const expected of [
      "POST /api/meetings/:meetingId/agenda-packet", // documents.ts
      "POST /api/meetings/:meetingId/minutes/approve", // minutes.ts
      "GET /api/portal/resolve", // portal.ts
      "POST /api/webhooks/postmark", // notifications.ts
      "POST /api/invitations/:id/send", // invitations.ts
    ]) {
      expect(signatures).toContain(expected);
    }

    // Guards against a vacuous pass: an empty table would satisfy every
    // `toEqual` on the public set above.
    expect(routes.length).toBeGreaterThan(30);
  });

  it("leaves every notification route except the webhook requiring a session", async () => {
    const routes = withoutHeadTwins(await collectRoutes());
    const notificationRoutes = routes.filter(
      (r) =>
        r.signature.includes("/api/admin/notifications") ||
        r.signature.includes("/api/notifications/") ||
        r.signature.includes("/api/webhooks/"),
    );

    // The specific regression this task closed: ten routes in one file, none
    // of them requiring anything.
    expect(notificationRoutes.filter((r) => r.isPublic).map((r) => r.signature)).toEqual([
      "POST /api/webhooks/postmark",
    ]);
    expect(notificationRoutes.length).toBeGreaterThanOrEqual(9);
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
