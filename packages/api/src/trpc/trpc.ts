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
import { DEFAULT_PERMISSION_TEMPLATES, PERMISSIONS } from "@town-meeting/shared";
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

/**
 * Codes whose rules are board-scoped, so a GLOBAL check on one of them is a
 * bug rather than a choice.
 *
 * Writing `requirePermission("A1")` with no board silently performs the global
 * check, which ignores an override that grants (a board-specific clerk is
 * wrongly refused) AND one that revokes (a barred clerk is wrongly ALLOWED).
 * Across the seventy files Phase E migrates, "remember to pass the board" is
 * not a control. So it is refused at MODULE LOAD, not per request: building
 * such a procedure throws while the router is being imported, which is boot
 * and test collection. A mistake that cannot be committed is better than one
 * that is documented.
 *
 * ─── Why this is derived and not a hand-written list ──────────────────────
 *
 * It used to be `["A1", "M1"]` — the two codes whose REMOVED SQL POLICIES said
 * `has_board_permission(...)` in so many words. That was too narrow, and the
 * evidence is in the product rather than in the policies: the two shipped
 * `designated_boards` templates put EVERY code they grant in
 * `board_overrides`, with global all-false. A global check on any of those
 * codes answers "no" to every account either template ever created — which is
 * one of the two reasons those templates have never worked.
 *
 * So the set is exactly "codes a board-specific account can hold", derived
 * from the templates themselves. Adding a `designated_boards` template that
 * grants a new code widens this automatically, instead of leaving a list to
 * be updated by whoever remembers.
 *
 * Today that resolves to A1 A2 A3 A5 A6 M1–M7 R1–R6 (18 codes). Excluded:
 * T1–T4 (never delegable), A4/A7/M8 (held by the board_member ROLE, not by
 * configuration), C1–C5 (the civic-engagement codes; no `designated_boards`
 * template grants one, and the tables they guard have no board column).
 *
 * Known limitation: `permission_template` rows a town writes itself are not
 * visible here — this reads the five shipped defaults. A custom
 * `designated_boards` template granting, say, C2 would not widen the set. That
 * is a data-driven check this module cannot make synchronously at import time,
 * and it is recorded rather than silently assumed away.
 */
export const BOARD_SCOPED_CODES: readonly PermissionCode[] = (() => {
  const scopeable = new Set(
    DEFAULT_PERMISSION_TEMPLATES.filter((t) => t.scope === "designated_boards").flatMap(
      (t) => t.permissions as readonly string[],
    ),
  );
  return (Object.keys(PERMISSIONS) as PermissionCode[]).filter((code) =>
    scopeable.has(PERMISSIONS[code]),
  );
})();

/**
 * Read a board id out of a procedure's input by property name.
 *
 * Exists so no call site has to write `(i) => (i as {boardId: string}).boardId`
 * — an unchecked cast repeated seventy times, where one input schema renaming
 * its field turns into `undefined` and, without the refusal below, into a
 * global check. This narrows at runtime and returns `undefined` on anything
 * that is not a string, which the middleware then refuses.
 */
export function boardIdFrom(key = "boardId"): (input: unknown) => string | undefined {
  return (input: unknown) => {
    if (!input || typeof input !== "object") return undefined;
    const value = (input as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
}

export interface RequirePermissionOptions {
  /**
   * Extract the board a board-scoped check applies to.
   *
   * Use `boardIdFrom()` unless the board is somewhere unusual. If the
   * extractor returns `undefined` the check REFUSES rather than falling back
   * to the global grant: a board-scoped rule that cannot find its board has
   * lost the thing it is scoped by, and quietly widening to the global answer
   * is the bug this whole option exists to fix.
   */
  board?: (input: unknown) => string | undefined;
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
 *       .use(requireBoardPermission("A1", boardIdFrom()))
 *       .mutation(...)
 *
 * For a board-scoped code, prefer `requireBoardPermission` — this function
 * throws for one anyway, but the named variant says what it is doing.
 */
export function requirePermission(code: PermissionCode, options: RequirePermissionOptions = {}) {
  if (!options.board && BOARD_SCOPED_CODES.includes(code)) {
    // Thrown while the router module is being imported, so this never reaches
    // a request. See BOARD_SCOPED_CODES.
    throw new Error(
      `requirePermission("${code}") has no board. ${code} is board-scoped — a shipped ` +
        "designated_boards permission template grants it per board and nothing globally — " +
        "so a global check ignores both an override that GRANTS it (the board-specific " +
        "clerk is wrongly refused) and one that REVOKES it (a barred clerk is wrongly " +
        `allowed). Use requireBoardPermission("${code}", boardIdFrom()).`,
    );
  }

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
      boardId = options.board(opts.input);
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

/**
 * The board-scoped form. `board` is required, so it cannot be forgotten.
 *
 *     .use(requireBoardPermission("A1", boardIdFrom()))
 */
export function requireBoardPermission(
  code: PermissionCode,
  board: (input: unknown) => string | undefined,
  options: { action?: string } = {},
) {
  return requirePermission(code, { ...options, board });
}
