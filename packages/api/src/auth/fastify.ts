/**
 * Stage 1, Task C1, step 7 — Better Auth on Fastify, and the tenant gate.
 *
 * Two things live here:
 *
 *   1. Better Auth's own handler, mounted at `/api/auth/*`.
 *   2. A hook that turns a session into a tenant context, or refuses.
 *      (A `preHandler` in C1; an `onRequest` since Task G1 — see below.)
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
 * ─── Why the gate does not open a transaction for the request ────────────
 *
 * The brief asks for a hook that "runs every authenticated request
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
 * ─── The failure modes, and what each does ────────────────────────────────
 *
 *   Route marked public      → serve, without even looking for a session.
 *   No session, unmarked     → 401. See below — this is Task G1's inversion.
 *   Session, no town         → 403 and an error-level log. NEVER continue.
 *   Session, account deleted → 403 and an error-level log. NEVER continue.
 *
 * Task C2 adds one relaxation, and only one: a route marked
 * `SESSION_WITHOUT_TENANT` is served to a session that resolves to no town,
 * with `request.tenant` and `request.withTenant` left undefined. It exists for
 * the two routes that must work for an identity which does not belong to a
 * town yet — `GET /api/me` and `POST /api/onboarding` — and it relaxes the
 * TENANT requirement only; the session check above is unchanged. Because
 * `request.withTenant` is the only database handle this bridge hands out, such
 * a route has no query it can run until a town exists.
 *
 * The 401 and the two 403s are the reason this file exists. Continuing with no tenant
 * context does not fail — it succeeds, quietly, returning zero rows from every
 * table, which is indistinguishable from a town that has no data. See
 * `tenant-context.ts`.
 *
 * ─── Task G1: the second line used to read "continue" ─────────────────────
 *
 * C1 shipped this hook with `if (!session?.user?.id) return;` — a sessionless
 * request was served, because the public portal is unauthenticated and a blunt
 * global reject would have taken it offline. That was correct for C1 and is
 * the reason G1 was queued behind it: it made "no session" the default answer
 * for every route in the process, including ten in `routes/notifications.ts`
 * that nobody intended to expose.
 *
 * The inversion is one line plus a marker. A sessionless request is now
 * refused unless the matched route carries `config: { ...PUBLIC_ROUTE }`, so
 * the portal keeps working because each of its routes says so, and a route
 * added tomorrow with no marking is refused rather than served. See
 * `route-access.ts` for why the default sits here rather than in each route,
 * and `__tests__/route-access.test.ts` for the test that keeps it true.
 *
 * A public route skips session resolution entirely rather than resolving it
 * and ignoring failures. Resolving would put two round trips on every
 * anonymous portal page view, and — worse — would let an authenticated user
 * whose account is mid-migration get a 403 from a page that is supposed to
 * work for people with no account at all. No public route reads
 * `request.tenant`; a future one that wants to must ask for it explicitly.
 *
 * ─── Why the gate is an `onRequest` hook and not a `preHandler` ───────────
 *
 * G1 first put it in `preHandler`, which was already unbypassable by every
 * shape anyone could find. `onRequest` closes two more, both cheap:
 *
 *   1. **Route-level `onRequest` runs before instance-level `preHandler`.** A
 *      route could therefore have replied — with anything — before the gate
 *      ever ran. No route in this codebase has such a hook, so this was
 *      theoretical; but "theoretical until someone adds one" is the exact
 *      shape of the omission this task exists to make impossible. Instance
 *      `onRequest` precedes route `onRequest`, so there is now no hook a route
 *      can install ahead of the gate.
 *   2. **`onRequest` fires before body parsing.** An unauthenticated POST to
 *      an unmarked route no longer has its body read and JSON-parsed before
 *      being refused.
 *
 * Nothing is given up. Routing has happened by `onRequest`, so
 * `request.routeOptions.config` is populated — that is what the exemption is
 * read from — and `request.tenant` / `request.withTenant` are set before any
 * route-level `preHandler`, which is what `plugins/auth.ts`'s `verifyAuth`
 * needs. `__tests__/route-access.test.ts` pins both orderings.
 */

