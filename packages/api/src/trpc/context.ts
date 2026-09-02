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
 *
 * ─── Why an UNRESOLVED `ctx.actor()` call cannot run inside `ctx.withTenant` ─
 *
 * Phase E, wave 3, Task 1's fix round — found by mutation-testing
 * `meeting.cancel`'s resolver-side re-check, reproduced deliberately rather
 * than guessed at. `actor()` above, when the memo is still empty, calls
 * `withTenant((tx) => loadActor(tx, tenant))` — its OWN, SECOND transaction.
 * A resolver that calls `ctx.actor()` for the first time from INSIDE its own
 * `ctx.withTenant(...)` callback is therefore opening a transaction while
 * another one on the exact same bound connection is still open. Under a
 * pool with more than one connection this merely costs a second connection
 * and a second round trip; under the test harness's DELIBERATE
 * single-connection pool (`connectAsAppRole`'s own doc comment: "one
 * connection, so 'the same pooled connection' is a fact") it is a hard
 * self-deadlock — the outer transaction is waiting on code that is waiting
 * for a connection the outer transaction itself is holding.
 *
 * `bindTenantAccess` below closes this structurally rather than leaving it to
 * a comment a future author has to have read: a per-request boolean, set for
 * the duration of every `withTenant` call (including the ONE `actor()` makes
 * internally) and checked at the top of BOTH `withTenant` and `actor()`. A
 * reentrant call fails FAST, with a message naming the mistake, instead of
 * hanging until whatever timeout eventually gives up — 30 seconds under
 * vitest, and under a production pool sized just large enough to usually hide
 * it, a slow, mysterious connection-starvation incident instead of a loud
 * error at the exact line that caused it.
 *
 * `contextFor` in `packages/api/src/trpc/__tests__/fixtures.ts` calls this
 * same function — its own doc comment already promises it is "assembled the
 * same way `createTrpcContext` assembles it," and that promise is what makes
 * the guard testable at all: a test using a DIFFERENT, hand-rolled
 * actor/withTenant pairing could not exercise the real code path.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { TenantTx } from "../db/with-tenant.js";
import type { ResolvedTenant } from "../auth/tenant-context.js";
import { loadActor, type Actor, type ActorTenant } from "./authorization/actor.js";

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

/** What `bindTenantAccess` hands back — the pair every `TrpcContext` carries together. */
export interface BoundTenantAccess {
  readonly withTenant: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  readonly actor: () => Promise<Actor>;
}

/**
 * Wire a raw, already-town-bound `withTenant` (Task B3's function — see
 * `db/with-tenant.ts`) into the memoised `actor()` plus the reentrancy guard
 * this file's header describes. The ONE place both halves are built, so
 * `createTrpcContext` (production) and `fixtures.ts`'s `contextFor` (every
 * router test in this phase) cannot drift apart on how the guard works —
 * see this file's header for why that specific promise is what makes the
 * guard testable.
 */
export function bindTenantAccess(
  rawWithTenant: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>,
  tenant: ActorTenant,
): BoundTenantAccess {
  // Per-request (one call to `bindTenantAccess` = one request or one test's
  // context), not per-connection and not module-level — see this file's
  // header for why a shared-by-`db`-identity flag would false-positive
  // across unrelated concurrent requests sharing the same pool.
  let inTransaction = false;

  const withTenant = async <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => {
    if (inTransaction) {
      throw new Error(
        "ctx.withTenant() called while a transaction from an EARLIER, still-open " +
          "ctx.withTenant() call on this same request has not finished. This is a nested " +
          "transaction on the same connection, which can deadlock a pooled client (see " +
          "context.ts's header). Resolve the earlier call — or ctx.actor(), which opens one " +
          "internally — before opening a second one, rather than from inside its callback.",
      );
    }
    inTransaction = true;
    try {
      return await rawWithTenant(fn);
    } finally {
      inTransaction = false;
    }
  };

  let actorPromise: Promise<Actor> | undefined;
  const actor = (): Promise<Actor> => {
    if (inTransaction) {
      throw new Error(
        "ctx.actor() called for the first time from INSIDE a ctx.withTenant() transaction on " +
          "this same request. An unresolved ctx.actor() call runs its OWN withTenant() " +
          "internally to load the account — see context.ts's header — so calling it here opens " +
          "a second transaction while the first is still open, which can deadlock a pooled " +
          "client. Resolve ctx.actor() BEFORE calling ctx.withTenant(), and use the resolved " +
          "value inside the callback instead.",
      );
    }
    actorPromise ??= withTenant((tx) => loadActor(tx, tenant));
    return actorPromise;
  };

  return { withTenant, actor };
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
  const rawWithTenant = req.withTenant;

  const bound = tenant && rawWithTenant ? bindTenantAccess(rawWithTenant, tenant) : undefined;

  return {
    req,
    res,
    authUser: req.authUser,
    tenant,
    withTenant: bound?.withTenant,
    actor: bound?.actor,
  };
}
