/**
 * `assertMatchesAuthorizedBoard` — the resolver-side half of
 * `requireBoardActor`'s mismatch defence (`trpc.ts`'s own doc comment on
 * both). `requireBoardActor`'s middleware behaviour itself (resolving a
 * board before `.input()`, the reorder pin, the revoking/granting override
 * cases) is exercised end to end through a REAL procedure —
 * `meeting.ts`'s `cancel`/`updateStatus`, in `routers/__tests__/meeting.test.ts`
 * — rather than duplicated here against a synthetic router; this file
 * covers what that real-procedure suite cannot reach directly: the pure
 * comparison function's own three outcomes.
 *
 * Why this file exists at all rather than trusting the real-procedure
 * suite alone: `meeting.test.ts`'s deletion-pin mutation (documented in its
 * own header, and in wave 3's task report) found that removing
 * `requireBoardActor` from a procedure entirely does NOT make
 * `assertMatchesAuthorizedBoard` behave as an independent authorization
 * re-check — it fails EVERY call, successful ones included, with a
 * wiring-bug `Error` rather than a refusal. That is a property of this
 * function specifically, worth pinning in isolation so a future change to
 * it (e.g. someone "helpfully" defaulting `ctx.authorizedBoardId` to
 * `undefined` being treated as "no board claimed, allow") cannot regress it
 * without a directly-relevant test going red.
 */

import { describe, it, expect } from "vitest";
import { assertMatchesAuthorizedBoard } from "../trpc.js";

describe("assertMatchesAuthorizedBoard", () => {
  it("passes silently when the authorized board matches the row's real board", () => {
    expect(() =>
      assertMatchesAuthorizedBoard({ authorizedBoardId: "board-1" }, "board-1"),
    ).not.toThrow();
  });

  it("throws an AuthorizationError when the authorized board does NOT match the row's real board", () => {
    let thrown: unknown;
    try {
      assertMatchesAuthorizedBoard({ authorizedBoardId: "board-1" }, "board-2");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error | undefined)?.name).toBe("AuthorizationError");
  });

  /**
   * The wiring-bug case, pinned directly: no `authorizedBoardId` at all on
   * the context means the procedure's guard is not `requireBoardActor` —
   * a bug in how the PROCEDURE is built, not a refusal of THIS caller.
   * Deliberately NOT an `AuthorizationError` — see this file's header for
   * why that distinction is load-bearing (a plain `Error` fails the request
   * with 500-shaped internals rather than a clean FORBIDDEN, which is the
   * correct signal for "this procedure is misconfigured," not "this caller
   * is unauthorized").
   */
  it("throws a plain, non-authorization Error when authorizedBoardId is missing entirely (the wiring-bug case)", () => {
    let thrown: unknown;
    try {
      assertMatchesAuthorizedBoard({}, "board-2");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).not.toBe("AuthorizationError");
    expect((thrown as Error).message).toContain("requireBoardActor");
  });
});
