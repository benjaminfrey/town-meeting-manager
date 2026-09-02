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
import type { BoardScope } from "./authorization/rules.js";

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
 * Place it BEFORE `.input(...)`. tRPC calls middleware and parses input in
 * chain order — see `docs/superpowers/plans/phase-e-conventions.md` item 2 —
 * so anything declared AFTER `.input(...)` can be preempted by validation: a
 * refused caller who also sent malformed input gets BAD_REQUEST from the
 * parser and this guard never runs at all. That is not a hypothetical; it is
 * how `town.updateProfile` first shipped, and why this function now reads
 * `getRawInput()` instead of the parsed `opts.input` (see below) — the fix
 * that makes the correct position (before `.input()`) actually work for a
 * board-scoped code, not merely correct in principle.
 *
 *     protectedProcedure
 *       .use(requireBoardPermission("A1", boardIdFrom()))
 *       .input(z.object({ boardId: z.uuid() }))
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
      // `getRawInput()`, not `opts.input` — declared before `.input()`, this
      // middleware runs before parsing, so `opts.input` is `undefined` and
      // `options.board` would refuse every call (fail-closed, but dead).
      // `getRawInput()` returns the UNVALIDATED body; `boardIdFrom` already
      // narrows it at runtime and returns `undefined` on anything that is
      // not a non-empty string at the key, and the refusal below already
      // fires on that — so reading unvalidated input widens nothing. A junk
      // board id fails closed exactly as it did before this change.
      //
      // This does mean the guard authorizes against the PRE-validation board
      // id, while the resolver (after `.input()` runs) acts on the
      // POST-validation one. They are the same value today for every
      // board-scoped procedure in this repo. They would NOT be the same if
      // an input schema ever applied `.transform()` to the board id field —
      // do not do that; a guard must authorize the same value the resolver
      // acts on.
      boardId = options.board(await opts.getRawInput());
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

/**
 * Procedure middleware for an ACTOR-ONLY rule that is not one of the thirty
 * `PermissionCode`-keyed action codes — the admin gates in
 * `authorization/rules.ts`'s "Phase B report §4b" section
 * (`assertCanUpdateTown` and its siblings), which check the caller's ROLE
 * directly rather than resolving a delegable permission matrix.
 *
 * `requirePermission` is deliberately NOT reused for these. It always
 * resolves a `PermissionCode` through `resolvePermission`, and an admin gate
 * is deliberately not part of that system —
 * `packages/api/src/storage/__tests__/documents.test.ts` pins exactly why,
 * for the same rule this middleware carries: "`assertCanUpdateTown` is an
 * ADMIN gate, not a code check: there is no action code that grants editing
 * the town record, so an actor with a maximal matrix must still be
 * refused." `T1` ("manage_town_settings") exists in `PERMISSIONS` and would
 * resolve to the same answer as `assertCanUpdateTown` for every account any
 * current template can create — but only because no template grants it.
 * Routing this gate through `requirePermission("T1", ...)` would make that
 * an accident of configuration rather than a fact TypeScript enforces, which
 * is precisely the "quietly becomes delegable" failure this file's own
 * `BOARD_SCOPED_CODES` comment warns about for a different set of codes.
 * `requireActor` keeps the admin-gate/action-code split load-bearing instead
 * of blurring it to reach one middleware mechanism for both.
 *
 * Declared before `.input()`, for the identical reason `requirePermission`
 * is: anything declared after can be preempted by input validation — see
 * that function's own doc comment. An admin gate needs no board id and
 * therefore no `getRawInput()` read; it only needs the actor.
 *
 *     .use(requireActor(assertCanUpdateTown))
 *
 * ─── Why `assert` cannot be a boolean predicate, and how that is enforced ──
 *
 * A caller could reach for `isAdmin`/`isBoardMember` from `permission.ts`
 * instead of an `assertCanX` — they are exactly the shape someone typing
 * "require an admin" would grab, and this doc comment used to invite that
 * reading. The type MUST refuse them: `assert`'s return value is discarded
 * (only a throw refuses the caller), so `requireActor(isAdmin)` would
 * silently call `isAdmin(actor)`, throw the boolean away, and let EVERY
 * caller through — a guard that refuses nobody, with no runtime error and
 * no failing test, because nothing ever inspects the return value to notice
 * it was never a `void`.
 *
 * A plain `assert: (actor: Actor) => void` parameter does NOT catch this.
 * TypeScript special-cases a `void`-returning function TYPE POSITION to
 * accept a function that returns anything (the same rule that lets
 * `array.forEach(i => arr.push(i))` type-check even though `.push` returns a
 * number) — so `isAdmin`, whose real return type is `boolean`, is
 * ASSIGNABLE to `(actor: Actor) => void` and no error is raised. Measured
 * directly: `protectedProcedure.use(requireActor(isAdmin)).mutation(...)`
 * compiled clean under `tsc --noEmit` before this fix.
 *
 * The second, conditional parameter below closes that hole WITHOUT touching
 * that special case (a plain `(actor: Actor) => R` parameter still lets `R`
 * infer normally — `boolean` for `isAdmin`, `void` for an `assertCanX`)
 * because the return type is never written as a literal `=> void` for
 * TypeScript to special-case:
 *
 *   - `R extends void` — an ordinary type relationship, not a function's
 *     return-position assignability rule — is `true` only for `void` or
 *     `undefined`, and `false` for `boolean`, `string`, or anything else.
 *   - When `R` is `void`, the second parameter's type is the empty tuple
 *     `[]`: nothing extra to pass, so a real `assertCanX` call site is
 *     unaffected.
 *   - When `R` is anything else, the second parameter's type is a
 *     ONE-ELEMENT tuple carrying an explanatory string literal — a REQUIRED
 *     argument nothing supplies, so `requireActor(isAdmin)` fails with
 *     `TS2554: Expected 2 arguments, but got 1`. It is not possible to
 *     satisfy that tuple type by accident; the only way past it is to stop
 *     passing a value-returning function.
 *
 * Verified as a real compile error, not assumed: see the `@ts-expect-error`
 * pin in `packages/api/src/trpc/__tests__/require-actor-type.test.ts`,
 * checked by `npx turbo run typecheck --force` (vitest never evaluates
 * `@ts-expect-error`; only `tsc` does).
 */
