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
 * This file proves the STRUCTURAL fix (a marker held for the dynamic extent
 * of a call, checked at the top of both `withTenant` and `actor()`) turns
 * that hang into an instant, named, thrown error — and that the guard does
 * not false-positive on the two correct patterns: sequential calls, and
 * CONCURRENT calls on one context.
 *
 * RESCOPED in Phase E wave 5, Task 7's fix round. The marker was a
 * per-REQUEST boolean, and that is one scope too wide: `httpBatchLink` puts N
 * procedure calls on ONE HTTP request, tRPC builds ONE context for it and
 * resolves the calls concurrently, so every call after the first was refused
 * and the live meeting screen rendered blank. Nothing in this repository could
 * see it — every router test drives one procedure at a time. The two tests
 * that close that gap are "allows two CONCURRENT ctx.withTenant calls on ONE
 * context" below and, at the transport level where the defect actually lived,
 * `__tests__/http-batch.test.ts`.
 *
 * NARROWED in wave 3's whole-branch fix round. The actor half of the guard
 * used to test `inTransaction` alone, which refused a call whose memo was
 * ALREADY RESOLVED — a false positive, and a load-bearing one, because
 * `phase-e-conventions.md` item 2 sends waves 4–6 to apply row-level rules
 * resolver-side (`assertCanUpdateAgendaItem(await ctx.actor(), {boardId:
 * row.board_id})` inside the transaction that read the row), and every
 * guarded procedure arrives at its resolver with a warm memo because the
 * guard middlewares all await `ctx.actor()` first. The three actor states
 * are pinned separately below — cold-inside-a-transaction throws, settled
 * succeeds, defined-but-pending-with-a-separate-transaction-open throws —
 * because narrowing to `actorPromise !== undefined` instead of "settled"
 * would have reopened the original deadlock for a memo whose own load
 * transaction is still holding the connection.
 *
 * Runs through `contextFor` (`fixtures.ts`) wherever a real database can
 * express the state — that function's own doc comment already promises it is
 * assembled "the same way `createTrpcContext` assembles it," via the shared
 * `bindTenantAccess`, specifically so a guard exercised here is the guard
 * production actually runs. State 3 is the one exception and calls
 * `bindTenantAccess` directly: the harness's single-connection pool serialises
 * transactions, so a load cannot be held pending WHILE a second transaction is
 * open through a real connection. That test still drives the production
 * function; only the transaction body is controllable. See its own comment.
 */

