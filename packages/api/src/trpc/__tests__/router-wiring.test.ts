import { describe, it, expect } from "vitest";
import { appRouter } from "../router.js";

describe("router wiring", () => {
  it("exposes exactly the procedures the web package calls, by name", () => {
    // Adding a procedure is fine; RENAMING or REMOVING one that a screen calls
    // is what this catches, at the moment it happens rather than at runtime in
    // a browser with an empty page and no error.
    const procedures = Object.keys(appRouter._def.procedures).sort();
    expect(procedures).toEqual(
      expect.arrayContaining([
        "board.detail",
        "board.recentMeetings",
        "board.stats",
        "town.portalAddress",
        "whoami",
      ]),
    );
  });

  it("every pinned procedure validates its input", () => {
    // NOT via createCaller with an empty context: protectedProcedure's
    // requireTenant middleware runs BEFORE input parsing, so such a call
    // rejects with UNAUTHORIZED and the assertion passes for the wrong
    // reason — it would still pass with the input schema deleted. Parse the
    // schema directly instead. Real input handling end-to-end is covered by
    // board.test.ts, which has a real context.
    // `_def.procedures`'s TS type is a mapped object keyed by each
    // procedure's literal name, with no index signature — accurate for a
    // fixed, known set of names, but `name` here is a plain string as it
    // walks the list below, which TS rejects (TS7053) even though the
    // runtime object indexes by string exactly this way. Widen only the
    // lookup type, not what is actually reached through it; `as unknown as`
    // because the real type shares no structure with this one for `as`
    // alone to accept.
    const procedures = appRouter._def.procedures as unknown as Record<
      string,
      { _def: { inputs?: Array<{ parse: (input: unknown) => unknown }> } } | undefined
    >;
    for (const name of ["board.detail", "board.stats", "board.recentMeetings"]) {
      const def = procedures[name]?._def;
      const schema = def?.inputs?.[0];
      expect(schema, `${name} has no input schema`).toBeDefined();
      expect(() => schema?.parse({ boardId: "not-a-uuid" })).toThrow();
    }
  });
});
