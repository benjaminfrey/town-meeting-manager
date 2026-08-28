/**
 * Stage 1, Task C2 — the origin arrangement, measured rather than assumed.
 *
 * ─── The claim being tested ───────────────────────────────────────────────
 *
 * The whole session design rests on the app and the API being the SAME ORIGIN
 * in every environment: `infrastructure/nginx/nginx.conf` proxies `/api/` on
 * the `app.` server block in production, `packages/web/vite.config.ts` proxies
 * `/api` in development, and `packages/web/src/lib/api-client.ts` only ever
 * builds root-relative URLs. That is what lets the session cookie stay
 * `SameSite=Lax` instead of `SameSite=None` plus a header check.
 *
 * Better Auth enforces its half by comparing the request's `Origin` header
 * against `trustedOrigins`, which it derives from `baseURL`. So `baseURL` must
 * be **the origin the browser loads the app from** — NOT the address this
 * process listens on. Before this task it defaulted to `http://localhost:3000`
 * while Vite serves on `5173`, which would have made every sign-in a 403
 * `INVALID_ORIGIN`.
 *
 * That is a two-line configuration relationship spread across three files, in
 * three different languages, none of which references the others. Exactly the
 * kind of thing that is "obviously right" until someone changes a port. So it
 * is measured here, over HTTP, against a real Better Auth instance.
 *
 * ─── Why `changeOrigin: false` in the Vite proxy is part of it ────────────
 *
 * nginx forwards `proxy_set_header Host $host`, so in production this process
 * sees the app's host. `changeOrigin: true` in Vite would rewrite `Host` to
 * `localhost:3001`, and Better Auth reconstructs the request URL from
 * `request.protocol` + `request.host`. Development would then differ from
 * production on the one header authentication actually reads. The third test
 * below pins the header combination the dev proxy produces.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../auth.js";
import { betterAuthPlugin } from "../fastify.js";

/** The origin the browser uses in development: the Vite dev server. */
const APP_ORIGIN = "http://localhost:5173";
const APP_HOST = "localhost:5173";
const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "clerk@example.gov";

async function buildApp(client: postgres.Sql) {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    // Matches `server.ts`'s default. The point of the test.
    baseURL: APP_ORIGIN,
    sendAuthEmail: async () => {},
  });

  const server = Fastify({ logger: false, trustProxy: true });
  await server.register(sensible);
  await server.register(betterAuthPlugin, { auth, db, allowedOrigins: [APP_ORIGIN] });
  return { server, auth, db };
}

async function seedVerifiedUser(client: postgres.Sql, auth: ReturnType<typeof createAuth>) {
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Clerk" } });
  await client`UPDATE better_auth."user" SET "emailVerified" = true WHERE email = ${EMAIL}`;
}

describe("the same-origin arrangement", () => {
  it("accepts a sign-in from the app's own origin", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(client);
        try {
          await seedVerifiedUser(client, auth);

          const res = await server.inject({
            method: "POST",
            url: "/api/auth/sign-in/email",
            headers: {
              host: APP_HOST,
              origin: APP_ORIGIN,
              "content-type": "application/json",
            },
            payload: { email: EMAIL, password: PASSWORD },
          });

          expect(res.statusCode).toBe(200);
          // And a session cookie actually comes back — a 200 with no
          // `Set-Cookie` would leave the browser signed out while every
          // screen believed otherwise.
          const cookies = res.headers["set-cookie"];
          const asArray = Array.isArray(cookies) ? cookies : [cookies];
          expect(asArray.join(";")).toContain("session_token");
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("REFUSES a sign-in posted from another site", async () => {
    // The property `SameSite=Lax` plus this check buys: a page on another
    // origin cannot drive this API on a user's behalf.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(client);
        try {
          await seedVerifiedUser(client, auth);

          const res = await server.inject({
            method: "POST",
            url: "/api/auth/sign-in/email",
            headers: {
              host: APP_HOST,
              origin: "https://evil.example.com",
              cookie: "anything=1",
              "content-type": "application/json",
            },
            payload: { email: EMAIL, password: PASSWORD },
          });

          expect(res.statusCode).toBe(403);
          expect(res.headers["set-cookie"]).toBeUndefined();
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("would REFUSE if baseURL named this process's port instead of the app's", async () => {
    // The regression this file exists for, reproduced deliberately.
    // `BETTER_AUTH_URL` used to default to `http://localhost:3000` — the API,
    // not the app — and the failure is a 403 during sign-in with nothing in
    // the client-side code to point at.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const db = drizzle(client);
        const auth = createAuth({
          db,
          secret: "0123456789abcdef0123456789abcdef",
          baseURL: "http://localhost:3001",
          sendAuthEmail: async () => {},
        });
        const server = Fastify({ logger: false, trustProxy: true });
        await server.register(sensible);
        await server.register(betterAuthPlugin, { auth, db, allowedOrigins: [APP_ORIGIN] });

        try {
          await seedVerifiedUser(client, auth);

          const res = await server.inject({
            method: "POST",
            url: "/api/auth/sign-in/email",
            headers: {
              host: APP_HOST,
              origin: APP_ORIGIN,
              cookie: "anything=1",
              "content-type": "application/json",
            },
            payload: { email: EMAIL, password: PASSWORD },
          });

          expect(res.statusCode).toBe(403);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });
});