export function requireActor<R>(
  assert: (actor: Actor) => R,
  ..._assertMustReturnVoid: R extends void
    ? []
    : [
        error: "requireActor's assert function must throw-or-return-void, like assertCanUpdateTown — not return a value that gets silently discarded. A boolean predicate such as isAdmin/isBoardMember/canX would compile here and then refuse nobody at runtime.",
      ]
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
    assert(await ctx.actor());
    return opts.next();
  });
}

/**
 * `requireActor`'s board-scoped sibling — for a `BoardScope`-taking rule in
 * `authorization/rules.ts` that does NOT reduce to exactly one
 * `PermissionCode`, so `requireBoardPermission` cannot express it.
 * `assertCanUpdateMeeting` (admin OR A1@board OR M1@board) is the first real
 * caller (`meeting.ts`'s `cancel`); the reviewer who specified this function
 * (Phase E wave 3's fix round) enumerated `rules.ts`'s other `BoardScope`
 * rules and found sixteen of nineteen ARE exactly one `assertPermission`
 * call (use `requireBoardPermission` for those — reach for it FIRST; this
 * function is for the remainder). Two more do not fit even this function's
 * shape and stay resolver-side: `assertCanInsertVoteRecord` is `async` and
 * takes a third argument, a `TenantTx`, which no middleware has (see
 * `RequireBoardActorRule`'s own comment below) — forcing it into the
 * resolver is not a loss; that `TenantTx` is exactly what its self-vote
 * branch needs to look up the caller's own seat.
 *
 * A property `requireBoardPermission` has that this function CANNOT
 * preserve: import-time refusal for a board-scoped code used with no board
 * (`requirePermission` throws while the router module loads if handed one
 * of the 18 `BOARD_SCOPED_CODES` with no `board` option — see that
 * function's own doc comment). There is no single `PermissionCode` here to
 * check against `BOARD_SCOPED_CODES`, so that specific safety net does not
 * exist for this shape. The arity check below is the partial substitute:
 * it cannot catch "this rule is board-scoped but was wired to
 * `requireActor` instead" (a different mistake), but it does catch "this
 * rule takes no board at all" at compile time, which is the shape of
 * mistake this function's callers are actually at risk of.
 *
 * ─── The two type-level checks, and why both are load-bearing ────────────
 *
 * Mirrors `requireActor`'s own `R extends void` guard against a boolean
 * predicate (see that function's doc comment for the full mechanism —
 * TypeScript's void-return-position assignability special case, and why a
 * plain `(actor, scope) => void` parameter type does not catch it). A
 * SECOND conditional tuple, new here, closes a hole `requireActor` does not
 * have to worry about: an ACTOR-ONLY rule like `assertCanUpdateTown` is
 * `(actor: Actor) => void` — one parameter — which IS structurally
 * assignable to this function's `(actor: Actor, scope: BoardScope) =>
 * unknown` constraint (a function that ignores its second argument is
 * assignable to a type that supplies one), so without the arity check
 * `requireBoardActor(assertCanUpdateTown)` would compile, extract a board
 * from the input, refuse if none is supplied, and then SILENTLY IGNORE it
 * when calling `assertCanUpdateTown(actor)` — exactly the "looks
 * board-scoped, answers globally" failure `trpc.ts`'s own `BOARD_SCOPED_CODES`
 * comment warns about for a different mechanism. Both checks are spread into
 * one rest-parameter tuple; when both pass it is `[]` (no extra argument
 * needed) and a real call site is unaffected, matching `requireActor`'s own
 * shape.
 *
 * Verified as real compile errors, not assumed: see the four
 * `@ts-expect-error` pins in
 * `packages/api/src/trpc/__tests__/require-board-actor-type.test.ts` —
 * a boolean predicate, an actor-only rule, an async rule, and (redundantly,
 * to document the overlap) a rule that is both async AND actor-only — all
 * checked by `npx turbo run typecheck --force`.
 *
 * ─── The mismatch defence: carrying the authorized board forward ─────────
 *
 * A board-scoped write whose target is identified by something OTHER than
 * the board id itself (a row id, not the board id, as the mutation's key —
 * `meeting.cancel`'s `meetingId` is the first instance) needs a SECOND,
 * resolver-side check: the guard here can only authorize the board the
 * CLIENT CLAIMED (read via `board(getRawInput())`, before `.input()` even
 * parses); it cannot look up the row's real board, because that needs a
 * `TenantTx` no middleware has. So this function carries the board it
 * actually authorized forward on the request context —
 * `ctx.authorizedBoardId` — and the resolver, after reading the row's REAL
 * board from the database, calls `assertMatchesAuthorizedBoard(ctx, ...)`
 * below. That call is deliberately a GREPPABLE, separate function rather
 * than inline prose: "did this procedure re-check the row's true board" is
 * then answerable by `grep -rn "assertMatchesAuthorizedBoard("`, the same
 * move item 11's marker token makes for migration completeness.
 *
 * This hazard is NOT `cancel`'s special case — see
 * `docs/superpowers/plans/phase-e-conventions.md` item 2: it is the DEFAULT
 * for any board-scoped write whose table has no board-level RLS and whose
 * target is named by a row id. `agenda_item`, `motion`, `vote_record`,
 * `meeting_attendance`, `minutes_document`, `minutes_section` and `exhibit`
 * are all in that shape — waves 4–6 must check each table's own RLS policy
 * rather than assuming `meeting`'s tenancy-only finding carries over.
 *
 * The cost, stated rather than left to be discovered: the board id this
 * function needs is not needed by the WRITE itself (the write acts on the
 * row id) — it exists purely so a guard declared before `.input()` has
 * something to authorize on. Every row-targeted board-scoped write inherits
 * a client-supplied field whose only job is feeding this guard, and the
 * client-side plumbing to supply it (a parent component threading a
 * `boardId` prop it may not otherwise need).
 */
