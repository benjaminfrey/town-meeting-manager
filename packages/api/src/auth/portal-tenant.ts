/**
 * Stage 1, Task D1b — THE PORTAL'S TENANT BRIDGE.
 *
 * `tenant-context.ts` turns a SESSION into a town. This turns a SUBDOMAIN into
 * one, for the fifteen routes in `routes/portal.ts` that have no session and
 * never will.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRUST BOUNDARY, STATED SO A LATER CHANGE CANNOT ASSUME OTHERWISE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **`X-Town-Subdomain` is not a trusted input, and this file does not treat it
 * as one.**
 *
 * In the production topology it is authoritative. `infrastructure/nginx/
 * nginx.conf` matches the portal host with
 * `~^(?<subdomain>[^.]+)\.townmeetingmanager\.com$` and then
 * `proxy_set_header X-Town-Subdomain $subdomain`, and `proxy_set_header`
 * REPLACES whatever the client sent. A page served from town A's portal host
 * therefore cannot ask this API for town B, no matter what it puts in the
 * header — that much is structural, and it is why the header is used instead
 * of, say, a query parameter.
 *
 * But that property belongs to nginx, not to this process. Nothing in this
 * codebase proves the API is unreachable except through nginx.
 * `infrastructure/docker-compose.production.yml` publishes nginx alone and the
 * API listens on the private network, which is what makes it true today — the
 * same assumption `server.ts`'s `trustProxy: true` already rests on, and it
 * carries the same warning. Anyone with a route to port 3001 can set this
 * header to anything.
 *
 * **So what does a forged header get you?** Exactly one thing: a tenant
 * context for a town of your choosing. That is not a privilege escalation
 * here, because it is not a privilege the portal ever withheld — every portal
 * route already takes its town from a `:townId` in the URL, which is equally
 * client-chosen. The header does not widen the attack surface; it narrows it,
 * because `bindPortalTenant` now REQUIRES the two to agree.
 *
 * **What actually keeps this safe is not the header at all.** It is that
 * everything reachable through this tenant context is filtered by the
 * `portalCanSelect*` predicates in `trpc/authorization/rules.ts` to rows a
 * town has decided to publish. RLS gives the portal one town; the predicates
 * give it that town's published business. Neither alone is sufficient, and
 * RLS alone is strictly worse than the status quo, because a tenant context
 * with no publication filter would serve drafts.
 *
 * **The constraint that follows, and that must not be quietly dropped:**
 *
 *   > A route may use `request.portalTenant` / the `withTenant` it binds ONLY
 *   > if every row it can return is gated by a `portalCanSelect*` predicate.
 *   > Anything else — anything a town has not published, anything personal
 *   > beyond an active board member's seat — needs `request.tenant`, which is
 *   > derived from a session and cannot be chosen by the caller.
 *
 * `__tests__/portal-tenant.test.ts` and `routes/__tests__/portal-tenancy.test.ts`
 * hold the read half of that. The write half needs no test: this path binds
 * nothing that can write, because `portalCanSelect*` are all SELECT rules and
 * the door-opener policy (`0003_portal_tenant.sql` § 1) is `FOR SELECT`.
 *
 * **Could forgery be made structurally impossible?** Yes, and it was
 * considered. The tenant would have to come from something the caller cannot
 * choose — a per-town secret nginx injects and this process verifies, or a
 * separate listener per town. Both cost an operational secret (or a listener)
 * per town, in a product whose selling point is that a town clerk can set up a
 * portal by typing a name into a settings page. What they would buy is
 * protection for data that is, by the constraint above, already published. The
 * trade is not worth making today; it WOULD become worth making the moment
 * anything non-public is served through this path, which is the same line the
 * constraint draws.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW THE LOOKUP HAPPENS WITHOUT AN RLS BYPASS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `public.town` is under FORCE ROW LEVEL SECURITY with `id =
 * get_current_town_id()`, so reading a town BY SUBDOMAIN is the same
 * circularity `better_auth.user_tenant` exists to break for identities.
 *
 * Migration `0003_portal_tenant.sql` adds a second, SELECT-only policy keyed
 * on an `app.portal_subdomain` session setting. `resolvePortalTenant` opens a
 * transaction, sets it with `SET LOCAL` semantics, reads the single matching
 * row, and lets the transaction end — which reverts the setting. The portal's
 * actual work then runs in an ordinary `withTenant()` transaction where
 * `app.portal_subdomain` is unset and that policy matches nothing.
 *
 * The shape check runs BEFORE the query. A header that could never have been
 * saved as a subdomain does not reach the database at all.
 */