import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { withTenant, type TenantTx } from "../db/with-tenant.js";
import { resolveTenant, TenantResolutionError, type ResolvedTenant } from "./tenant-context.js";
import type { TenantResolverDb } from "./tenant-context.js";
import { PUBLIC_ROUTE, isPublicRoute, toleratesMissingTenant } from "./route-access.js";
import type { Auth } from "./auth.js";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * The Better Auth instance, so a route can act on identities without
     * constructing a second one (which would sign with a different context and
     * write through a different adapter).
     *
     * `routes/invitations.ts` uses `auth.api.signUpEmail` here — the
     * replacement for `supabase.auth.admin.createUser`, which used the
     * service-role key to create users out of band. There is no equivalent
     * bypass in Better Auth and none is built: creating a user goes through
     * the same endpoint a person's own sign-up does.
     */
    auth: Auth;
    /**
     * The Drizzle handle the tenant bridge resolves against.
     *
     * Exposed so a route reachable WITHOUT a resolved tenant — `POST
     * /api/onboarding`, which creates the town there is not yet one of — can
     * still open a `withTenant` transaction against a town id it generates
     * itself. Every other route must use `request.withTenant`.
     */
    tenantDb: TenantResolverDb;
  }
  interface FastifyRequest {
    /**
     * The authenticated Better Auth identity.
     *
     * Set on every request that carried a valid session, INCLUDING those on
     * routes marked `SESSION_WITHOUT_TENANT` where no town could be resolved.
     * Nothing on it is derived from anything the client sent.
     */
    authUser?: { id: string; email: string; emailVerified: boolean; name?: string };
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

  fastify.decorate("auth", auth);
  fastify.decorate("tenantDb", db);

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
      // Sign-in, sign-up and password reset are how a session comes into
      // existence; requiring one here would be a closed loop. Marked with the
      // same mechanism as every other public route rather than special-cased
      // by URL prefix in the hook, so there is exactly one way a route becomes
      // reachable without a session — and so a path that merely looks like
      // this one cannot inherit the exemption.
      config: { ...PUBLIC_ROUTE },
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

  // ─── 2. The gate: authenticate, resolve a tenant, or refuse ────────────
  //
  // `onRequest`, deliberately — see this file's header. It is the earliest
  // point at which the matched route is known, which makes it the earliest
  // point the exemption can be read, which makes it the point with the fewest
  // hooks able to run ahead of it.
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // The ONLY exemption, and it comes from the matched route's own config —
    // never from the request's path. Better Auth's handler above carries it,
    // as do the public portal, the invitation-acceptance routes, the
    // unsubscribe link and the Postmark webhook.
    if (isPublicRoute(request)) return;

    const session = await auth.api.getSession({ headers: toWebHeaders(request) });

    if (!session?.user?.id) {
      // Task G1's inversion. Before this, an unmarked route was served to
      // anyone; the ten unauthenticated routes in `routes/notifications.ts`
      // existed because nothing here said otherwise.
      return reply.unauthorized(
        "This endpoint requires a signed-in session. If you are building against " +
          "this API, sign in at /api/auth/sign-in/email and send the session cookie. " +
          "If you are adding a route that is genuinely meant to be reachable " +
          "without one, mark it with `config: { ...PUBLIC_ROUTE }` — see " +
          "src/auth/route-access.ts.",
      );
    }

    request.authUser = {
      id: session.user.id,
      email: session.user.email ?? "",
      emailVerified: session.user.emailVerified === true,
      name: session.user.name ?? undefined,
    };

    let tenant: ResolvedTenant;
    try {
      tenant = await resolveTenant(db, session);
    } catch (err) {
      if (err instanceof TenantResolutionError) {
        // Task C2's third category. Two routes — `GET /api/me` and
        // `POST /api/onboarding` — exist FOR the identity that belongs to no
        // town yet, so for them "no town" is the expected state and not a
        // refusal. They still required a session, which was checked above, and
        // they still get no database handle, because `request.withTenant` is
        // only set below. See `route-access.ts` for why this is a marker
        // rather than a second auth check inside those handlers.
        if (toleratesMissingTenant(request)) {
          request.log.info(
            { authUserId: session.user.id },
            "session resolves to no town; serving a route marked SESSION_WITHOUT_TENANT",
          );
          return;
        }
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
