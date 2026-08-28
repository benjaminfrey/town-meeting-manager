/**
 * Stage 1, Task C2, review round 1 — the sibling-subdomain escalation.
 *
 * ─── The chain this closes ────────────────────────────────────────────────
 *
 * Three things composed into a live cross-tenant privilege escalation, and
 * only became live when this task moved sessions from a `localStorage` bearer
 * token to a cookie — a token has to be read and attached by script, which the
 * same-origin policy prevents; a cookie is attached by the browser itself.
 *
 *   1. `server.ts` allowed `/\.townmeetingmanager\.com$/` in CORS **with
 *      credentials**. Every town's public portal is such a subdomain.
 *   2. A sibling subdomain is same-**SITE**, so `SameSite=Lax` does not block
 *      it. Lax is about cross-site, and says nothing about cross-origin.
 *   3. Only `/api/auth/*` verified where a request came from, because Better
 *      Auth does that itself. No other route did.
 *
 * The portal renders town-authored content raw (`portal/pages/MinutesView.tsx`,
 * `SearchResults.tsx`), so a clerk of town A could publish scripted minutes
 * that drove this API as an administrator of town B.
 *
 * ─── Why both halves, and why the guard is not redundant with CORS ────────
 *
 * CORS decides who may **read** a response. A simple cross-origin request is
 * still **sent**, and still **executed**, with its response merely withheld —
 * so for anything that changes state, "the attacker could not read the answer"
 * is not a defence. Narrowing the CORS list closes the read; the `Origin`
 * guard in `auth/fastify.ts` closes the write, and does not depend on the
 * browser enforcing anything.
 *
 * The first test is the deliverable: a sibling-subdomain `Origin` on a
 * NON-auth route, carrying a genuinely valid session cookie for a real
 * onboarded admin, is refused and the handler never runs.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../auth.js";
import { completeOnboarding } from "../onboarding.js";
import { betterAuthPlugin } from "../fastify.js";
import { PUBLIC_ROUTE } from "../route-access.js";

const APP_ORIGIN = "https://app.townmeetingmanager.com";
/** A town's public portal. Same SITE as the app — that is the whole problem. */
const PORTAL_ORIGIN = "https://newcastle.townmeetingmanager.com";
const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "clerk@example.gov";

interface Handled {
  calls: number;
}

async function buildApp(client: postgres.Sql) {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: APP_ORIGIN,
    sendAuthEmail: async () => {},
  });

  const server = Fastify({ logger: false, trustProxy: true });
  await server.register(sensible);
  await server.register(betterAuthPlugin, { auth, db, allowedOrigins: [APP_ORIGIN] });

  // A state-changing authenticated route, standing in for every one of them:
  // minutes approval, invitation sending, notification fan-out. None of these
  // verified where the request came from before this guard existed.
  const handled: Handled = { calls: 0 };
  server.post("/api/danger", async () => {
    handled.calls += 1;
    return { ok: true };
  });

  // A public route, to prove the guard does not take the portal offline.
  server.get("/api/portal/meetings", { config: { ...PUBLIC_ROUTE } }, async () => ({ ok: true }));

  return { server, auth, db, handled };
}

/** A real, onboarded admin with a real session cookie. */
async function onboardedCookie(client: postgres.Sql, auth: ReturnType<typeof createAuth>) {
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Clerk" } });
  const [row] = await client<{ id: string }[]>`
    SELECT id FROM better_auth."user" WHERE email = ${EMAIL}`;
  await client`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

  await completeOnboarding(drizzle(client), {
    authUserId: row!.id,
    townName: "Newcastle",
    contactName: "Ada Clerk",
    contactEmail: EMAIL,
  });

  const response = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("cross-origin requests to authenticated routes", () => {
  it("REFUSES a sibling subdomain driving a state-changing route with a valid session", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth, handled } = await buildApp(client);
        try {
          const cookie = await onboardedCookie(client, auth);

          // Control: the same request from the app itself works. Without this,
          // the refusal below could be caused by anything.
          const legitimate = await server.inject({
            method: "POST",
            url: "/api/danger",
            headers: { host: "app.townmeetingmanager.com", origin: APP_ORIGIN, cookie },
          });
          expect(legitimate.statusCode).toBe(200);
          expect(handled.calls).toBe(1);

          // The attack: a script on a town's portal page, cookie attached by
          // the browser because a sibling subdomain is same-site.
          const attack = await server.inject({
            method: "POST",
            url: "/api/danger",
            headers: { host: "app.townmeetingmanager.com", origin: PORTAL_ORIGIN, cookie },
          });

          expect(attack.statusCode).toBe(403);
          // The half that matters: refused BEFORE the handler, so nothing was
          // written. A 403 emitted afterwards would still have done the work.
          expect(handled.calls).toBe(1);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("REFUSES an unrelated origin too, and any origin that does not parse", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth, handled } = await buildApp(client);
        try {
          const cookie = await onboardedCookie(client, auth);

          for (const origin of [
            "https://evil.example.com",
            // A prefix that merely looks like the app host.
            "https://app.townmeetingmanager.com.evil.example",
            // A suffix that merely looks like it.
            "https://evilapp.townmeetingmanager.com",
            "not a url",
          ]) {
            const res = await server.inject({
              method: "POST",
              url: "/api/danger",
              headers: { host: "app.townmeetingmanager.com", origin, cookie },
            });
            expect(res.statusCode, `origin ${origin} was not refused`).toBe(403);
          }
          expect(handled.calls).toBe(0);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("REFUSES a cross-origin GET as well, not only unsafe methods", async () => {
    // A read is an escalation too: the portal script would otherwise pull the
    // whole of another town's data back out through the admin's browser.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth } = await buildApp(client);
        try {
          const cookie = await onboardedCookie(client, auth);
          server.get("/api/read", async () => ({ secrets: true }));

          const res = await server.inject({
            method: "GET",
            url: "/api/read",
            headers: { host: "app.townmeetingmanager.com", origin: PORTAL_ORIGIN, cookie },
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

  it("still serves a request with NO Origin — non-browser callers are not browsers", async () => {
    // `scripts/health-check.sh`, orchestrator probes and any server-to-server
    // client send no `Origin`. A caller that sets none is not a page acting on
    // a signed-in user's behalf, which is the only thing this guard defends
    // against.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server, auth, handled } = await buildApp(client);
        try {
          const cookie = await onboardedCookie(client, auth);
          const res = await server.inject({
            method: "POST",
            url: "/api/danger",
            headers: { host: "app.townmeetingmanager.com", cookie },
          });
          expect(res.statusCode).toBe(200);
          expect(handled.calls).toBe(1);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });

  it("does not take the public portal offline", async () => {
    // The portal is anonymous and cross-origin by nature — nginx proxies its
    // own subdomain's `/api/`. A guard that refused it would have swapped one
    // outage for another.
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { server } = await buildApp(client);
        try {
          const res = await server.inject({
            method: "GET",
            url: "/api/portal/meetings",
            headers: { host: "newcastle.townmeetingmanager.com", origin: PORTAL_ORIGIN },
          });
          expect(res.statusCode).toBe(200);
        } finally {
          await server.close();
        }
      } finally {
        await client.end();
      }
    });
  });
});
