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
     * about it gets — means the route requires a session AND a resolved town.
     * Spell the exceptions with `PUBLIC_ROUTE` / `SESSION_WITHOUT_TENANT`
     * rather than by hand so the intent greps.
     */
    auth?: "public" | "session-without-tenant";
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

/**
 * Spread into a route's `config` to declare it reachable by a signed-in
 * identity that does not (yet) belong to a town.
 *
 *     app.post("/onboarding", { config: { ...SESSION_WITHOUT_TENANT } }, handler)
 *
 * ─── Why a third category exists at all, and why it is not "public" ───────
 *
 * There are exactly two moments in this product's life when a real, verified
 * identity has no town: the instant after sign-up, and the instant after an
 * invitation is accepted but before the link is read back. Two routes have to
 * work then — `GET /api/me`, which is how the client decides between the
 * dashboard and the onboarding wizard, and `POST /api/onboarding`, which is
 * what creates the town. Under the default policy both answer 403 to precisely
 * the user they exist for, so the wizard could never run.
 *
 * The alternative — marking them `PUBLIC_ROUTE` and re-checking the session
 * inside the handler — was rejected. It would put a second, hand-written
 * authentication path next to the one in `fastify.ts`, which is the shape Task
 * G1 spent its entire budget removing. This marker keeps authentication in one
 * place and relaxes only the *tenant* half.
 *
 * ─── What a route marked this way gets, and does not get ─────────────────
 *
 * It gets `request.authUser` — the Better Auth identity, and nothing derived
 * from anything the client sent. It gets `request.tenant` and
 * `request.withTenant` too, but ONLY if resolution succeeded; a handler must
 * treat both as optional, and TypeScript already makes it.
 *
 * It therefore gets **no database access at all** when there is no town, since
 * `request.withTenant` is the only handle the bridge hands out. That is the
 * property that makes this marker safe: relaxing the tenant requirement cannot
 * widen what a query can see, because with no tenant there is no query.
 */
export const SESSION_WITHOUT_TENANT = { auth: "session-without-tenant" } as const;

/**
 * True when the matched route accepts a session that resolves to no town.
 *
 * Read from the MATCHED ROUTE's config for the same reason as
 * `isPublicRoute` — a path that merely looks like one of these two routes
 * cannot borrow the relaxation.
 */
export function toleratesMissingTenant(request: FastifyRequest): boolean {
  return request.routeOptions?.config?.auth === "session-without-tenant";
}
