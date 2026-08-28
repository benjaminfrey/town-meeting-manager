/**
 * Stage 1, Task D1 — the tRPC request context, built on the Phase C tenant
 * bridge.
 *
 * ─── The one invariant ────────────────────────────────────────────────────
 *
 * A procedure's only route to the database is `ctx.withTenant`, which opens a
 * transaction with `app.town_id` already set. There is no raw handle on the
 * context and no way to obtain one, so "every procedure runs inside a tenant
 * context" is a property of the type rather than a convention. Phase C could
 * only say that about the bridge; it becomes true of the whole process once
 * `plugins/supabase.ts` — the service-role client that bypasses RLS — is gone.
 *
 * ─── Why the actor is lazy ────────────────────────────────────────────────
 *
 * Resolving a session already costs two round trips (`auth/tenant-context.ts`).
 * Loading the permissions matrix is a third, and most procedures do not need
 * it — a query whose only rule is tenancy is answered by RLS. So the context
 * carries a memoised `actor()` that reads `user_account` the first time
 * something asks, and hands back the same promise afterwards. A request that
 * checks four permissions pays for one read, and a request that checks none
 * pays for nothing.
 *
 * The memo is per-request. It deliberately does NOT cache across requests: a
 * permission revoked by an administrator must take effect on the clerk's next
 * action, not at the end of a cache TTL.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { TenantTx } from "../db/with-tenant.js";
import type { ResolvedTenant } from "../auth/tenant-context.js";
import { loadActor, type Actor } from "./authorization/actor.js";

export interface AuthenticatedIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export interface TrpcContext {
  readonly req: FastifyRequest;
  readonly res: FastifyReply;
  /** The Better Auth identity, when the request carried a session. */
  readonly authUser?: AuthenticatedIdentity;
  /** Present only when the session resolved to a town. */
  readonly tenant?: ResolvedTenant;
  /** The ONLY database handle a procedure gets. Absent means no tenant. */
  readonly withTenant?: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  /**
   * The caller's role and permissions, read once per request.
   *
   * Absent when there is no tenant — there is no account to read, and an
   * actor that could be built without one would be an actor built from
   * something other than the database.
   */
  readonly actor?: () => Promise<Actor>;
}

/**
 * Build the context from a Fastify request the tenant gate has already
 * processed.
 *
 * By the time this runs, `auth/fastify.ts`'s `onRequest` hook has either
 * refused the request or set `tenant` and `withTenant` on it. This function
 * therefore never authenticates anything; it copies forward what the one
 * authentication point decided. Adding a second check here is the shape Task
 * G1 spent its budget removing.
 */
export function createTrpcContext({ req, res }: CreateFastifyContextOptions): TrpcContext {
  const tenant = req.tenant;
  const withTenant = req.withTenant;

  let actorPromise: Promise<Actor> | undefined;
  const actor =
    tenant && withTenant
      ? () => {
          actorPromise ??= withTenant((tx) => loadActor(tx, tenant));
          return actorPromise;
        }
      : undefined;

  return {
    req,
    res,
    authUser: req.authUser,
    tenant,
    withTenant,
    actor,
  };
}