type RequireBoardActorRule = (actor: Actor, scope: BoardScope) => unknown;

export function requireBoardActor<A extends RequireBoardActorRule>(
  assert: A,
  board: (input: unknown) => string | undefined = boardIdFrom(),
  ..._checks: [
    ...(ReturnType<A> extends void
      ? []
      : [
          error: "requireBoardActor's assert function must throw-or-return-void, like assertCanUpdateMeeting — not return a value that gets silently discarded. A boolean predicate would compile here and then refuse nobody at runtime.",
        ]),
    ...(Parameters<A>["length"] extends 2
      ? []
      : [
          error: "requireBoardActor's assert function must take exactly (actor, scope). An actor-only rule ignores the board entirely — use requireActor instead. An async rule (Parameters includes a TenantTx) cannot run in middleware — check it resolver-side instead, the way assertCanInsertVoteRecord does.",
        ]),
  ]
) {
  return middleware(async (opts) => {
    const ctx = opts.ctx;
    // All three checked together, not just `ctx.actor` (the other guards'
    // usual single check): this middleware is the first one that has to
    // FORWARD `ctx.withTenant`/`ctx.tenant` into `next({ctx: ...})` below,
    // and TypeScript's narrowing on `!ctx.actor` alone does not carry over
    // to the other two independently-optional fields — a spread built from
    // only-`actor`-narrowed `ctx` would leave `withTenant` typed possibly
    // `undefined` for every downstream resolver, caught by `tsc` (TS2722 at
    // the resolver's own `ctx.withTenant(...)` call) the moment this was
    // tried without the extra checks.
    if (!ctx.actor || !ctx.withTenant || !ctx.tenant) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "A permission check ran on a procedure with no tenant context. Permission " +
          "checks are only meaningful for a signed-in member of a town; build the " +
          "procedure on protectedProcedure.",
      });
    }
    // `getRawInput()`, not `opts.input` — see `requirePermission`'s own
    // doc comment for why: declared before `.input()`, this middleware
    // runs before parsing, so `opts.input` is `undefined` here.
    const boardId = board(await opts.getRawInput());
    if (!boardId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This procedure is scoped to a board, but no board id was supplied. Refusing " +
          "rather than falling back to a global grant, which would ignore an override that " +
          "revokes this rule for that board.",
      });
    }
    const actor = await ctx.actor();
    assert(actor, { boardId });
    // Carries the AUTHORIZED board forward — see this function's own doc
    // comment, "the mismatch defence" — for a resolver-side
    // `assertMatchesAuthorizedBoard` call to compare against the row's
    // real board.
    //
    // Each field re-listed explicitly, `satisfies AuthenticatedContext`,
    // mirroring `requireTenant`'s own `next({ctx: {...}})` above rather
    // than a bare `{...ctx, authorizedBoardId}` spread: a bare spread's
    // inferred type did NOT carry the narrowing from the guard clause
    // above into what `next()` reports downstream — `ctx.withTenant`
    // resolved to possibly-`undefined` for every caller's resolver
    // (`TS2722` at the resolver's own `ctx.withTenant(...)` call), caught
    // by `npx turbo run typecheck --force` the moment this was tried
    // without the explicit reconstruction.
    return opts.next({
      ctx: {
        ...ctx,
        tenant: ctx.tenant,
        withTenant: ctx.withTenant,
        actor: ctx.actor,
        authorizedBoardId: boardId,
      } satisfies AuthenticatedContext & { authorizedBoardId: string },
    });
  });
}

