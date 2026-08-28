/**
 * Stage 1, Task C1, step 7 — Better Auth on Fastify, and the tenant preHandler.
 *
 * Two things live here:
 *
 *   1. Better Auth's own handler, mounted at `/api/auth/*`.
 *   2. A `preHandler` that turns a session into a tenant context, or refuses.
 *
 * ─── Why `/api/auth/*` and not a separate origin ──────────────────────────
 *
 * Session cookies. A cross-origin auth server needs `SameSite=None`, which
 * means the cookie is attached to requests from any site, which means CSRF is
 * held off by nothing but a header check. Same-origin lets the cookie stay
 * `SameSite=Lax` and the browser enforce it. `infrastructure/nginx/nginx.conf`
 * proxies `/api/` on the `app.` server block to this process for exactly that
 * reason, mirroring the portal block.
 *
 * That is also why `@fastify/cors` is not extended to cover this route: the
 * point of same-origin is that no cross-origin path remains.
 *
 * ─── Why the preHandler does not open a transaction for the request ───────
 *
 * The brief asks for a preHandler that "runs every authenticated request
 * inside `withTenant`". Taken literally — open a transaction in the hook and
 * hold it until the response — that would pin one pooled connection per
 * in-flight request and hold its locks for the whole handler, including
 * anything slow: PDF generation via Puppeteer, Postmark calls, and the SSE
 * streams the realtime ADR settles on, which never end. A long-lived
 * transaction per SSE subscriber exhausts the pool at a handful of connected
 * clients, and holds row locks open for hours.
 *
 * So the hook resolves the tenant and hands the route a bound
 * `request.withTenant(fn)`, which opens a transaction per unit of work with
 * `app.town_id` already set. What is given up is one transaction per request,
 * which was never a requirement.
 *
 * ─── What that does and does NOT guarantee, stated precisely ──────────────
 *
 * `request` carries no raw database handle, so nothing reached THROUGH THIS
 * BRIDGE can query outside a tenant context.
 *
 * It is not yet true that a route has no other way to reach the database, and
 * this comment should not be read as saying so. `plugins/supabase.ts`
 * decorates the Fastify instance with a SERVICE-ROLE Supabase client, which
 * bypasses RLS entirely, and it is reachable from any handler as
 * `request.server.supabase` — all five existing route files use exactly that.
 * `createAppDb()` is also exported and can be called again.
 *
 * Task D1 is what makes the strong statement true, by removing
 * `supabasePlugin` once the routes that depend on it have moved onto
 * `request.tenant`. Until then this is the tenant-safe path, not the only
 * path, and the difference is worth more than the tidier sentence.
 *
 * ─── The three failure modes, and what each does ──────────────────────────
 *
 *   No session               → continue. The public portal is unauthenticated
 *                              and must keep working; a global reject here
 *                              would take it down.
 *   Session, no town         → 403 and an error-level log. NEVER continue.
 *   Session, account deleted → 403 and an error-level log. NEVER continue.
 *
 * The second and third are the reason this file exists. Continuing with no
 * tenant context does not fail — it succeeds, quietly, returning zero rows
 * from every table, which is indistinguishable from a town that has no data.
 * See `tenant-context.ts`.
 */

import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { withTenant, type TenantTx } from "../db/with-tenant.js";
import { resolveTenant, TenantResolutionError, type ResolvedTenant } from "./tenant-context.js";
import type { TenantResolverDb } from "./tenant-context.js";
import type { Auth } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Present only on requests carrying a session that resolved to a town. */
    tenant?: ResolvedTenant;
    /**
     * Run a unit of work scoped to this request's town.
     *
     * The tenant-safe path — not, today, the only path: `request.server.supabase`
     * is a service-role client that bypasses RLS, and Task D1 removes it. See
     * this file's header.
     */
    withTenant?: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  }
}

export interface BetterAuthPluginOptions {
  auth: Auth;
  db: TenantResolverDb;
  /** Path prefix Better Auth owns. Requests under it skip tenant resolution. */
  basePath?: string;
}

/** Node's `IncomingHttpHeaders` → the WHATWG `Headers` Better Auth expects. */
function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, String(value));
    }
  }
  return headers;
}

export const betterAuthPlugin = fp<BetterAuthPluginOptions>(async (fastify, opts) => {
  const { auth, db } = opts;
  const basePath = opts.basePath ?? "/api/auth";

  // ─── 1. Better Auth's handler ──────────────────────────────────────────
  //
  // Registered inside an ENCAPSULATED child context (a plain `register`, not
  // `fastify-plugin`), which is what confines the content-type parser below to
  // these routes. Replacing Fastify's JSON parser globally would change how
  // every other route in the API receives its body — a change that shows up as
  // a handful of unrelated 400s rather than as anything pointing back here.
  //
  // Why the raw string at all: the exact bytes that arrived are the bytes
  // Better Auth signs and validates. Re-serialising a parsed object
  // (`JSON.stringify(request.body)`) silently changes key order and number
  // formatting.
  await fastify.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });

    scope.route({
      method: ["GET", "POST"],
      url: `${basePath}/*`,
      handler: async (request, reply) => {
        const url = new URL(request.url, `${request.protocol}://${request.host}`);
        const hasBody = request.method !== "GET" && request.method !== "HEAD";
        const body = request.body as string | undefined;

        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers: toWebHeaders(request),
            body: hasBody && body ? body : undefined,
          }),
        );

        reply.status(response.status);

        // `Headers.forEach` folds multiple Set-Cookie values into one
        // comma-joined string, which browsers then parse as a single
        // malformed cookie — sessions silently fail to establish.
        // `getSetCookie()` is the only correct way to read them.
        for (const cookie of response.headers.getSetCookie()) {
          reply.header("set-cookie", cookie);
        }
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
        });

        return reply.send(response.body ? await response.text() : null);
      },
    });
  });

  // ─── 2. The tenant preHandler ──────────────────────────────────────────
  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    // Better Auth's own endpoints establish sessions; they cannot require one.
    if (request.url.startsWith(`${basePath}/`)) return;

    const session = await auth.api.getSession({ headers: toWebHeaders(request) });

    // No session is not an error here. The public portal is unauthenticated,
    // and rejecting sessionless requests globally would take it offline. Routes
    // that need a tenant check `request.tenant` themselves.
    if (!session?.user?.id) return;

    let tenant: ResolvedTenant;
    try {
      tenant = await resolveTenant(db, session);
    } catch (err) {
      if (err instanceof TenantResolutionError) {
        // Error level, not warn. An authenticated identity that belongs to no
        // town is either an interrupted onboarding or a deleted account whose
        // session is still live — both need a human, and neither should be
        // filtered out of a log by default.
        request.log.error(
          { err, authUserId: session.user.id },
          "authenticated session could not be resolved to a town; refusing the request",
        );
        // Deliberately NOT "sign out and sign in again". Signing in again
        // reproduces the same unmapped identity every time, so that advice
        // sends the user round a loop and then to support anyway. The two
        // things that actually resolve this are an administrator finishing
        // the account setup, or a fresh invitation.
        return reply.forbidden(
          "Your account is not linked to a town yet, so there is nothing for it to open. " +
            "Signing in again will not change this — ask your town administrator to " +
            "finish setting up your account or to send you a new invitation.",
        );
      }
      throw err;
    }

    request.tenant = tenant;
    request.withTenant = <T>(fn: (tx: TenantTx) => Promise<T>) =>
      withTenant(db, { townId: tenant.townId }, fn);
  });
});
