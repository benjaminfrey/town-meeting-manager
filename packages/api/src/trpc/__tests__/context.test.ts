/**
 * `bindTenantAccess`'s reentrancy guard — `context.ts`'s own header has the
 * full case for why this exists, found by mutation-testing `meeting.cancel`
 * during Phase E wave 3's fix round: resolving `ctx.actor()` for the first
 * time from INSIDE a `ctx.withTenant(...)` callback opens a second, nested
 * transaction on the same connection, which self-deadlocked the test
 * harness's single-connection pool (`connectAsAppRole`) instead of failing —
 * every affected test hung at vitest's 30s per-test timeout, and the
 * reproduction leaked scratch databases because vitest force-kills on
 * timeout and `withTestDb`'s own `finally` never got to run.
 *
 * This file proves the STRUCTURAL fix (a per-request flag, checked at the
 * top of both `withTenant` and `actor()`) turns that hang into an instant,
 * named, thrown error — and that the guard does not false-positive on the
 * overwhelmingly common, correct pattern: sequential (not nested) calls.
 *
 * Runs through `contextFor` (`fixtures.ts`), not a hand-built pairing —
 * that function's own doc comment already promises it is assembled "the
 * same way `createTrpcContext` assembles it," via the shared
 * `bindTenantAccess`, specifically so a guard exercised here is the guard
 * production actually runs.
 */

import { describe, it, expect } from "vitest";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { seedTown, seedActor, contextFor, testDb } from "./fixtures.js";
import type { TrpcContext } from "../context.js";

/**
 * `TrpcContext.withTenant`/`.actor` are typed optional (absent means no
 * tenant), but `contextFor` always populates both — this narrows once per
 * test rather than asserting at every call site, and throws loudly (not
 * silently) if that fixture guarantee is ever broken.
 */
function bound(ctx: TrpcContext) {
  if (!ctx.withTenant || !ctx.actor) {
    throw new Error("contextFor() is expected to always populate withTenant and actor");
  }
  return { withTenant: ctx.withTenant, actor: ctx.actor };
}

describe("bindTenantAccess's reentrancy guard", () => {
  it("allows SEQUENTIAL calls — ctx.actor() after a finished ctx.withTenant() call, and vice versa", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });
        const { withTenant, actor } = bound(contextFor(db, town, seeded));

        // withTenant, finishes, THEN actor() — actor() opens its OWN
        // withTenant internally; this must not be treated as nested,
        // because the first call already completed.
        await withTenant(async () => "first");
        const resolved = await actor();
        expect(resolved.role).toBe("admin");

        // And the reverse order, on a fresh context (actor() is memoised,
        // so reusing the same pair here would not exercise "actor first"
        // cleanly).
        const second = bound(contextFor(db, town, seeded));
        const resolved2 = await second.actor();
        expect(resolved2.role).toBe("admin");
        await second.withTenant(async () => "second");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a ctx.actor() call made from INSIDE a ctx.withTenant() callback, instead of hanging", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });
        const { withTenant, actor } = bound(contextFor(db, town, seeded));

        await expect(
          withTenant(async () => {
            // The exact shape that deadlocked: an UNRESOLVED ctx.actor()
            // call, made from inside another withTenant's own callback.
            return actor();
          }),
        ).rejects.toThrow(/ctx\.actor\(\) called for the first time from INSIDE/);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a nested ctx.withTenant() call made from inside another one's callback", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });
        const { withTenant } = bound(contextFor(db, town, seeded));

        await expect(withTenant(async () => withTenant(async () => "nested"))).rejects.toThrow(
          /ctx\.withTenant\(\) called while a transaction/,
        );
      } finally {
        await app.end();
      }
    });
  });

  it("resets after a refused reentrant attempt — a later, correctly-ordered call still works", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });
        const { withTenant, actor } = bound(contextFor(db, town, seeded));

        await expect(withTenant(async () => withTenant(async () => "nested"))).rejects.toThrow();

        // The flag must not be left "stuck" set after the outer call's
        // `finally` runs — a subsequent, correctly-ordered call proves it.
        const result = await withTenant(async () => "fine now");
        expect(result).toBe("fine now");
        const resolved = await actor();
        expect(resolved.role).toBe("admin");
      } finally {
        await app.end();
      }
    });
  });
});
