/**
 * Phase E, wave 5, Task 1 — the `LISTEN` bridge, and the tenancy filter that
 * is the ONLY thing standing between one town's events and another town's
 * subscriber.
 *
 * The phase spec is explicit that "a subscriber must not be able to receive an
 * event for a town it cannot read … must be pinned by a test, not asserted."
 * This file is half of that pin, at the bridge; the other half is
 * `trpc/routers/__tests__/realtime.test.ts`, which runs the same scenario
 * end-to-end through the real procedure and a real request context, so neither
 * a helper nor its caller can be the thing that was tested.
 *
 * **How to check that pin is load-bearing rather than decorative** — delete
 * `event.townId === subscriber.townId` from `eventMatchesSubscriber` in
 * `bus.ts` and run this file. "refuses an event for ANOTHER town" must go red.
 * A green run after that deletion means this file proves nothing, which is the
 * failure mode `phase-e-conventions.md`'s testing section catalogues (a
 * portal search test whose fixture made its assertion vacuous, an admin-gates
 * test that iterated the list it was testing).
 *
 * Everything runs on `connectAsAppRole` — the non-owner `tmm_app` role every
 * policy binds — never the owner connection `withTestDb` hands back.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant } from "../../db/with-tenant.js";
import { createRealtimeBus, eventMatchesSubscriber, type RealtimeBus } from "../bus.js";
import { LIVE_MEETING_TOPICS, publishRealtimeEvent, type RealtimeEvent } from "../events.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A bus on its own app-role connection, plus a publisher on another. */
async function withBus(
  owner: postgres.Sql,
  fn: (bus: RealtimeBus, publish: (event: RealtimeEvent) => Promise<void>) => Promise<void>,
): Promise<void> {
  const listener = await connectAsAppRole(owner);
  const publisher = await connectAsAppRole(owner);
  const bus = await createRealtimeBus({ sql: listener });
  const db = drizzle(publisher);
  try {
    await fn(bus, (event) =>
      withTenant(db, { townId: event.townId }, (tx) =>
        publishRealtimeEvent(tx, event).then(() => undefined),
      ),
    );
  } finally {
    await bus.close(); // ends `listener`
    await publisher.end();
  }
}

/**
 * Attach to the bus and collect topics until `signal` aborts.
 *
 * Returns the array (mutated as events arrive) and the promise that settles
 * when the stream ends, so a test can publish, wait a beat, abort, and then
 * assert on what did — or did not — turn up. A negative assertion needs the
 * abort: waiting for an event that must never come has no other end.
 */
function collect(
  bus: RealtimeBus,
  subscriber: { townId: string; meetingId: string },
  signal: AbortSignal,
): { topics: string[]; done: Promise<void> } {
  const topics: string[] = [];
  const done = (async () => {
    for await (const topic of bus.subscribe(subscriber, signal)) topics.push(topic);
  })();
  return { topics, done };
}

describe("eventMatchesSubscriber", () => {
  const event: RealtimeEvent = { townId: "town-a", meetingId: "meeting-1", topic: "motion" };

  it("matches its own town and meeting", () => {
    expect(eventMatchesSubscriber(event, { townId: "town-a", meetingId: "meeting-1" })).toBe(true);
  });

  it("refuses another town, even for the same meeting id", () => {
    // A meeting id is a uuid and will not collide across towns in practice —
    // this is the degenerate case stated deliberately, because if the town
    // comparison is ever dropped, the meeting comparison is what would be left
    // holding the line and it is not enough.
    expect(eventMatchesSubscriber(event, { townId: "town-b", meetingId: "meeting-1" })).toBe(false);
  });

  it("refuses another meeting in the same town", () => {
    expect(eventMatchesSubscriber(event, { townId: "town-a", meetingId: "meeting-2" })).toBe(false);
  });
});

