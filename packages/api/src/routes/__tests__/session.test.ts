/**
 * Stage 1, Task C2 — `GET /api/me` and `POST /api/onboarding`.
 *
 * ─── What these tests are actually protecting ─────────────────────────────
 *
 * Task G1 made every route deny-by-default: no session, or a session that
 * resolves to no town, and the request is refused. That is correct for every
 * route except the two that exist FOR the identity with no town. If those two
 * are wrong in either direction the product has no way in:
 *
 *   - too strict, and a newly signed-up user gets 403 from the wizard that is
 *     supposed to create their town — an unbreakable loop;
 *   - too loose, and `SESSION_WITHOUT_TENANT` becomes a way to reach a handler
 *     with no session at all, which is the whole G1 default undone by a
 *     three-word config value.
 *
 * So the first two tests below assert the loose direction is closed: no
 * session is still 401 on BOTH routes. Nothing else in this file matters more.
 *
 * They run against a real Fastify instance with the real plugin and a real
 * database, because every historical defect in this area — in this repository,
 * repeatedly — has been in the wiring rather than in the predicate.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { betterAuthPlugin } from "../../auth/fastify.js";
import { sessionRoutes } from "../session.js";

const PASSWORD = "correct-horse-battery-staple";

async function buildApp(client: postgres.Sql) {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: "http://localhost:5173",
    sendAuthEmail: async () => {},
  });

  const server = Fastify({ logger: false });
  await server.register(sensible);
  await server.register(betterAuthPlugin, { auth, db });
  await server.register(sessionRoutes, { prefix: "/api" });
  return { server, auth, db };
}

/**
 * Sign up, mark the address verified by writing the flag directly, sign in,
 * and return the cookie.
 *
 * Writing `emailVerified` rather than clicking a link is the seam Task C1
 * built for this: `requireEmailVerification` stays on and the product has no
 * bypass, but a test can construct the state a real click produces.
 */
async function signedInCookie(
  client: postgres.Sql,
  auth: ReturnType<typeof createAuth>,
  email: string,
) {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Clerk" } });
  const [row] = await client<{ id: string }[]>`
    SELECT id FROM better_auth."user" WHERE email = ${email}`;
  await client`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

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

describe("the session routes", () => {
  it("refuses BOTH of them without a session — the marker relaxes tenancy, not authentication", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server } = await buildApp(client);
        try {
          const me = await server.inject({ method: "GET", url: "/api/me" });
          expect(me.statusCode).toBe(401);

          const onboarding = await server.inject({
            method: "POST",
            url: "/api/onboarding",
            payload: { townName: "Newcastle" },
          });
          expect(onboarding.statusCode).toBe(401);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("refuses a meaningless session cookie", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server } = await buildApp(client);
        try {
          const res = await server.inject({
            method: "GET",
            url: "/api/me",
            headers: { cookie: "better-auth.session_token=not-a-real-token" },
          });
          expect(res.statusCode).toBe(401);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("reports townId: null for a signed-in identity with no town, rather than 403", async () => {
    // The whole reason this route is marked `SESSION_WITHOUT_TENANT`. A 403 is
    // also what a deleted account and a broken mapping produce, so the client
    // cannot tell "go to the wizard" from "something is wrong" — it would send
    // a user with a real problem round the setup flow forever.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(client);
        try {
          const { cookie, authUserId } = await signedInCookie(client, auth, "new@example.gov");
          const res = await server.inject({
            method: "GET",
            url: "/api/me",
            headers: { cookie },
          });

          expect(res.statusCode).toBe(200);
          expect(res.json()).toMatchObject({
            authUserId,
            email: "new@example.gov",
            emailVerified: true,
            id: null,
            townId: null,
            role: null,
            permissions: null,
          });
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("creates a town, then reports the full identity that town gives", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(client);
        try {
          const { cookie, authUserId } = await signedInCookie(client, auth, "clerk@example.gov");

          const created = await server.inject({
            method: "POST",
            url: "/api/onboarding",
            headers: { cookie },
            payload: {
              townName: "Newcastle",
              state: "ME",
              boardName: "Select Board",
              memberCount: 5,
              contactName: "Ada Clerk",
              // Deliberately supplied and deliberately ignored: the contact
              // email is the session's, never the body's.
              contactEmail: "attacker@example.com",
            },
          });

          expect(created.statusCode).toBe(201);
          const { townId, personId, userAccountId } = created.json();
          expect(townId).toBeTruthy();

          // The two-sided link C1 built, now reachable over HTTP.
          const [account] = await owner<{ auth_user_id: string | null }[]>`
            SELECT auth_user_id FROM user_account WHERE id = ${userAccountId}`;
          expect(account!.auth_user_id).toBe(authUserId);
          const [mapping] = await owner<{ town_id: string }[]>`
            SELECT town_id FROM better_auth.user_tenant WHERE auth_user_id = ${authUserId}`;
          expect(mapping!.town_id).toBe(townId);

          // The contact email came from the session, not from the payload.
          const [person] = await owner<{ email: string }[]>`
            SELECT email FROM person WHERE id = ${personId}`;
          expect(person!.email).toBe("clerk@example.gov");

          const me = await server.inject({ method: "GET", url: "/api/me", headers: { cookie } });
          expect(me.statusCode).toBe(200);
          expect(me.json()).toMatchObject({
            id: userAccountId,
            personId,
            townId,
            role: "admin",
          });
          // `id` is `user_account.id`, NOT the auth identity — the web client
          // writes it into `meeting.created_by`, a foreign key to
          // `user_account(id)`. The old JWT claim put the auth id there.
          expect(me.json().id).not.toBe(authUserId);
          expect(me.json().permissions).toBeTruthy();
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("refuses a second town for the same identity, with 409 rather than a constraint name", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(client);
        try {
          const { cookie } = await signedInCookie(client, auth, "clerk@example.gov");
          const payload = { townName: "Newcastle", contactName: "Ada Clerk" };

          const first = await server.inject({
            method: "POST",
            url: "/api/onboarding",
            headers: { cookie },
            payload,
          });
          expect(first.statusCode).toBe(201);

          const second = await server.inject({
            method: "POST",
            url: "/api/onboarding",
            headers: { cookie },
            payload: { townName: "Bristol", contactName: "Ada Clerk" },
          });
          expect(second.statusCode).toBe(409);

          // And the second town did not half-exist.
          const towns = await owner<{ name: string }[]>`SELECT name FROM town ORDER BY name`;
          expect(towns.map((t) => t.name)).toEqual(["Newcastle"]);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("rejects an onboarding payload with no town name", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(client);
        try {
          const { cookie } = await signedInCookie(client, auth, "clerk@example.gov");
          const res = await server.inject({
            method: "POST",
            url: "/api/onboarding",
            headers: { cookie },
            payload: { townName: "   " },
          });
          expect(res.statusCode).toBe(400);
          expect(await owner`SELECT 1 FROM town`).toHaveLength(0);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });
});
