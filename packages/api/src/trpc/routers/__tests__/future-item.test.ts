/**
 * The `futureItem` router — Phase E, wave 6, Task 2.
 *
 * One read and no writes. See the router's own header for why: every
 * `future_item_queue` row is written by `meeting.performAdjournment`, and
 * this file only reads them back for `review.tsx`.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
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
import { seedMeeting } from "./live-fixtures.js";

async function seedFutureItem(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  sourceMeetingId: string | null,
  opts: {
    title?: string;
    description?: string | null;
    source?: string;
    status?: string;
    createdAt?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO future_item_queue (
        id, board_id, town_id, source_meeting_id, title, description, source, status, created_at
      )
      VALUES (
        ${id}, ${boardId}, ${town.townId}, ${sourceMeetingId},
        ${opts.title ?? "Discuss the budget"}, ${opts.description ?? null},
        ${opts.source ?? "deferred"}, ${opts.status ?? "pending"},
        ${opts.createdAt ?? "2026-11-03T18:00:00Z"}::timestamptz
      )
    `);
  });
  return id;
}

describe("futureItem.byMeeting", () => {
  it("returns the meeting's queued items, oldest first", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const second = await seedFutureItem(db, town, town.boardId, meetingId, {
          title: "Tabled item",
          source: "tabled",
          createdAt: "2026-11-03T19:00:00Z",
        });
        const first = await seedFutureItem(db, town, town.boardId, meetingId, {
          title: "Deferred item",
          description: "Ran out of time",
          source: "deferred",
          createdAt: "2026-11-03T18:00:00Z",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.futureItem.byMeeting({ meetingId });
        expect(rows.map((r) => r.id)).toEqual([first, second]);
        expect(rows[0]).toEqual({
          id: first,
          title: "Deferred item",
          description: "Ran out of time",
          source: "deferred",
          status: "pending",
        });
        expect(rows[1]?.description).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("does not include items queued from a different meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const otherMeetingId = await seedMeeting(db, town, town.boardId);
        await seedFutureItem(db, town, town.boardId, otherMeetingId, {
          title: "Not this meeting's item",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.futureItem.byMeeting({ meetingId })).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meeting in another town, not an empty list", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        // A queued item on the other town's meeting, so a check that were
        // ever removed would have something to (wrongly) find nothing of —
        // proving the NOT_FOUND below comes from the existence check, not
        // merely from there being nothing queued.
        await seedFutureItem(db, theirs, theirs.boardId, theirMeeting, {
          title: "Their queued item",
        });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.futureItem.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });

  it("exposes no write — every row is written by meeting.performAdjournment", () => {
    // A structural pin, not a behavioural one, matching
    // `agendaItemTransition.byMeeting`'s own. If someone adds a standalone
    // insert/update/delete here, this goes red and they read the header
    // explaining why the write stays inside adjournment.
    const names = Object.keys(appRouter._def.procedures).filter((name) =>
      name.startsWith("futureItem."),
    );
    expect(names).toEqual(["futureItem.byMeeting"]);
  });
});