import { describe, it, expect } from "vitest";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { seedTown, seedActor, contextFor, testDb } from "./fixtures.js";
import { bindTenantAccess, type TrpcContext } from "../context.js";

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
  // The guard is "a transaction of this context is open on the call stack AND
  // the memo is unsettled", not "a transaction is open" alone. Narrowed in
  // wave 3's whole-branch fix round after a reviewer reproduced state 2 below
  // as a false positive; these three tests are what keep the narrowing honest
  // in both directions — states 1 and 3 must STILL throw.

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
        ).rejects.toThrow(/ctx\.actor\(\) called from INSIDE a still-open ctx\.withTenant\(\)/);
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

  // STATE 3 — memo DEFINED but still PENDING, reached from inside a SEPARATE
  // open transaction of the same context. The subtle hazard the obvious
  // narrowing (`actorPromise !== undefined`) would open: awaiting that promise
  // means awaiting a load that is queued behind the very transaction it is
  // being awaited from. The original deadlock, wearing a warm memo's clothes.
  //
  // **This state changed shape in wave 5, Task 7's scope fix, and the change
  // is the point rather than an incidental edit.** While the marker was
  // per-REQUEST, a pending load left the flag set for the whole request, so
  // the only reachable third state was a bare second `actor()` call in the
  // load's window — refused, even though it returns the SAME promise and opens
  // no second transaction (`context.ts` said so at the time, in as many
  // words). Now the marker lasts only for a call's own extent, so that bare
  // re-entry is allowed, correctly, and the state that still threatens a
  // connection is the one below.
  //
  // Built on `bindTenantAccess` directly rather than through `contextFor`, and
  // the reason is the harness: `connectAsAppRole` is a deliberate
  // single-connection pool, so a real second transaction cannot BEGIN until
  // the actor's load has committed — by which time the memo is settled and
  // this state is unreachable through a real database. A controllable
  // `rawWithTenant` is the only way to hold a load pending while a separate
  // transaction is open. It is still the production guard: `bindTenantAccess`
  // is the one function `createTrpcContext` and `contextFor` both call.
  it("still refuses a ctx.actor() call made from inside another open transaction while the memo is DEFINED but not yet SETTLED", async () => {
    let releaseLoad: (() => void) | undefined;
    let announceLoadStarted: () => void = () => {};
    const loadStarted = new Promise<void>((resolve) => {
      announceLoadStarted = resolve;
    });

    // The FIRST raw call is the actor's own load and is held open; every later
    // call runs immediately. Nothing here touches a database — the guard is
    // pure, and what is under test is which calls it refuses.
    let rawCalls = 0;
    const rawWithTenant = async <T>(fn: (tx: never) => Promise<T>): Promise<T> => {
      rawCalls += 1;
      if (rawCalls === 1) {
        announceLoadStarted();
        await new Promise<void>((resolve) => {
          releaseLoad = resolve;
        });
      }
      return fn(undefined as never);
    };

    const { withTenant, actor } = bindTenantAccess(rawWithTenant as never, {
      townId: "11111111-1111-4111-8111-111111111111",
      personId: "22222222-2222-4222-8222-222222222222",
      userAccountId: "33333333-3333-4333-8333-333333333333",
    });

    // Start the load and leave it pending: `actorPromise` is defined,
    // `actorSettled` is false, and this call's own extent has ended (the
    // marker is gone), which is exactly the situation the per-request flag
    // could not represent.
    const pending = actor();
    void pending.catch(() => {});
    await loadStarted;

    // The bare re-entry is now ALLOWED and hands back the same promise —
    // stated as an assertion rather than left as a claim in a comment.
    expect(actor()).toBe(pending);

    // But from inside a SEPARATE, open transaction of this same context it is
    // still refused, because awaiting it there is the deadlock.
    await expect(
      withTenant(async () => {
        return actor();
      }),
    ).rejects.toThrow(/ctx\.actor\(\) called from INSIDE a still-open ctx\.withTenant\(\)/);

    releaseLoad?.();
    await expect(pending).rejects.toThrow();
  });

  // ─── Phase E wave 5, Task 7: CONCURRENT is not NESTED ───────────────────
  //
  // The batched-request shape, at the level of the guard itself. One context,
  // two `ctx.withTenant` calls started before either has finished, neither
  // inside the other's callback — which is exactly what tRPC produces for a
  // two-procedure `httpBatchLink` request, and what a per-request flag
  // refused. `__tests__/http-batch.test.ts` pins the same property over real
  // HTTP; this pins it on the function, where the mutation is one line.
  //
  // `Promise.all` rather than two awaits: sequential calls are already covered
  // above and would pass under the old flag too.
  //
  // Note what the single-connection harness does and does not prove here. The
  // two transactions genuinely serialise on the connection — the second BEGINs
  // once the first commits — so this is not a test that two transactions run
  // at the same instant. It is a test that the second is not REFUSED for
  // having been STARTED while the first was open, which is the whole defect.
  it("allows two CONCURRENT ctx.withTenant calls on ONE context — the tRPC HTTP batch shape", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });
        const { withTenant } = bound(contextFor(db, town, seeded));

        const results = await Promise.all([
          withTenant(async () => "procedure one"),
          withTenant(async () => "procedure two"),
          withTenant(async () => "procedure three"),
        ]);

        expect(results).toEqual(["procedure one", "procedure two", "procedure three"]);
      } finally {
        await app.end();
      }
    });
  });

  // ─── Phase E wave 5, Task 1: the marker is per CONTEXT, not per pool ────
  //
  // A subscription's context lives for the whole stream — minutes or hours,
  // where every other context lives for milliseconds. That makes "is this flag
  // shared with anything else" a question worth an assertion rather than a
  // comment: if it were, a browser holding an SSE stream open would have its
  // own ordinary queries refused for the life of that stream, and the symptom
  // would be intermittent 500s on unrelated screens whenever the live meeting
  // was open in another tab.
  //
  // `bindTenantAccess`'s own comment already says the token is minted per
  // context, not per connection and not module-level. This is that claim,
  // measured, with both contexts on the same pooled connection.
  //
  // The inner call is deliberately NOT awaited from inside the outer
  // transaction, and the first version of this test that did await it hung to
  // vitest's 30-second timeout rather than failing — for a reason that is
  // about the harness and not about the guard. `connectAsAppRole` is a
  // single-connection pool on purpose, so a second transaction genuinely
  // cannot start until the first commits; awaiting it from inside is a real
  // deadlock whatever the flag says. What is being asserted here is narrower
  // and is the whole question: the second context's call is not REFUSED. It
  // queues, and completes once the first releases the connection.
  it("does not share its reentrancy marker between two contexts on the same connection", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const seeded = await seedActor(db, town, { role: "admin" });

        // Two contexts, exactly as two concurrent requests from one browser
        // get — one of which might be an open subscription.
        const streamLike = bound(contextFor(db, town, seeded));
        const requestLike = bound(contextFor(db, town, seeded));

        let queued: Promise<string> | undefined;
        await streamLike.withTenant(async () => {
          queued = requestLike.withTenant(async () => "the other context");
          // A handler so a rejection inside the window below is not reported
          // as unhandled. `queued` itself still rejects, which is what the
          // assertion after this transaction reads.
          void queued.catch(() => {});
          // Long enough that a synchronous refusal would have landed.
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "outer";
        });

        // If the flag were shared, this would reject with the reentrancy
        // message rather than resolve.
        expect(await queued).toBe("the other context");
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
          /ctx\.withTenant\(\) called from INSIDE a still-open ctx\.withTenant\(\)/,
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
