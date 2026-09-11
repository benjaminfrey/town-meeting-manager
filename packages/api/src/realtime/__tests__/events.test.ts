/**
 * Phase E, wave 5, Task 1 — what `NOTIFY` actually does under this schema.
 *
 * Two of these are about Postgres's behaviour rather than about this
 * codebase's, and they are here because the design rests on both and neither
 * is obvious from reading the code:
 *
 *   - the runtime role `tmm_app` — a NON-owner, which every RLS policy in this
 *     database binds — can `LISTEN` and can `pg_notify`. If it could not, the
 *     bridge would need an elevated connection and `realtime/bus.ts`'s claim
 *     that it holds no RLS bypass would be false.
 *   - a `pg_notify` in a transaction that ROLLS BACK is never delivered, and
 *     one in a committed transaction is. That is what makes
 *     `publishRealtimeEvent(tx, ...)` correct to call inside the same
 *     `ctx.withTenant` transaction as the write it announces: no client is
 *     ever told to refetch a row that then did not happen.
 *
 * Everything runs through `connectAsAppRole`, never the owner connection
 * `withTestDb` hands back — the same discipline every other router test in this
 * phase follows, and here it is the point rather than a convention.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant } from "../../db/with-tenant.js";
import {
  LIVE_MEETING_TOPICS,
  REALTIME_CHANNEL,
  parseRealtimeEvent,
  publishRealtimeEvent,
} from "../events.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open a second app-role connection, `LISTEN` on it, and collect payloads.
 *
 * A second connection rather than a second use of the publisher's, because
 * that is the shape production runs: `server.ts` gives the bus its own handle.
 */
async function withListener(
  owner: postgres.Sql,
  fn: (received: string[], publisher: postgres.Sql) => Promise<void>,
): Promise<void> {
  const listener = await connectAsAppRole(owner);
  const publisher = await connectAsAppRole(owner);
  const received: string[] = [];
  try {
    await listener.listen(REALTIME_CHANNEL, (payload) => received.push(payload));
    await fn(received, publisher);
  } finally {
    await listener.end();
    await publisher.end();
  }
}

describe("publishRealtimeEvent", () => {
  it("is delivered to a LISTENing app-role connection when the transaction commits", async () => {
    await withTestDb(async (owner) => {
      await withListener(owner, async (received, publisher) => {
        const townId = randomUUID();
        const meetingId = randomUUID();

        // Through `withTenant`, so this is the same transaction shape a
        // procedure's `ctx.withTenant` opens — including `set_config`.
        await withTenant(drizzle(publisher), { townId }, async (tx) => {
          await publishRealtimeEvent(tx, { townId, meetingId, topic: "motion" });
        });

        await delay(300);
        expect(received.map((p) => parseRealtimeEvent(p))).toEqual([
          { townId, meetingId, topic: "motion" },
        ]);
      });
    });
  });

  it("is NOT delivered when the transaction rolls back", async () => {
    await withTestDb(async (owner) => {
      await withListener(owner, async (received, publisher) => {
        const townId = randomUUID();
        const meetingId = randomUUID();

        await expect(
          withTenant(drizzle(publisher), { townId }, async (tx) => {
            await publishRealtimeEvent(tx, { townId, meetingId, topic: "motion" });
            throw new Error("the write this announced failed");
          }),
        ).rejects.toThrow("the write this announced failed");

        await delay(300);
        // If this ever fails, `publishRealtimeEvent`'s "call it from inside the
        // write's own transaction" contract has stopped being safe: a client
        // would be told to refetch a row that was rolled back, read the old
        // one, and never hear about it again.
        expect(received).toEqual([]);
      });
    });
  });
});

describe("parseRealtimeEvent", () => {
  it("round-trips every live-meeting topic", () => {
    for (const topic of LIVE_MEETING_TOPICS) {
      const payload = JSON.stringify({ townId: "t", meetingId: "m", topic });
      expect(parseRealtimeEvent(payload)).toEqual({ townId: "t", meetingId: "m", topic });
    }
  });

  it.each([
    ["not json at all", "}{"],
    ["a JSON scalar", '"motion"'],
    ["a JSON array", '["motion"]'],
    ["a missing townId", JSON.stringify({ meetingId: "m", topic: "motion" })],
    ["an empty townId", JSON.stringify({ townId: "", meetingId: "m", topic: "motion" })],
    ["a missing meetingId", JSON.stringify({ townId: "t", topic: "motion" })],
    ["a non-string townId", JSON.stringify({ townId: 1, meetingId: "m", topic: "motion" })],
    ["a missing topic", JSON.stringify({ townId: "t", meetingId: "m" })],
    // The one that matters: an unrecognised topic is forwarded verbatim to a
    // browser as a cache key if this check is dropped.
    ["an unknown topic", JSON.stringify({ townId: "t", meetingId: "m", topic: "town" })],
  ])("returns undefined for %s, rather than throwing", (_label, payload) => {
    expect(parseRealtimeEvent(payload)).toBeUndefined();
  });
});
