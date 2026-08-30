/**
 * `requireActor`'s type-level guard against a boolean predicate.
 *
 * Reviewer finding on Task 2's fix round: `requireActor` used to accept
 * `assert: (actor: Actor) => void`, and TypeScript's void-return-position
 * assignability rule (the same one that lets `array.forEach(i =>
 * arr.push(i))` type-check despite `.push` returning a number) made
 * `isAdmin` — a `(actor: Actor) => boolean` PREDICATE, not an assertion —
 * assignable to that parameter. `requireActor(isAdmin)` compiled clean,
 * `typecheck --force` reported 0 errors, and at runtime it called
 * `isAdmin(actor)`, threw the boolean answer away, and let every caller
 * through: a guard that refuses nobody, with no compile error, no runtime
 * error, and no failing test to catch it.
 *
 * `requireActor` now takes a second, conditional tuple parameter that is
 * the empty tuple `[]` when the assert function's return type is genuinely
 * `void`, and a REQUIRED one-element tuple otherwise — see that function's
 * own doc comment in `trpc.ts` for why this closes the hole without
 * reopening it through the same special case.
 *
 * This file is the pin. Like `packages/web/src/lib/__tests__/trpc.test.ts`'s
 * `@ts-expect-error` pin on `AppRouter`, the ASSERTION here runs under
 * vitest and always passes — vitest transpiles and never evaluates
 * `@ts-expect-error`. What actually enforces the pin is `tsc`: if the line
 * below stopped being a type error (the hole reopened), `npx turbo run
 * typecheck --force` would fail with "Unused '@ts-expect-error' directive",
 * not vitest.
 */

import { describe, it, expect } from "vitest";
import { isAdmin, isBoardMember } from "../authorization/permission.js";
import { assertCanUpdateTown } from "../authorization/rules.js";
import { requireActor } from "../trpc.js";

describe("requireActor's type-level guard", () => {
  it("accepts a real assertCanX function — the compile-time control for the pin below", () => {
    // No @ts-expect-error here: an assertCanX genuinely returns void (throws
    // or returns nothing), so this must compile. If it stopped compiling,
    // the guard would be too strict and every real call site — town.ts's
    // four `requireActor(assertCanUpdateTown)` uses among them — would be
    // broken, which `npx turbo run typecheck --force` would already catch
    // on its own; this line exists so the negative case below has a
    // positive case to contrast against in the same file.
    requireActor(assertCanUpdateTown);
    expect(true).toBe(true);
  });

  it("refuses a boolean predicate at compile time (isAdmin)", () => {
    // @ts-expect-error — isAdmin returns boolean, not void; requireActor
    // must reject it (TS2554: Expected 2 arguments, but got 1), or this
    // directive itself becomes an error ("Unused '@ts-expect-error'
    // directive") and the typecheck gate fails for that reason instead.
    requireActor(isAdmin);
    expect(true).toBe(true);
  });

  it("refuses a boolean predicate at compile time (isBoardMember)", () => {
    // Same shape, the other predicate this hole was measured against.
    // @ts-expect-error — isBoardMember returns boolean, not void.
    requireActor(isBoardMember);
    expect(true).toBe(true);
  });
});
