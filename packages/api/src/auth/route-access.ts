/**
 * Stage 1, Task G1 — the route-access marker, and why the default is DENY.
 *
 * ─── What this file changes about the shape of a mistake ──────────────────
 *
 * The audit that produced this task found ten unauthenticated routes in
 * `routes/notifications.ts`. It did not find them because the mechanism was
 * missing — `verifyAuth` existed and was used correctly in seventeen other
 * places. It found them because nothing made *omission* fail. A route written
 * without an auth marker was served to anyone, and the only thing standing
 * between a new route and a public one was whether its author remembered.
 *
 * So the marker below is deliberately not "mark the routes that need auth".
 * It is the inverse: an UNMARKED route is refused, and a route becomes public
 * only by someone typing `PUBLIC_ROUTE` into it. The failure mode of
 * forgetting flips from "silently world-readable" to "returns 401 the first
 * time anyone calls it" — a bug report instead of a breach.
 *
 * `__tests__/route-access.test.ts` registers a brand-new, unmarked route and
 * asserts it is refused. That test, not this file, is what keeps the property
 * true: this file could be edited into a no-op, and the test would fail.
 *
 * ─── Why a route `config` value and not a preHandler ──────────────────────
 *
 * A preHandler you must remember to add has exactly the failure this task
 * exists to remove. `config` is read by a hook on the root instance that runs
 * for EVERY matched route, so the enforcement point is one place that cannot
 * be skipped, and the per-route value only ever *relaxes* it.
 *
 * Fastify runs instance-level `preHandler` hooks for routes registered before
 * the hook as well as after, so there is no registration-order trap here — a
 * route file added at the top of `server.ts` is covered identically to one at
 * the bottom.
 *
 * ─── The one thing this marker does NOT mean ──────────────────────────────
 *
 * `auth: "public"` says "serve this without a session". It says nothing about
 * whether the handler is safe to expose. `/api/webhooks/postmark` is marked
 * public and is still verified — by HTTP Basic credentials, which is what
 * Postmark actually offers (it does not sign webhooks; see
 * `postmark-webhook-auth.ts`). Marking a route public is the beginning of a
 * security argument, not the end of one.
 */

import type { FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Explicit opt-out from the authenticated-by-default policy.
     *
     * Omitted — the default, and the value every route added without thinking
     * about it gets — means the route requires a session. Spell it with
     * `PUBLIC_ROUTE` rather than by hand so the intent greps.
     */
    auth?: "public";
  }
}

/**
 * Spread into a route's `config` to declare it reachable without a session.
 *
 *     app.get("/health", { config: { ...PUBLIC_ROUTE } }, handler)
 *
 * Every use of this is load-bearing and every one should carry a comment
 * saying who calls the route and why no session is possible for them.
 */
export const PUBLIC_ROUTE = { auth: "public" } as const;

/**
 * True when the matched route explicitly opted out of requiring a session.
 *
 * Reads the MATCHED ROUTE's config, not the request path — a request that
 * matched no route never reaches a preHandler, and a path that merely looks
 * like a public one (`/api/auth/../admin/notifications`) cannot borrow another
 * route's marking, because the value comes from the route the router actually
 * selected.
 */
export function isPublicRoute(request: FastifyRequest): boolean {
  return request.routeOptions?.config?.auth === "public";
}
