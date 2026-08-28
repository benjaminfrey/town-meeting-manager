/**
 * Stage 1, Task G1 — the gate. THE test in this file is the first one.
 *
 * Closing ten unauthenticated routes in `routes/notifications.ts` is the easy
 * half of this task and it decays the moment someone adds an eleventh. The
 * half that lasts is that a route added LATER, with no marking, is refused —
 * and the only way that stays true is a test that adds exactly such a route
 * and asserts on the refusal. If someone reverts `route-access.ts` to a no-op,
 * or moves the preHandler somewhere it stops running, or marks something
 * public by accident, one of these fails.
 *
 * These drive a real Fastify instance over `inject()` rather than unit-testing
 * `isPublicRoute`, because every historical failure in this area was in the
 * WIRING — a hook that did not run, a config key read from the wrong place —
 * and a unit test of the predicate would have passed through all of them.
 *
 * They need a database because the plugin under test resolves Better Auth
 * sessions against one; `withTestDb` provisions and drops a throwaway.
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth, type Auth } from "../auth.js";
import { completeOnboarding } from "../onboarding.js";
import { betterAuthPlugin } from "../fastify.js";
import { authPlugin, requirePermission, requireAdmin } from "../../plugins/auth.js";
import { PUBLIC_ROUTE } from "../route-access.js";

const PASSWORD = "correct-horse-battery-staple";

async function buildApp(app: postgres.Sql): Promise<FastifyInstance> {
  const db = drizzle(app);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: "http://localhost:3000",
    sendAuthEmail: async () => {},
  });

  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(betterAuthPlugin, { auth, db, allowedOrigins: ["http://localhost:3000"] });
  return server;
}

/** Run `fn` against a server wired exactly like the real one. */
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

