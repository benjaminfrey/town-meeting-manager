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
 * NARROWED in wave 3's whole-branch fix round. The actor half of the guard
 * used to test `inTransaction` alone, which refused a call whose memo was
 * ALREADY RESOLVED — a false positive, and a load-bearing one, because
 * `phase-e-conventions.md` item 2 sends waves 4–6 to apply row-level rules
 * resolver-side (`assertCanUpdateAgendaItem(await ctx.actor(), {boardId:
 * row.board_id})` inside the transaction that read the row), and every
 * guarded procedure arrives at its resolver with a warm memo because the
 * guard middlewares all await `ctx.actor()` first. The three actor states
 * are now pinned separately below — cold throws, settled succeeds,
 * defined-but-pending throws — because narrowing to `actorPromise !==
 * undefined` instead of "settled" would have reopened the original deadlock
 * for a memo whose own load transaction is still holding the connection.
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

  // ─── The three actor states, pinned separately ───────────────────────────
  //
  // The guard is `inTransaction && !actorSettled`, not `inTransaction` alone.
  // Narrowed in wave 3's whole-branch fix round after a reviewer reproduced
  // state 2 below as a false positive; these three tests are what keep the
  // narrowing honest in both directions — states 1 and 3 must STILL throw.

  // STATE 1 — cold memo inside a transaction. The original hazard, preserved.
  it("refuses a ctx.actor() call made from INSIDE a ctx.withTenant() callback when the memo is COLD, instead of hanging", async () => {
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
        ).rejects.toThrow(/ctx\.actor\(\) called from INSIDE a ctx\.withTenant\(\) transaction/);
      } finally {
        await app.end();
      }
    });
  });

  // STATE 2 — warm/settled memo inside a transaction. The false positive the
  // first version of this guard produced, now closed. This is the shape
  // `phase-e-conventions.md` item 2 sends waves 4-6 to write: read the row
  // inside `withTenant`, then apply a row-level rule to `await ctx.actor()`.
  // Every guarded procedure arrives here with a warm memo, because
  // requireActor/requirePermission/requireBoardPermission/requireBoardActor
  // all await ctx.actor() in middleware before the resolver runs.
  it("ALLOWS a ctx.actor() call from inside a ctx.withTenant() callback once the memo is already SETTLED", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });
        const { withTenant, actor } = bound(contextFor(db, town, seeded));

        // Warm the memo the way a guard middleware does, BEFORE the
        // transaction opens.
        const warmed = await actor();
        expect(warmed.role).toBe("admin");

        const insideRole = await withTenant(async () => {
          // No second transaction opens here: the memo is settled, so this
          // hands back the same resolved promise.
          const again = await actor();
          return again.role;
        });
        expect(insideRole).toBe("admin");
      } finally {
        await app.end();
      }
    });
  });

  // STATE 3 — memo DEFINED but still PENDING. The subtle hazard the obvious
  // narrowing (`actorPromise !== undefined`) would have opened: that promise's
  // own withTenant transaction is holding the connection, so this is the
  // original deadlock wearing a warm memo's clothes.
  //
  // Reachability, stated rather than assumed: `inTransaction` is ONE flag, so
  // a pending actor load and a separate open `ctx.withTenant` transaction
  // cannot coexist — the `withTenant` half of the guard refuses the second one
  // first. The only reachable form of "in a transaction with a pending memo"
  // is therefore a re-entry into the actor's OWN load window, which is what
  // this test constructs by not awaiting the first call.
  it("still refuses a ctx.actor() call made while the memo is DEFINED but not yet SETTLED", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });
        const { actor } = bound(contextFor(db, town, seeded));

        // Deliberately NOT awaited: `actorPromise` is now defined, and its own
        // internal withTenant transaction is open, so `inTransaction` is true
        // and `actorSettled` is still false.
        const pending = actor();

        expect(() => actor()).toThrow(
          /ctx\.actor\(\) called from INSIDE a ctx\.withTenant\(\) transaction/,
        );

        // And the in-flight load itself still completes normally — the
        // refusal above is not collateral damage on the first caller.
        expect((await pending).role).toBe("admin");
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
