/**
 * `realtime.onMeetingChange` — the first subscription in this codebase. See
 * `routers/realtime.ts`'s header for the design and `realtime/bus.ts`'s for
 * why the tenancy filter is application code.
 *
 * This file is the end-to-end half of the pin the phase spec requires — "a
 * subscriber must not be able to receive an event for a town it cannot read …
 * pinned by a test, not asserted". `realtime/__tests__/bus.test.ts` pins the
 * filter; this pins the whole path: a real `contextFor` context built from a
 * real account, the real procedure through `appRouter.createCaller`, a real
 * `pg_notify` from inside a real tenant transaction, and a real `LISTEN`
 * connection that genuinely receives the other town's event and has to refuse
 * it in application code because no policy can.
 *
 * **The mutation that proves it is load-bearing:** delete
 * `event.townId === subscriber.townId` from `eventMatchesSubscriber` in
 * `realtime/bus.ts`. "does not deliver an event published for another town"
 * below must go red.
 *
 * It also carries the two lifetime pins Phase E wave 5, Task 1 settled, which
 * are about `context.ts`'s reentrancy guard rather than about this procedure:
 * the stream opens exactly ONE `ctx.withTenant` transaction no matter how many
 * events it delivers, and it never resolves `ctx.actor()`. Both are properties
 * a future author can break without noticing, which is why they are counted
 * rather than described.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import { withTenant } from "../../../db/with-tenant.js";
import {
  seedTown,
  seedActor,
  contextFor,
  testDb,
  inTown,
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import { bindTenantAccess, type TrpcContext } from "../../context.js";
import { createRealtimeBus, type RealtimeBus } from "../../../realtime/bus.js";
import {
  LIVE_MEETING_TOPICS,
  publishRealtimeEvent,
  type LiveMeetingTopic,
  type RealtimeEvent,
} from "../../../realtime/events.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function seedMeeting(db: TestDb, town: TownFixture, boardId: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status, meeting_type, agenda_status)
      VALUES (${id}, ${boardId}, ${town.townId}, 'Regular Meeting', '2026-11-03'::date,
              'open'::meeting_status, 'regular', 'published')
    `);
  });
  return id;
}

/**
 * A bus and a publisher, both on their own app-role connections.
 *
 * `connectAsAppRole`, never the owner connection `withTestDb` hands back — the
 * standing discipline for every test in this phase that touches tenancy, and
 * here it also means the `LISTEN` runs as the non-owner role production uses.
 */
async function withBus(
  owner: postgres.Sql,
  fn: (bus: RealtimeBus, publish: (event: RealtimeEvent) => Promise<void>) => Promise<void>,
): Promise<void> {
  const listener = await connectAsAppRole(owner);
  const publisher = await connectAsAppRole(owner);
  const publisherDb = drizzle(publisher);
  const bus = await createRealtimeBus({ sql: listener });
  try {
    await fn(bus, (event) =>
      withTenant(publisherDb, { townId: event.townId }, (tx) =>
        publishRealtimeEvent(tx, event).then(() => undefined),
      ),
    );
  } finally {
    await bus.close();
    await publisher.end();
  }
}

/**
 * What a `tracked()` yield looks like on the caller side.
 *
 * `createCaller` hands back the envelope the transport would serialise —
 * `[id, data, symbol]` — rather than the `{ id, data }` object the browser
 * client reconstructs. Destructured in one place so a test reads as a list of
 * topics.
 */
type TrackedYield = [string, { topic: LiveMeetingTopic }, unknown];

function topicsOf(values: TrackedYield[]): LiveMeetingTopic[] {
  return values.map(([, data]) => data.topic);
}

function idsOf(values: TrackedYield[]): string[] {
  return values.map(([id]) => id);
}

/**
 * Subscribe and collect until `signal` aborts.
 *
 * The abort is how a negative assertion ends: waiting for an event that must
 * never arrive has no other terminating condition, and a test that hangs to
 * vitest's 30-second timeout reports a hang rather than a failure.
 */
function collect(
  ctx: TrpcContext,
  input: { meetingId: string; lastEventId?: string | null },
  signal: AbortSignal,
): { values: TrackedYield[]; done: Promise<void> } {
  const values: TrackedYield[] = [];
  const done = (async () => {
    const caller = appRouter.createCaller(ctx, { signal });
    const stream = (await caller.realtime.onMeetingChange(input)) as AsyncIterable<TrackedYield>;
    for await (const value of stream) values.push(value);
  })();
  return { values, done };
}

