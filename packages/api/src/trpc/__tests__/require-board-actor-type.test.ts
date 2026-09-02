/**
 * `requireBoardActor`'s type-level guards — its two conditional-tuple
 * checks, mirroring `require-actor-type.test.ts`'s pin on `requireActor`
 * but with a second check that function does not need.
 *
 * `requireBoardActor` takes a `BoardScope`-taking rule from
 * `authorization/rules.ts` that does not reduce to one `PermissionCode` —
 * `assertCanUpdateMeeting` (admin OR A1@board OR M1@board) is the first
 * real caller, in `meeting.ts`'s `cancel`. Two mistakes have to be closed
 * at compile time, not just at runtime, because both would otherwise
 * refuse nobody or silently drop the board:
 *
 *   1. A boolean PREDICATE, not an assertion — `requireActor`'s own hole
 *      (TypeScript's void-return-position assignability special case lets
 *      a `boolean`-returning function satisfy a `=> void` parameter type),
 *      reproduced here because `requireBoardActor` has the identical
 *      shape of parameter.
 *   2. An ACTOR-ONLY rule — `assertCanUpdateTown`'s shape, `(actor: Actor)
 *      => void`. This one is NEW to `requireBoardActor`: a one-parameter
 *      function IS structurally assignable to a two-parameter type (a
 *      function that ignores its second argument can be called with one),
 *      so without the arity check `requireBoardActor(assertCanUpdateTown)`
 *      would compile, read a board from the input, refuse if none is
 *      supplied, and then call `assertCanUpdateTown(actor)` — silently
 *      dropping the board it just went to the trouble of extracting.
 *
 * `assertCanInsertVoteRecord` — `async`, three parameters including a
 * `TenantTx` — is rejected by BOTH checks at once, which is why it stays
 * resolver-side rather than becoming a `requireBoardActor` call site; see
 * `trpc.ts`'s own doc comment on `requireBoardActor`.
 *
 * Like `require-actor-type.test.ts`, this file's assertions always pass
 * under vitest (which never evaluates `@ts-expect-error`); what enforces
 * the pin is `tsc` — `npx turbo run typecheck --force` fails with "Unused
 * '@ts-expect-error' directive" if any of these four stopped being a type
 * error.
 */

import { describe, it, expect } from "vitest";
import type { Actor } from "../authorization/actor.js";
import {
  assertCanUpdateTown,
  assertCanInsertVoteRecord,
  assertCanUpdateMeeting,
} from "../authorization/rules.js";
import type { BoardScope } from "../authorization/rules.js";
import { requireBoardActor } from "../trpc.js";

/** A plausible mistake: the right arity, the wrong return type. */
function isAdminOnBoard(actor: Actor, _scope: BoardScope): boolean {
  return actor.role === "admin";
}

/**
 * Synthetic — no rule in `rules.ts` is both async and actor-only today.
 * Included anyway (redundant with the two checks below individually) to
 * document that the two failure modes can overlap on one function, and
 * that `requireBoardActor` still refuses it either way.
 */
async function asyncActorOnly(_actor: Actor): Promise<void> {
  return Promise.resolve();
}

describe("requireBoardActor's type-level guards", () => {
  it("accepts a real BoardScope rule with more than one code — the compile-time control", () => {
    // No @ts-expect-error: `assertCanUpdateMeeting` genuinely takes
    // (actor, scope) and returns void, so this must compile. If it stopped
    // compiling, `meeting.ts`'s own `cancel` procedure would already be
    // broken, which `npx turbo run typecheck --force` would catch on its
    // own — this line exists so the four negative cases below have a
    // positive case to contrast against in the same file.
    requireBoardActor(assertCanUpdateMeeting);
    expect(true).toBe(true);
  });

  it("refuses a boolean predicate at compile time (right arity, wrong return type)", () => {
    // @ts-expect-error — isAdminOnBoard returns boolean, not void;
    // requireBoardActor must reject it (TS2554: Expected 2-3 arguments,
    // but got 1), or this directive itself becomes an error ("Unused
    // '@ts-expect-error' directive") and the typecheck gate fails for
    // that reason instead.
    requireBoardActor(isAdminOnBoard);
    expect(true).toBe(true);
  });

  it("refuses an actor-only rule at compile time (assertCanUpdateTown)", () => {
    // @ts-expect-error — assertCanUpdateTown takes only (actor), ignoring
    // any board argument; requireBoardActor must reject it rather than
    // silently dropping the board it extracts from the input.
    requireBoardActor(assertCanUpdateTown);
    expect(true).toBe(true);
  });

  it("refuses an async rule at compile time (assertCanInsertVoteRecord)", () => {
    // @ts-expect-error — assertCanInsertVoteRecord is async (returns
    // Promise<void>, which does not extend void) AND takes three
    // parameters including a TenantTx no middleware has; either property
    // alone would fail one of the two checks.
    requireBoardActor(assertCanInsertVoteRecord);
    expect(true).toBe(true);
  });

  it("refuses a rule that is both async and actor-only (documents the overlap, not a real caller)", () => {
    // @ts-expect-error — asyncActorOnly fails BOTH checks at once (wrong
    // return type, wrong arity); included to show requireBoardActor
    // refuses the combination, not just each failure mode in isolation.
    requireBoardActor(asyncActorOnly);
    expect(true).toBe(true);
  });
});
