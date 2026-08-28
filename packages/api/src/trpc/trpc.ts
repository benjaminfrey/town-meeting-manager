/**
 * Stage 1, Task D1 — the tRPC primitives.
 *
 * Produces `publicProcedure`, `protectedProcedure` and `requirePermission`.
 * Task 2 and all of Phase E build on these, so what is wrong here is wrong 70
 * times over.
 *
 * ─── Two procedures, and why `publicProcedure` is not the default ─────────
 *
 * `protectedProcedure` requires a session AND a resolved tenant, and hands the
 * resolver `ctx.withTenant` and `ctx.actor` as non-optional values.
 * `publicProcedure` requires neither and gets neither — a public procedure has
 * no database handle at all unless it establishes a tenant context of its own,
 * deliberately, the way the portal does.
 *
 * That mirrors the route-level marking in `auth/route-access.ts`: an unmarked
 * HTTP route is refused, and a procedure written on `publicProcedure` is a
 * visible, greppable decision rather than an omission. The mount point
 * `/api/trpc` is itself an authenticated route, so the Fastify gate runs
 * first; `publicProcedure` exists for procedures under a mount that is marked
 * public, not as a way to slip past the gate.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context.js";
import type { TenantTx } from "../db/with-tenant.js";
import type { ResolvedTenant } from "../auth/tenant-context.js";
import type { Actor } from "./authorization/actor.js";
import { AuthorizationError, type PermissionCode } from "./authorization/permission.js";
import { assertPermission } from "./authorization/permission.js";

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;

/**
 * Turn an `AuthorizationError` thrown anywhere below into a tRPC FORBIDDEN.
 *
 * Applied to every procedure, not only to `requirePermission`, because the
 * rules in `authorization/rules.ts` are also called from inside resolvers —
 * a row-level rule like "these minutes are still a draft" cannot be decided
 * before the row has been read. Without this, such a refusal would surface as
 * a 500 and read as an outage.
 *
 * The message is preserved deliberately. It names the action code and says who
 * can grant it; replacing it with "Forbidden" would leave a town clerk with
 * nothing to act on and support with nothing to diagnose.
 */
/**
 * Find an `AuthorizationError` at the head of an error's `cause` chain.
 *
 * tRPC does not let a downstream throw propagate to an upstream middleware's
 * `catch`: it converts it with `getTRPCErrorFromUnknown` and returns
 * `{ ok: false, error }`, keeping the original on `cause`. So a refusal
 * arrives here wrapped, and looking only at the top-level error would see an
 * `INTERNAL_SERVER_ERROR` and pass it through — which is exactly what happened
 * the first time this middleware was written, and is why the assertion in
 * `__tests__/require-permission.test.ts` checks the CODE and not just that
 * something was thrown.
 *
 * The walk is depth-limited because `cause` chains can be cyclic.
 */
function findAuthorizationError(err: unknown): AuthorizationError | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current instanceof AuthorizationError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const translateAuthorizationErrors = t.middleware(async ({ next }) => {
  let result: Awaited<ReturnType<typeof next>>;
  try {
    result = await next();
  } catch (err) {
    const refusal = findAuthorizationError(err);
    if (refusal)
      throw new TRPCError({ code: "FORBIDDEN", message: refusal.message, cause: refusal });
    throw err;
  }
  if (!result.ok) {
    const refusal = findAuthorizationError(result.error);
    if (refusal)
      throw new TRPCError({ code: "FORBIDDEN", message: refusal.message, cause: refusal });
  }
  return result;
});

export const publicProcedure = t.procedure.use(translateAuthorizationErrors);

/**
 * The context a `protectedProcedure` resolver sees: the three optional fields
 * from `TrpcContext`, made required.
 */
export interface AuthenticatedContext extends TrpcContext {
  readonly tenant: ResolvedTenant;
  readonly withTenant: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  readonly actor: () => Promise<Actor>;
}

const requireTenant = t.middleware(async ({ ctx, next }) => {
  if (!ctx.authUser) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "This procedure requires a signed-in session. Sign in at " +
        "/api/auth/sign-in/email and send the session cookie.",
    });
  }
  if (!ctx.tenant || !ctx.withTenant || !ctx.actor) {
    // The Fastify gate already answers 403 for this case, so reaching here
    // means the mount was marked SESSION_WITHOUT_TENANT. Refusing rather than
    // continuing is the same decision `auth/tenant-context.ts` makes and for
    // the same reason: with no tenant every query returns zero rows silently.
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Your account is not linked to a town yet, so there is nothing for this " +
        "request to read or write.",
    });
  }
  return next({
    ctx: {
      ...ctx,
      tenant: ctx.tenant,
      withTenant: ctx.withTenant,
      actor: ctx.actor,
    } satisfies AuthenticatedContext,
  });
});

export const protectedProcedure = t.procedure.use(translateAuthorizationErrors).use(requireTenant);

export interface RequirePermissionOptions<TInput> {
  /**
   * Extract the board a board-scoped check applies to.
   *
   * Supply this for every rule that was `has_board_permission(code, board_id)`
   * — today, `meeting` INSERT and UPDATE. Omitting it performs the GLOBAL
   * check, which is what the old `requirePermission` did everywhere, and that
   * is not uniformly fail-closed: an override that grants is ignored (a
   * board-specific clerk is wrongly refused) and an override that REVOKES is
   * ignored too (a barred clerk is wrongly allowed).
   *
   * If the extractor returns `undefined`, the check REFUSES rather than
   * falling back to the global grant. A board-scoped rule that cannot find its
   * board has lost the thing it is scoped by, and quietly widening to the
   * global answer is precisely the bug this option exists to fix.
   */
  board?: (input: TInput) => string | undefined;
  /** Human phrasing for the refusal message: "to schedule a meeting". */
  action?: string;
}

/**
 * Procedure middleware asserting the caller holds `code`.
 *
 * Place it AFTER `.input(...)` when it needs the board — tRPC parses input in
 * chain order, so a middleware added before the parser sees nothing:
 *
 *     protectedProcedure
 *       .input(z.object({ boardId: z.uuid() }))
 *       .use(requirePermission("A1", { board: (i) => i.boardId }))
 *       .mutation(...)
 */
export function requirePermission<TInput = unknown>(
  code: PermissionCode,
  options: RequirePermissionOptions<TInput> = {},
) {
  return middleware(async (opts) => {
    const ctx = opts.ctx;
    if (!ctx.actor) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "A permission check ran on a procedure with no tenant context. Permission " +
          "checks are only meaningful for a signed-in member of a town; build the " +
          "procedure on protectedProcedure.",
      });
    }

    let boardId: string | undefined;
    if (options.board) {
      boardId = options.board(opts.input as TInput);
      if (!boardId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `The ${code} check on this procedure is scoped to a board, but no board id ` +
            "was supplied. Refusing rather than falling back to the global grant, which " +
            "would ignore an override that revokes this permission for that board.",
        });
      }
    }

    const actor = await ctx.actor();
    assertPermission(actor, code, { boardId, action: options.action });
    return opts.next();
  });
}
