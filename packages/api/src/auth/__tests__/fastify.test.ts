/**
 * Stage 1, Task C1, step 7 — the plugin, over real HTTP.
 *
 * `tenant-context.test.ts` proves `resolveTenant` refuses a session that
 * belongs nowhere. That proves nothing about whether the refusal is WIRED UP:
 * a preHandler that swallowed the error, or one registered after the routes it
 * was meant to guard, would leave every one of those tests passing while the
 * running server happily served an empty context.
 *
 * So these drive `app.inject()` against a real Fastify instance with the real
 * plugin, and assert on status codes.
 *
 * The instance is built here rather than with `buildServer()` because that
 * pulls in the Supabase client, Postmark and the notification retry loop —
 * none of which this is about, all of which would have to be stubbed, and each
 * stub a chance for the test to stop resembling the thing it tests.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../auth.js";
import { completeOnboarding } from "../onboarding.js";
import { betterAuthPlugin } from "../fastify.js";

const PASSWORD = "correct-horse-battery-staple";

async function buildApp(app: postgres.Sql) {
  const db = drizzle(app);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: "http://localhost:3000",
    sendAuthEmail: async () => {},
  });

  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(betterAuthPlugin, { auth, db });

  // Stands in for the public portal: no session required, ever.
  server.get("/api/portal/meetings", async () => ({ ok: true }));

  // Stands in for an authenticated route, and proves the tenant context the
  // preHandler installs actually scopes a query.
  server.get("/api/towns", async (request, reply) => {
    if (!request.tenant || !request.withTenant) return reply.unauthorized();
    const names = await request.withTenant(async (tx) => {
      // `TenantTx.execute` is deliberately minimal — it returns `unknown`, so
      // a route has to say what it expects. Noted as a finding for Task D1,
      // which owns the typed query layer; casting here keeps this test about
      // the preHandler rather than about ergonomics.
      const rows = await tx.execute(sql`SELECT name FROM town ORDER BY name`);
      return [...(rows as Iterable<{ name: string }>)];
    });
    return { names };
  });

  return { server, auth, db };
}

/** Sign up, verify by writing the flag directly, sign in, return the cookie. */
async function signedInCookie(
  app: postgres.Sql,
  auth: ReturnType<typeof createAuth>,
  email: string,
): Promise<{ cookie: string; authUserId: string }> {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Clerk" } });
  const [row] = await app<{ id: string }[]>`
    SELECT id FROM better_auth."user" WHERE email = ${email}
  `;
  await app`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

  const response = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });

  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, authUserId: row!.id };
}

describe("the Better Auth Fastify plugin", () => {
  it("serves a sessionless request — the public portal must keep working", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { server } = await buildApp(app);
        try {
          const res = await server.inject({ method: "GET", url: "/api/portal/meetings" });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toEqual({ ok: true });
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  });

  it("mounts Better Auth's own endpoints, and they do not require a tenant", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { server } = await buildApp(app);
        try {
          const res = await server.inject({
            method: "POST",
            url: "/api/auth/sign-up/email",
            headers: { "content-type": "application/json" },
            payload: JSON.stringify({
              email: "clerk@example.gov",
              password: PASSWORD,
              name: "Clerk",
            }),
          });
          expect(res.statusCode).toBe(200);

          const users = await app<{ email: string }[]>`SELECT email FROM better_auth."user"`;
          expect(users.map((u) => u.email)).toEqual(["clerk@example.gov"]);
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  });

  it("REFUSES an authenticated session that belongs to no town", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(app);
        try {
          // Signed up, verified, signed in — and never onboarded. Everything
          // about this request is legitimate except that there is no town.
          const { cookie } = await signedInCookie(app, auth, "orphan@example.gov");

          const res = await server.inject({
            method: "GET",
            url: "/api/towns",
            headers: { cookie },
          });

          // 403, not 200-with-nothing. This single assertion is the reason the
          // whole task exists: without it the response is a cheerful 200 and an
          // empty list, which looks exactly like a town with no data.
          expect(res.statusCode).toBe(403);
          expect(res.json().message).toMatch(/not associated with a town/i);
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  });

  it("REFUSES a session whose user_account was deleted mid-session", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { server, auth, db } = await buildApp(app);
        try {
          const { cookie, authUserId } = await signedInCookie(app, auth, "clerk@example.gov");
          const onboarded = await completeOnboarding(db, {
            authUserId,
            townName: "Newcastle",
          });

          const before = await server.inject({
            method: "GET",
            url: "/api/towns",
            headers: { cookie },
          });
          expect(before.statusCode).toBe(200);

          await app.begin(async (tx) => {
            await tx`SELECT set_config('app.town_id', ${onboarded.townId}, true)`;
            await tx`DELETE FROM user_account WHERE id = ${onboarded.userAccountId}`;
          });

          const after = await server.inject({
            method: "GET",
            url: "/api/towns",
            headers: { cookie },
          });
          expect(after.statusCode).toBe(403);
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  });

  it("gives an onboarded session a tenant context that scopes its queries", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { server, auth, db } = await buildApp(app);
        try {
          const { cookie, authUserId } = await signedInCookie(app, auth, "clerk@example.gov");
          const onboarded = await completeOnboarding(db, { authUserId, townName: "Newcastle" });

          // A second town, belonging to nobody in this session. The positive
          // control is that town A comes back; the negative control is that
          // town B does not.
          const otherAuthUser = "auth-user-other";
          await app`INSERT INTO better_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
                    VALUES (${otherAuthUser}, 'Other', 'other@example.gov', true, now(), now())`;
          await completeOnboarding(db, { authUserId: otherAuthUser, townName: "Bristol" });

          const res = await server.inject({
            method: "GET",
            url: "/api/towns",
            headers: { cookie },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toEqual({ names: [{ name: "Newcastle" }] });
          expect(JSON.stringify(res.json())).not.toContain("Bristol");
          expect(onboarded.townId).toBeTruthy();
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  });
});