/**
 * The resolver-side half of `requireBoardActor`'s mismatch defence — see
 * that function's own doc comment. Call this after reading a row's REAL
 * board id from the database and before writing to it, whenever the
 * procedure's target is identified by something other than the board id
 * itself.
 *
 * Throws FORBIDDEN (via `AuthorizationError`, translated the identical way
 * every other refusal in this layer is) when `ctx.authorizedBoardId` — the
 * board `requireBoardActor` actually authorized — does not match the row's
 * real board. Throws a plain `Error`, not a refusal, when
 * `ctx.authorizedBoardId` is missing entirely: that means this procedure's
 * guard is not `requireBoardActor`, which is a wiring bug in the
 * procedure, not something about THIS caller to refuse.
 */
export function assertMatchesAuthorizedBoard(
  ctx: { authorizedBoardId?: string },
  actualBoardId: string,
): void {
  if (ctx.authorizedBoardId === undefined) {
    throw new Error(
      "assertMatchesAuthorizedBoard called on a context with no authorizedBoardId set. This " +
        "procedure's guard must be requireBoardActor — it is the only thing that sets it.",
    );
  }
  if (ctx.authorizedBoardId !== actualBoardId) {
    throw new AuthorizationError(
      "This request was authorized against a different board than the one this row actually " +
        "belongs to. Refusing rather than trusting the board named in the request.",
      { boardId: actualBoardId },
    );
  }
}