import { sql } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import { normaliseSubdomain } from "@town-meeting/shared";
import { withTenant, type TenantTx } from "../db/with-tenant.js";
import { toRows as normaliseRows } from "../db/rows.js";
import type { TenantResolverDb } from "./tenant-context.js";

/** The town a portal request is scoped to. */
export interface PortalTenant {
  readonly townId: string;
  /** The normalised subdomain it was resolved from. */
  readonly subdomain: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The town this PUBLIC PORTAL request is scoped to, resolved from
     * `X-Town-Subdomain`.
     *
     * Set only on routes registered inside `routes/portal.ts`'s encapsulated
     * scope. Deliberately a different property from `request.tenant`, which is
     * session-derived and trustworthy: code that means "the caller's town"
     * must not silently accept "a town the caller named". See this file's
     * header for the constraint that difference encodes.
     */
    portalTenant?: PortalTenant;
  }
}

function toRows<T>(result: unknown): T[] {
  return normaliseRows<T>(result, (message) => new Error(`resolvePortalTenant: ${message}`));
}

interface TownRow {
  id: string;
  subdomain: string;
}

/**
 * Map a portal subdomain to exactly one town, or to `null`.
 *
 * `null` — never a throw — for every "no such town" case: an absent header, a
 * header that is not a legal DNS label, a reserved name, and a well-formed
 * name no town has claimed. They are indistinguishable to a caller by design.
 * Telling the public which of the four applied would turn this into an
 * enumeration oracle over which towns use the product, and none of the four is
 * an error condition an operator needs to see.
 *
 * A driver returning an unrecognisable result IS a throw, for the reason
 * `db/rows.ts` gives: a shape mismatch must never be read as "no rows".
 */
export async function resolvePortalTenant(
  db: TenantResolverDb,
  rawSubdomain: unknown,
): Promise<PortalTenant | null> {
  const subdomain = normaliseSubdomain(rawSubdomain);
  if (subdomain === null) return null;

  const rows = await db.transaction(async (tx) => {
    // SET LOCAL semantics — the third argument is `true`. See
    // `db/with-tenant.ts` for what the alternative does to a pooled
    // connection; the same reasoning applies to this setting, and leaking it
    // would leave a later request on the same backend able to read one extra
    // town row.
    await tx.execute(sql`SELECT set_config('app.portal_subdomain', ${subdomain}, true)`);
    return toRows<TownRow>(
      await tx.execute(sql`SELECT id, subdomain FROM town WHERE subdomain = ${subdomain}`),
    );
  });

  const row = rows[0];
  if (rows.length !== 1 || !row) return null;

  return { townId: String(row.id), subdomain: String(row.subdomain) };
}

/** What a portal route gets in place of `request.withTenant`. */
export type PortalWithTenant = <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;

/**
 * The `onRequest` hook `routes/portal.ts` installs in its own scope.
 *
 * Fails closed: a request whose subdomain does not resolve gets a 404 and
 * never reaches a handler, so a handler cannot be written that "works without
 * a tenant" and quietly returns nothing.
 *
 * 404 rather than 400 or 403 on purpose. To a browser this endpoint IS a town
 * website; "there is no such town" is what a missing one means, and a 403
 * would tell a scanner that the subdomain exists but was refused.
 */
export async function bindPortalTenant(
  db: TenantResolverDb,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const tenant = await resolvePortalTenant(db, request.headers["x-town-subdomain"]);

  if (tenant === null) {
    request.log.info(
      { url: request.url },
      "public portal request with no resolvable X-Town-Subdomain; refusing",
    );
    return reply.notFound(
      "No town is published at this address. The public portal identifies a town by " +
        "its subdomain; nginx forwards it as X-Town-Subdomain (see " +
        "infrastructure/nginx/nginx.conf). If you are calling this API directly, set " +
        "that header to the town's portal address.",
    );
  }

  request.portalTenant = tenant;
  request.withTenant = <T>(fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(db, { townId: tenant.townId }, fn);
  return undefined;
}

/**
 * The town id a `:townId` route may act on, or `null` if the URL disagrees
 * with the host it was requested through.
 *
 * Every portal route carries a `:townId` in its path, and until D1b that was
 * the ONLY thing deciding which town was served — the subdomain in the browser
 * address bar and the id in the URL were never compared, so town A's portal
 * host would happily render town B's meetings if a link said so. Requiring
 * them to agree costs nothing (the client builds both from the same
 * `/resolve` answer) and removes a whole class of confused-deputy link.
 */
export function portalTownIdFrom(
  request: FastifyRequest,
  paramTownId: string | undefined,
): string | null {
  const tenant = request.portalTenant;
  if (!tenant) return null;
  if (paramTownId !== undefined && paramTownId !== tenant.townId) return null;
  return tenant.townId;
}
