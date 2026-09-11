/**
 * The `guestSpeaker` router — Phase E, wave 5, Task 3.
 *
 * Two writes that reached the database with no authorization check of any kind
 * until this task. M7 (`manage_speaker_queue`) now governs both, through
 * `requireBoardPermission` — the same four assertions per procedure as
 * `motion.test.ts`: the code, the board mismatch, the reorder pin, and the FK
 * existence check.
 */

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import {
  seedTown,
  seedActor,
  contextFor,
  testDb,
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import {
  seedMeeting,
  seedAgendaItem,
  seedGuestSpeaker,
  readRows,
  captureRealtimeEvents,
} from "./live-fixtures.js";

interface SpeakerRow {
  id: string;
  agenda_item_id: string | null;
  name: string;
  address: string | null;
  topic: string | null;
}

function readSpeakers(db: TestDb, town: TownFixture, meetingId: string): Promise<SpeakerRow[]> {
  return readRows<SpeakerRow>(
    db,
    town,
    sql`SELECT id, agenda_item_id, name, address, topic
        FROM guest_speaker WHERE meeting_id = ${meetingId} ORDER BY created_at, id`,
  );
}

function clerkSpec(town: TownFixture) {
  return {
    role: "staff" as const,
    global: [],
    boardOverrides: [{ boardId: town.boardId, permissions: { M7: true } }],
  };
}

describe("guestSpeaker.byMeeting", () => {
  it("returns the meeting's speaker queue", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        await seedGuestSpeaker(db, town, meetingId, itemId);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.guestSpeaker.byMeeting({ meetingId });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ agenda_item_id: itemId, name: "Jane Resident" });
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meeting in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("guestSpeaker.insert", () => {
  it("queues a speaker for a caller holding M7, nulls blank fields, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { topics, events } = await captureRealtimeEvents(client, 1, () =>
          caller.guestSpeaker.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            name: "  Sam Resident  ",
            // Whitespace becomes NULL, matching the form's `x.trim() || null`
            // — so a blank address and an absent one are not two states in
            // the minutes.
            address: "   ",
            topic: "the culvert on Mills Road",
          }),
        );

        const rows = await readSpeakers(db, town, meetingId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          agenda_item_id: itemId,
          name: "Sam Resident",
          address: null,
          topic: "the culvert on Mills Road",
        });
        expect(topics).toEqual(["guest_speaker"]);
        expect(events[0]?.meetingId).toBe(meetingId);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M7 on this board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            name: "Sam Resident",
            address: null,
            topic: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("M7");
        expect(await readSpeakers(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the claimed boardId does not match the meeting's real board", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.insert({
            boardId: town.boardId,
            meetingId: theirMeeting,
            agendaItemId: theirItem,
            name: "Sam Resident",
            address: null,
            topic: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readSpeakers(db, town, theirMeeting)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            // Fails `min(1)` after trimming.
            name: "   ",
            address: null,
            topic: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the agenda item belongs to a different meeting, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const otherMeeting = await seedMeeting(db, town, town.boardId);
        const foreignItem = await seedAgendaItem(db, town, otherMeeting);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: foreignItem,
            name: "Sam Resident",
            address: null,
            topic: null,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readSpeakers(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("guestSpeaker.delete", () => {
  it("removes a speaker for a caller holding M7, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const speakerId = await seedGuestSpeaker(db, town, meetingId, itemId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.guestSpeaker.delete({ boardId: town.boardId, speakerId }),
        );
        expect(await readSpeakers(db, town, meetingId)).toEqual([]);
        expect(topics).toEqual(["guest_speaker"]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M7 on this board, and deletes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const speakerId = await seedGuestSpeaker(db, town, meetingId, itemId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.delete({ boardId: town.boardId, speakerId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readSpeakers(db, town, meetingId)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the speaker's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const theirSpeaker = await seedGuestSpeaker(db, town, theirMeeting, theirItem);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.delete({ boardId: town.boardId, speakerId: theirSpeaker }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readSpeakers(db, town, theirMeeting)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.delete({
            boardId: town.boardId,
            speakerId: "not-a-uuid" as string,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a speaker in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const theirItem = await seedAgendaItem(db, theirs, theirMeeting);
        const theirSpeaker = await seedGuestSpeaker(db, theirs, theirMeeting, theirItem);
        const clerk = await seedActor(db, mine, clerkSpec(mine));
        const caller = appRouter.createCaller(contextFor(db, mine, clerk));

        const err = await expectTrpcError(() =>
          caller.guestSpeaker.delete({ boardId: mine.boardId, speakerId: theirSpeaker }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});