describe("the realtime bus", () => {
  it("delivers an event's topic to a subscriber on that town and meeting", async () => {
    await withTestDb(async (owner) => {
      await withBus(owner, async (bus, publish) => {
        const townId = randomUUID();
        const meetingId = randomUUID();
        const controller = new AbortController();
        const { topics, done } = collect(bus, { townId, meetingId }, controller.signal);

        await delay(100);
        await publish({ townId, meetingId, topic: "motion" });
        await delay(300);
        controller.abort();
        await done;

        expect(topics).toEqual(["motion"]);
      });
    });
  });

  // ─── The pin the phase spec requires ───────────────────────────────────
  it("refuses an event for ANOTHER town, and the subscriber receives nothing", async () => {
    await withTestDb(async (owner) => {
      await withBus(owner, async (bus, publish) => {
        const mine = randomUUID();
        const theirs = randomUUID();
        const meetingId = randomUUID();
        const controller = new AbortController();
        const { topics, done } = collect(bus, { townId: mine, meetingId }, controller.signal);

        await delay(100);
        // Published for ANOTHER town. The `LISTEN` connection genuinely
        // receives this — it has no tenant context and cannot be given one —
        // so a green assertion here is the filter doing its job, not Postgres
        // doing it. Proved by the control below: an event published for THIS
        // town on the same connection, in the same test, does arrive.
        await publish({ townId: theirs, meetingId, topic: "motion" });
        await delay(300);
        expect(topics).toEqual([]);

        // The control. Without it, a broken bus that delivers nothing at all
        // would pass the assertion above.
        await publish({ townId: mine, meetingId, topic: "vote_record" });
        await delay(300);
        controller.abort();
        await done;

        expect(topics).toEqual(["vote_record"]);
      });
    });
  });

  it("refuses an event for another meeting in the subscriber's own town", async () => {
    await withTestDb(async (owner) => {
      await withBus(owner, async (bus, publish) => {
        const townId = randomUUID();
        const mine = randomUUID();
        const theirs = randomUUID();
        const controller = new AbortController();
        const { topics, done } = collect(bus, { townId, meetingId: mine }, controller.signal);

        await delay(100);
        await publish({ townId, meetingId: theirs, topic: "motion" });
        await delay(300);
        controller.abort();
        await done;

        expect(topics).toEqual([]);
      });
    });
  });

  it("coalesces twenty notifications that arrive while the consumer is not pulling into ONE topic", async () => {
    await withTestDb(async (owner) => {
      await withBus(owner, async (bus, publish) => {
        const townId = randomUUID();
        const meetingId = randomUUID();
        const controller = new AbortController();

        // Driven by hand rather than with `collect`, and that is the whole
        // point of this test. A `for await` loop pulls again the instant it
        // has a value, so it never lets a backlog form — the first version of
        // this test published twenty notifications through `collect`, watched
        // the consumer drain each one before the next was even sent, and
        // asserted twenty was fewer than twenty. Measured, and wrong.
        //
        // Holding the iterator between `next()` calls is what a real slow
        // consumer looks like, and it is the only way to observe the pending
        // SET doing its job.
        const stream = bus.subscribe({ townId, meetingId }, controller.signal);

        const first = stream.next();
        await delay(100); // the generator body runs, and registers, on `next()`
        await publish({ townId, meetingId, topic: "motion" });
        expect((await first).value).toBe("motion");

        // Now NOTHING is pulling. Twenty notifications land on a pending set
        // that already holds `motion` after the first of them.
        for (let i = 0; i < 20; i += 1) await publish({ townId, meetingId, topic: "motion" });
        await delay(300);

        // One value, not twenty. An event carries no data, so "refetch
        // motions" twenty times is the same instruction as once — and the
        // pending set is what makes a burst bounded rather than a buffer that
        // grows with whatever the meeting is doing.
        expect((await stream.next()).value).toBe("motion");

        controller.abort();
        expect((await stream.next()).done).toBe(true);
      });
    });
  });

  it("delivers each distinct topic once per drain", async () => {
    await withTestDb(async (owner) => {
      await withBus(owner, async (bus, publish) => {
        const townId = randomUUID();
        const meetingId = randomUUID();
        const controller = new AbortController();
        const { topics, done } = collect(bus, { townId, meetingId }, controller.signal);

        await delay(100);
        for (const topic of LIVE_MEETING_TOPICS) await publish({ townId, meetingId, topic });
        await delay(400);
        controller.abort();
        await done;

        expect(new Set(topics)).toEqual(new Set(LIVE_MEETING_TOPICS));
      });
    });
  });

  it("deregisters a subscriber when its stream aborts, so a long-lived process does not leak one per disconnect", async () => {
    await withTestDb(async (owner) => {
      await withBus(owner, async (bus) => {
        const townId = randomUUID();
        const meetingId = randomUUID();
        expect(bus.subscriberCount).toBe(0);

        const controller = new AbortController();
        const { done } = collect(bus, { townId, meetingId }, controller.signal);
        await delay(100);
        expect(bus.subscriberCount).toBe(1);

        controller.abort();
        await done;
        expect(bus.subscriberCount).toBe(0);
      });
    });
  });

  it("wakes every parked subscriber on close, rather than leaving generators on a promise nothing resolves", async () => {
    await withTestDb(async (owner) => {
      const listener = await connectAsAppRole(owner);
      const bus = await createRealtimeBus({ sql: listener });
      const controller = new AbortController();
      const { done } = collect(
        bus,
        { townId: randomUUID(), meetingId: randomUUID() },
        controller.signal,
      );
      await delay(100);

      // No abort first. If `close()` did not wake it, this test would hang to
      // vitest's timeout rather than fail — which is why the abort comes
      // after, purely so the generator can finish once `close` has woken it.
      await bus.close();
      controller.abort();
      await done;

      expect(bus.subscriberCount).toBe(0);
    });
  });
});