describe("deny-by-default route access", () => {
  it("REFUSES a brand-new route that carries no auth marking", async () => {
    await withServer(async (server) => {
      // A route written the way every route in this repository was written
      // before Task G1: a path, a handler, and nothing about authentication.
      // The author has not thought about auth at all — which is the case this
      // whole task exists to make safe.
      let handlerRan = false;
      server.get("/api/some-feature-added-next-quarter", async () => {
        handlerRan = true;
        return { secrets: "everything in this town" };
      });

      const res = await server.inject({
        method: "GET",
        url: "/api/some-feature-added-next-quarter",
      });

      expect(res.statusCode).toBe(401);
      // The handler must not have run. A 401 produced AFTER the handler did its
      // work would still have read the database, and for a POST would still
      // have written to it.
      expect(handlerRan).toBe(false);
      // And the refusal has to tell the next person what to do about it,
      // because the first encounter with this will be someone's route
      // mysteriously 401ing in development.
      expect(res.json().message).toMatch(/PUBLIC_ROUTE/);
    });
  });

  it("REFUSES an unmarked route for every method, not just GET", async () => {
    await withServer(async (server) => {
      server.post("/api/unmarked-write", async () => ({ ok: true }));
      server.delete("/api/unmarked-delete", async () => ({ ok: true }));
      server.put("/api/unmarked-put", async () => ({ ok: true }));

      for (const [method, url] of [
        ["POST", "/api/unmarked-write"],
        ["DELETE", "/api/unmarked-delete"],
        ["PUT", "/api/unmarked-put"],
      ] as const) {
        const res = await server.inject({ method, url, payload: {} });
        expect(`${method} ${res.statusCode}`).toBe(`${method} 401`);
      }
    });
  });

  it("serves a route that is explicitly marked public", async () => {
    await withServer(async (server) => {
      server.get("/api/portal/anything", { config: { ...PUBLIC_ROUTE } }, async () => ({
        ok: true,
      }));

      const res = await server.inject({ method: "GET", url: "/api/portal/anything" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  it("does not let one route's public marking leak onto a sibling", async () => {
    // The marking is read from the MATCHED route's config. A path that shares a
    // prefix with a public route — the shape a `startsWith` check on the URL
    // would have got wrong — must still be refused.
    await withServer(async (server) => {
      server.get("/api/portal/public-thing", { config: { ...PUBLIC_ROUTE } }, async () => ({
        ok: true,
      }));
      server.get("/api/portal/public-thing/private-part", async () => ({ ok: true }));

      const open = await server.inject({ method: "GET", url: "/api/portal/public-thing" });
      const shut = await server.inject({
        method: "GET",
        url: "/api/portal/public-thing/private-part",
      });

      expect(open.statusCode).toBe(200);
      expect(shut.statusCode).toBe(401);
    });
  });

  it("still refuses when a session cookie is present but meaningless", async () => {
    await withServer(async (server) => {
      server.get("/api/unmarked", async () => ({ ok: true }));

      const res = await server.inject({
        method: "GET",
        url: "/api/unmarked",
        headers: { cookie: "better-auth.session_token=not-a-real-token" },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  it("covers routes registered BEFORE the plugin, not only after", async () => {
    // Fastify runs instance-level hooks for routes registered earlier as well
    // as later. Nothing in `server.ts` relies on this today — every route is
    // registered after `betterAuthPlugin`, including `/api/health` — so this
    // pins a property rather than protecting a current caller. It is worth
    // pinning anyway: without it, registration order would silently decide
    // which routes were protected, and the first route to be added above the
    // plugin would be served to anyone with nothing in the diff to show it.
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const auth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:3000",
          sendAuthEmail: async () => {},
        });

        const server = Fastify({ logger: false });
        await server.register(sensible);
        // Registered FIRST — before the plugin that installs the hook.
        server.get("/api/registered-before-the-hook", async () => ({ ok: true }));
        await server.register(betterAuthPlugin, {
          auth,
          db,
          allowedOrigins: ["http://localhost:3000"],
        });

        try {
          const res = await server.inject({
            method: "GET",
            url: "/api/registered-before-the-hook",
          });
          expect(res.statusCode).toBe(401);
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  });

  it("answers 401, not 404, for a path that matches no route", async () => {
    // Fastify runs instance-level request hooks for the default 404 handler
    // too, and an unmatched request has no route config — so it is not public,
    // so it is refused. Documented and pinned rather than left as a surprise:
    //
    //   - It is DEFENSIBLE and mildly preferable: an anonymous caller cannot
    //     use status codes to map which routes exist.
    //   - It is also a real change in behaviour. Anything that distinguishes
    //     "wrong URL" from "not signed in" by status code — a smoke test, an
    //     uptime monitor pointed at a typo, a developer wondering why their
    //     new route 401s (see the first test in this file) — sees 401 now.
    //   - A signed-in request to a nonexistent path still gets 404, so the
    //     oracle is closed only for anonymous callers.
    await withServer(async (server) => {
      const res = await server.inject({ method: "GET", url: "/api/no-such-path" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("runs the gate ahead of a route's own onRequest hook", async () => {
    // The one shape a `preHandler` gate could not cover: route-level
    // `onRequest` runs BEFORE instance-level `preHandler`, so a route could
    // have replied before the gate ever ran. No route in this codebase has
    // such a hook, which is why moving the gate to `onRequest` was cheap — but
    // "theoretical until someone adds one" is the exact shape of the omission
    // this whole task exists to make impossible.
    await withServer(async (server) => {
      let routeHookRan = false;
      server.get(
        "/api/route-with-its-own-onrequest",
        {
          onRequest: [
            async (_request, reply) => {
              routeHookRan = true;
              return reply.send({ secrets: "everything in this town" });
            },
          ],
        },
        async () => ({ ok: true }),
      );

      const res = await server.inject({
        method: "GET",
        url: "/api/route-with-its-own-onrequest",
      });

      expect(res.statusCode).toBe(401);
      expect(routeHookRan).toBe(false);
    });
  });

  it("refuses an unmarked POST before its body is parsed", async () => {
    // `onRequest` fires before body parsing, so an unauthenticated POST no
    // longer has its payload read and JSON-parsed on the way to being refused.
    // Asserted through a content-type parser that records whether it ran: a
    // 401 alone would not distinguish "refused early" from "parsed, then
    // refused".
    await withServer(async (server) => {
      let parserRan = false;
      server.addContentTypeParser(
        "application/vnd.test+json",
        { parseAs: "string" },
        (_request, body, done) => {
          parserRan = true;
          done(null, body);
        },
      );
      server.post("/api/unmarked-body", async () => ({ ok: true }));

      const res = await server.inject({
        method: "POST",
        url: "/api/unmarked-body",
        headers: { "content-type": "application/vnd.test+json" },
        payload: "{}",
      });

      expect(res.statusCode).toBe(401);
      expect(parserRan).toBe(false);
    });
  });

  it("keeps Better Auth's own endpoints reachable — a session has to start somewhere", async () => {
    await withServer(async (server) => {
      const res = await server.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          email: "clerk@example.gov",
          password: "correct-horse-battery-staple",
          name: "Clerk",
        }),
      });
      expect(res.statusCode).toBe(200);
    });
  });
});

/**
 * Task G1's other half: `request.user` is now built from the RLS-verified
 * tenant and a `user_account` row, not from an unverified JWT payload.
 *
 * These exist for three reasons, in order of how expensively each would fail:
 *
 *   1. **Hook ordering.** `verifyAuth` reads `request.tenant`, which the
 *      instance-level `onRequest` gate in `auth/fastify.ts` sets. Fastify runs
 *      instance-level `onRequest` hooks before any route-level hook — verified
 *      empirically, and pinned here, because if that were the other way round
 *      every authenticated route in the API would 401 and the cause would not
 *      be visible in either file.
 *   2. **`request.user.id` is `user_account.id`.** Four call sites already
 *      used it that way; the old implementation put the auth provider's user
 *      id there. The two coinciding was luck, and it is the sort of thing that
 *      surfaces as a foreign key violation on a Tuesday.
 *   3. **Role and permissions come from the database.** Nothing on
 *      `request.user` is derived from anything the client sent.
 */
describe("identity on an authenticated request", () => {
  async function withOnboardedSession(
    fn: (ctx: {
      server: FastifyInstance;
      cookie: string;
      townId: string;
      personId: string;
      userAccountId: string;
    }) => Promise<void>,
  ): Promise<void> {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = drizzle(app);
        const auth: Auth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:3000",
          sendAuthEmail: async () => {},
        });

        const server = Fastify({ logger: false });
        await server.register(sensible);
        await server.register(betterAuthPlugin, {
          auth,
          db,
          allowedOrigins: ["http://localhost:3000"],
        });
        await server.register(authPlugin);

        // Routes that use the decorator the way the real route files do.
        server.get("/api/me", { preHandler: [server.verifyAuth] }, async (request) => request.user);
        server.get(
          "/api/notification-admin",
          { preHandler: [server.verifyAuth, requirePermission("manage_notification_settings")] },
          async () => ({ ok: true }),
        );
        server.get(
          "/api/admin-only",
          { preHandler: [server.verifyAuth, requireAdmin("a test")] },
          async () => ({ ok: true }),
        );

        try {
          const email = "clerk@example.gov";
          await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Clerk" } });
          const [row] = await app<{ id: string }[]>`
            SELECT id FROM better_auth."user" WHERE email = ${email}
          `;
          await app`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

          const onboarded = await completeOnboarding(db, {
            authUserId: row!.id,
            townName: "Newcastle",
          });

          const signIn = await auth.api.signInEmail({
            body: { email, password: PASSWORD },
            asResponse: true,
          });
          const cookie = signIn.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; ");

          await fn({ server, cookie, ...onboarded });
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  }

  it("populates request.user from the database, with user_account.id as the id", async () => {
    await withOnboardedSession(async ({ server, cookie, townId, personId, userAccountId }) => {
      const res = await server.inject({ method: "GET", url: "/api/me", headers: { cookie } });

      expect(res.statusCode).toBe(200);
      const user = res.json();
      // The id `invitations.ts`, `minutes.ts` and `notifications.ts` all write
      // to `user_account`-shaped columns.
      expect(user.id).toBe(userAccountId);
      expect(user.personId).toBe(personId);
      expect(user.townId).toBe(townId);
      // `complete_onboarding` creates the first account as an admin with the
      // default empty matrix — read from the row, not asserted by the client.
      expect(user.role).toBe("admin");
      expect(user.permissions).toEqual({ global: {}, board_overrides: [] });
    });
  });

  it("lets an admin through both a permission check and an admin-only check", async () => {
    await withOnboardedSession(async ({ server, cookie }) => {
      const permissioned = await server.inject({
        method: "GET",
        url: "/api/notification-admin",
        headers: { cookie },
      });
      const adminOnly = await server.inject({
        method: "GET",
        url: "/api/admin-only",
        headers: { cookie },
      });
      expect(permissioned.statusCode).toBe(200);
      expect(adminOnly.statusCode).toBe(200);
    });
  });

  it("refuses a verifyAuth route with no session, before the handler runs", async () => {
    await withOnboardedSession(async ({ server }) => {
      const res = await server.inject({ method: "GET", url: "/api/me" });
      expect(res.statusCode).toBe(401);
    });
  });

  it("ignores JWT-shaped claims in an Authorization header entirely", async () => {
    // The collapsed authority, stated as a test. This is a syntactically valid
    // unsigned JWT whose payload claims a different town, an admin role and a
    // full permission set — exactly what `decodeJwtPayload` used to read and
    // what `invitations.ts` used to authorise on. It must change nothing.
    await withOnboardedSession(async ({ server, cookie, townId, userAccountId }) => {
      const payload = Buffer.from(
        JSON.stringify({
          sub: "someone-else",
          town_id: "00000000-0000-4000-8000-000000000000",
          role: "sys_admin",
          person_id: "00000000-0000-4000-8000-000000000001",
          permissions: { manage_town_settings: true },
        }),
        "utf8",
      ).toString("base64url");
      const forged = `header.${payload}.signature`;

      const res = await server.inject({
        method: "GET",
        url: "/api/me",
        headers: { cookie, authorization: `Bearer ${forged}` },
      });

      expect(res.statusCode).toBe(200);
      const user = res.json();
      expect(user.townId).toBe(townId);
      expect(user.id).toBe(userAccountId);
      expect(user.role).toBe("admin");
      expect(user.permissions).toEqual({ global: {}, board_overrides: [] });
    });
  });

  it("refuses a forged Bearer token on its own, with no session cookie", async () => {
    await withOnboardedSession(async ({ server }) => {
      const payload = Buffer.from(
        JSON.stringify({ sub: "attacker", town_id: "00000000-0000-4000-8000-000000000000" }),
        "utf8",
      ).toString("base64url");

      const res = await server.inject({
        method: "GET",
        url: "/api/me",
        headers: { authorization: `Bearer header.${payload}.signature` },
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