describe("realtime.onMeetingChange", () => {
  it("yields the topic of an event published for the caller's own meeting", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        await withBus(owner, async (bus, publish) => {
          const ctx = contextFor(db, town, actor, bus);
          const controller = new AbortController();
          const { values, done } = collect(ctx, { meetingId }, controller.signal);

          await delay(150);
          await publish({ townId: town.townId, meetingId, topic: "motion" });
          await delay(300);
          controller.abort();
          await done;

          expect(topicsOf(values)).toEqual(["motion"]);
        });
      } finally {
        await app.end();
      }
    });
  });

  // ─── The pin the phase spec requires, end to end ───────────────────────
  it("does not deliver an event published for another town, while still delivering its own", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const myMeeting = await seedMeeting(db, mine, mine.boardId);
        const actor = await seedActor(db, mine, { role: "admin" });

        await withBus(owner, async (bus, publish) => {
          const ctx = contextFor(db, mine, actor, bus);
          const controller = new AbortController();
          const { values, done } = collect(ctx, { meetingId: myMeeting }, controller.signal);
          await delay(150);

          // Bristol publishes an event naming MY meeting's id. The `LISTEN`
          // connection receives it — it is outside any transaction, so
          // `app.town_id` is unset and no policy applies to the delivery (see
          // `realtime/bus.ts`). Only `eventMatchesSubscriber` stands between
          // it and this subscriber, and the subscriber's town came from
          // `ctx.tenant`, which the session resolved — there is no input on
          // this procedure that can name a town.
          await publish({ townId: theirs.townId, meetingId: myMeeting, topic: "motion" });
          await delay(300);
          expect(topicsOf(values)).toEqual([]);

          // The control, without which a subscription that delivers nothing at
          // all would pass the assertion above.
          await publish({ townId: mine.townId, meetingId: myMeeting, topic: "vote_record" });
          await delay(300);
          controller.abort();
          await done;

          expect(topicsOf(values)).toEqual(["vote_record"]);
        });
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meeting in another town, before yielding anything", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const actor = await seedActor(db, mine, { role: "admin" });

        await withBus(owner, async (bus) => {
          const ctx = contextFor(db, mine, actor, bus);
          const controller = new AbortController();
          const caller = appRouter.createCaller(ctx, { signal: controller.signal });

          // NOT_FOUND, not FORBIDDEN — conventions item 3. The refusal must
          // not tell a caller whether a uuid they guessed belongs to somebody.
          const err = await expectTrpcError(async () => {
            const stream = (await caller.realtime.onMeetingChange({
              meetingId: theirMeeting,
            })) as AsyncIterable<TrackedYield>;
            for await (const value of stream) return value;
            return undefined;
          });
          expect(err.code).toBe("NOT_FOUND");

          // And nothing was ever attached: the refusal happened before the
          // subscribe, so no registration was made and none leaked.
          expect(bus.subscriberCount).toBe(0);
          controller.abort();
        });
      } finally {
        await app.end();
      }
    });
  });

  // ─── The two context-lifetime pins (see this file's header) ────────────

  it("opens EXACTLY ONE ctx.withTenant transaction for the whole stream, however many events it delivers", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });

        await withBus(owner, async (bus, publish) => {
          // The real `bindTenantAccess` — the same function `createTrpcContext`
          // and `contextFor` both call — wrapped only to COUNT. A hand-rolled
          // pairing would not carry the reentrancy guard, which is the thing
          // this test exists to keep unreachable.
          let transactions = 0;
          let actorResolutions = 0;
          const bound = bindTenantAccess(
            ((fn: (tx: never) => Promise<unknown>) => {
              transactions += 1;
              return withTenant(db, { townId: town.townId }, fn as never);
            }) as never,
            {
              townId: town.townId,
              personId: actor.personId,
              userAccountId: actor.userAccountId,
            },
          );
          const ctx: TrpcContext = {
            req: {} as never,
            res: {} as never,
            authUser: { id: "auth-user", email: "a@example.test", emailVerified: true },
            tenant: {
              townId: town.townId,
              personId: actor.personId,
              userAccountId: actor.userAccountId,
            },
            withTenant: bound.withTenant,
            actor: () => {
              actorResolutions += 1;
              return bound.actor();
            },
            realtime: bus,
          };

          const controller = new AbortController();
          const { values, done } = collect(ctx, { meetingId }, controller.signal);
          await delay(150);
          for (const topic of LIVE_MEETING_TOPICS) {
            await publish({ townId: town.townId, meetingId, topic });
            await delay(40);
          }
          await delay(300);
          controller.abort();
          await done;

          expect(values.length).toBeGreaterThan(1);

          // ONE transaction: the subscribe-time existence check, and nothing
          // after it. A per-event read would take a pooled connection per
          // event on a stream that bursts during a roll-call vote — and two
          // OVERLAPPING ones are what `bindTenantAccess`'s `inTransaction`
          // guard refuses, which is the interaction Phase E wave 5, Task 1
          // was opened to settle. Keeping the count at one is what makes that
          // guard unreachable here rather than merely un-hit so far.
          expect(transactions).toBe(1);

          // And no actor is ever resolved, so the memo is never warmed and
          // there is no stale actor to reason about for the life of the
          // stream. This procedure's only rule is tenancy; see its header.
          // If a later change adds a permission code here, this goes red and
          // the author has to read `context.ts`'s staleness statement rather
          // than inherit it silently.
          expect(actorResolutions).toBe(0);
        });
      } finally {
        await app.end();
      }
    });
  });

  // ─── Resume ────────────────────────────────────────────────────────────

  it("resyncs every topic when the client resumes with a lastEventId", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });

        await withBus(owner, async (bus) => {
          const ctx = contextFor(db, town, actor, bus);
          const controller = new AbortController();
          const { values, done } = collect(
            ctx,
            { meetingId, lastEventId: "41" },
            controller.signal,
          );

          await delay(300);
          controller.abort();
          await done;

          // Everything, because notifications published while the connection
          // was down are gone — Postgres does not queue for an absent
          // listener. The alternative is a live meeting quietly missing the
          // motion that passed during the gap.
          expect(topicsOf(values).sort()).toEqual([...LIVE_MEETING_TOPICS].sort());
          // Ids continue from the resumed one rather than restarting, so the
          // sequence a client sees stays monotonic across reconnects.
          expect(idsOf(values)[0]).toBe("42");
        });
      } finally {
        await app.end();
      }
    });
  });

  it("yields nothing up front on a FIRST connection, which carries no lastEventId", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });

        await withBus(owner, async (bus) => {
          const ctx = contextFor(db, town, actor, bus);
          const controller = new AbortController();
          const { values, done } = collect(ctx, { meetingId }, controller.signal);

          await delay(300);
          controller.abort();
          await done;

          // A fresh subscribe happens alongside the screen's own first fetch
          // of all eight reads. Resyncing here would refetch every one of them
          // a second time on every mount.
          expect(values).toEqual([]);
        });
      } finally {
        await app.end();
      }
    });
  });

  // ─── Wiring refusals ───────────────────────────────────────────────────

  it("refuses with INTERNAL_SERVER_ERROR when the context carries no realtime bus", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });
        // No fourth argument — the shape every non-subscription test uses.
        const ctx = contextFor(db, town, actor);
        const controller = new AbortController();
        const caller = appRouter.createCaller(ctx, { signal: controller.signal });

        const err = await expectTrpcError(() => caller.realtime.onMeetingChange({ meetingId }));
        // Not FORBIDDEN: there is nothing about this caller to refuse. A
        // subscription that attached to nothing and simply never yielded would
        // look exactly like a quiet meeting.
        expect(err.code).toBe("INTERNAL_SERVER_ERROR");
        expect(err.message).toMatch(/createTrpcContextFactory/);
        controller.abort();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when invoked with no AbortSignal, rather than leaking a bus registration", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });

        await withBus(owner, async (bus) => {
          const ctx = contextFor(db, town, actor, bus);
          // No `{ signal }` — which `createCaller` permits and the real
          // adapter never does.
          const caller = appRouter.createCaller(ctx);

          const err = await expectTrpcError(async () => {
            const stream = (await caller.realtime.onMeetingChange({
              meetingId,
            })) as AsyncIterable<TrackedYield>;
            for await (const value of stream) return value;
            return undefined;
          });
          expect(err.code).toBe("INTERNAL_SERVER_ERROR");
          expect(err.message).toMatch(/AbortSignal/);
          expect(bus.subscriberCount).toBe(0);
        });
      } finally {
        await app.end();
      }
    });
  });

  it("deregisters from the bus when the stream ends", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });

        await withBus(owner, async (bus) => {
          const ctx = contextFor(db, town, actor, bus);
          const controller = new AbortController();
          const { done } = collect(ctx, { meetingId }, controller.signal);

          await delay(150);
          expect(bus.subscriberCount).toBe(1);

          // What tRPC does on client disconnect AND at `sse.maxDurationMs`:
          // it aborts this signal. A process serving long-lived SSE that did
          // not clean up here would accumulate one dead registration per
          // disconnect for its whole uptime.
          controller.abort();
          await done;
          expect(bus.subscriberCount).toBe(0);
        });
      } finally {
        await app.end();
      }
    });
  });
});
