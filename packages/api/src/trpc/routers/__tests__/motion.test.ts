/**
 * The `motion` router — Phase E, wave 5, Task 3.
 *
 * What every write here has to prove, per procedure rather than once (wave
 * 5's plan says so in those words):
 *
 *   1. A caller holding M3 on the meeting's board succeeds; without it,
 *      FORBIDDEN.
 *   2. A caller holding M3 on board X, acting on a row whose meeting is on
 *      board Y, is REFUSED — the board-mismatch case. `motion` has no
 *      `board_id` column and `motion_tenant_isolation` has no board
 *      predicate, so nothing in the database stops this; only the resolver's
 *      re-derivation does.
 *   3. FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails
 *      validation — the reorder pin, which is the only thing that catches a
 *      `.use()` declared after `.input()`.
 *   4. A foreign key from client input that names a row this meeting does not
 *      own answers NOT_FOUND and writes nothing.
 *
 * Deleting a `.use(requireBoardPermission("M3", …))` line does NOT leave the
 * resolver's `assertMatchesAuthorizedBoard` working as an independent
 * re-check — it leaves `ctx.authorizedBoardId` unset and the helper refuses to
 * proceed at all with a plain wiring-bug `Error`, so nearly every test in that
 * procedure's block goes red, the successful ones included. That is the same
 * property `agenda-item.test.ts`'s header records; it is stronger than "the
 * refusal tests go red" and it is why the reorder pin is a separate assertion.
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
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import {
  seedMeeting,
  seedAgendaItem,
  seedSeat,
  seedMotion,
  readRows,
  captureRealtimeEvents,
} from "./live-fixtures.js";

interface MotionRow {
  id: string;
  agenda_item_id: string;
  motion_text: string;
  motion_type: string;
  moved_by: string | null;
  seconded_by: string | null;
  status: string;
  parent_motion_id: string | null;
}

function readMotions(db: TestDb, town: TownFixture, meetingId: string): Promise<MotionRow[]> {
  return readRows<MotionRow>(
    db,
    town,
    sql`SELECT id, agenda_item_id, motion_text, motion_type::text AS motion_type, moved_by,
               seconded_by, status::text AS status, parent_motion_id
        FROM motion WHERE meeting_id = ${meetingId} ORDER BY created_at, id`,
  );
}

/** A clerk holding M3 on `town.boardId` only — the `designated_boards` shape. */
function clerkSpec(town: TownFixture) {
  return {
    role: "staff" as const,
    global: [],
    boardOverrides: [{ boardId: town.boardId, permissions: { M3: true } }],
  };
}

describe("motion.byMeeting", () => {
  it("returns the meeting's motions oldest first", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        await seedMotion(db, town, meetingId, itemId, { text: "first motion" });
        await seedMotion(db, town, meetingId, itemId, { text: "second motion" });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.motion.byMeeting({ meetingId });
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.motion_text).sort()).toEqual(["first motion", "second motion"]);
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
          caller.motion.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("motion.insert", () => {
  it("records a motion for a caller holding M3 on the board, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const mover = await seedSeat(db, town, town.boardId);
        const seconder = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { result, topics, events } = await captureRealtimeEvents(client, 1, () =>
          caller.motion.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            motionText: "to approve the budget as presented",
            motionType: "main",
            movedBy: mover.boardMemberId,
            secondedBy: seconder.boardMemberId,
            parentMotionId: null,
          }),
        );

        expect(result.id).toBeTruthy();
        const rows = await readMotions(db, town, meetingId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          agenda_item_id: itemId,
          motion_text: "to approve the budget as presented",
          motion_type: "main",
          moved_by: mover.boardMemberId,
          seconded_by: seconder.boardMemberId,
          status: "seconded",
          parent_motion_id: null,
        });
        // The topic matches the table, and names this meeting — the half of
        // the publish contract `router-wiring.test.ts`'s inventory cannot
        // check (its `publishes` is a boolean, not a set).
        expect(topics).toEqual(["motion"]);
        expect(events[0]?.meetingId).toBe(meetingId);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M3 on this board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const mover = await seedSeat(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.motion.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            motionText: "to approve the budget as presented",
            motionType: "main",
            movedBy: mover.boardMemberId,
            secondedBy: null,
            parentMotionId: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("M3");
        expect(await readMotions(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("honours a REVOKING board override: refused on the barred board, allowed on another", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const barred = await seedMeeting(db, town, town.boardId);
        const barredItem = await seedAgendaItem(db, town, barred);
        const barredMover = await seedSeat(db, town, town.boardId);
        const other = await seedMeeting(db, town, town.otherBoardId);
        const otherItem = await seedAgendaItem(db, town, other);
        const otherMover = await seedSeat(db, town, town.otherBoardId);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: ["M3"],
          boardOverrides: [{ boardId: town.boardId, permissions: { M3: false } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.insert({
            boardId: town.boardId,
            meetingId: barred,
            agendaItemId: barredItem,
            motionText: "to approve the budget as presented",
            motionType: "main",
            movedBy: barredMover.boardMemberId,
            secondedBy: null,
            parentMotionId: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMotions(db, town, barred)).toEqual([]);

        const allowed = await caller.motion.insert({
          boardId: town.otherBoardId,
          meetingId: other,
          agendaItemId: otherItem,
          motionText: "to approve the budget as presented",
          motionType: "main",
          movedBy: otherMover.boardMemberId,
          secondedBy: null,
          parentMotionId: null,
        });
        expect(allowed.id).toBeTruthy();
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
        const theirMover = await seedSeat(db, town, town.otherBoardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.insert({
            boardId: town.boardId,
            meetingId: theirMeeting,
            agendaItemId: theirItem,
            motionText: "to approve the budget as presented",
            motionType: "main",
            movedBy: theirMover.boardMemberId,
            secondedBy: null,
            parentMotionId: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMotions(db, town, theirMeeting)).toEqual([]);
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
          caller.motion.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            // Fails `min(5)`; `boardId` above is a real uuid the guard reads.
            motionText: "no",
            motionType: "main",
            movedBy: randomUUID(),
            secondedBy: null,
            parentMotionId: null,
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
        const mover = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: foreignItem,
            motionText: "to approve the budget as presented",
            motionType: "main",
            movedBy: mover.boardMemberId,
            secondedBy: null,
            parentMotionId: null,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readMotions(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the mover's seat is on another town's board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const meetingId = await seedMeeting(db, mine, mine.boardId);
        const itemId = await seedAgendaItem(db, mine, meetingId);
        // A real `board_member.id`, in a town this caller cannot see. FK
        // enforcement bypasses row security, so without the existence check
        // this insert SUCCEEDS and records a mover from another town.
        const foreignSeat = await seedSeat(db, theirs, theirs.boardId);
        const clerk = await seedActor(db, mine, clerkSpec(mine));
        const caller = appRouter.createCaller(contextFor(db, mine, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.insert({
            boardId: mine.boardId,
            meetingId,
            agendaItemId: itemId,
            motionText: "to approve the budget as presented",
            motionType: "main",
            movedBy: foreignSeat.boardMemberId,
            secondedBy: null,
            parentMotionId: null,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readMotions(db, mine, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the parent motion belongs to a different meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const otherMeeting = await seedMeeting(db, town, town.boardId);
        const otherItem = await seedAgendaItem(db, town, otherMeeting);
        const foreignParent = await seedMotion(db, town, otherMeeting, otherItem);
        const mover = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            motionText: "to amend the motion by striking clause two",
            motionType: "amendment",
            movedBy: mover.boardMemberId,
            secondedBy: null,
            parentMotionId: foreignParent,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readMotions(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("motion.callVote", () => {
  it("moves the motion to in_vote for a caller holding M3, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.motion.callVote({ boardId: town.boardId, motionId }),
        );
        expect((await readMotions(db, town, meetingId))[0]?.status).toBe("in_vote");
        expect(topics).toEqual(["motion"]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M3 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.motion.callVote({ boardId: town.boardId, motionId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readMotions(db, town, meetingId))[0]?.status).toBe("seconded");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the motion's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const theirMotion = await seedMotion(db, town, theirMeeting, theirItem);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.callVote({ boardId: town.boardId, motionId: theirMotion }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readMotions(db, town, theirMeeting))[0]?.status).toBe("seconded");
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
          caller.motion.callVote({
            boardId: town.boardId,
            motionId: "not-a-uuid" as string,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a motion in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const theirItem = await seedAgendaItem(db, theirs, theirMeeting);
        const theirMotion = await seedMotion(db, theirs, theirMeeting, theirItem);
        const clerk = await seedActor(db, mine, clerkSpec(mine));
        const caller = appRouter.createCaller(contextFor(db, mine, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.callVote({ boardId: mine.boardId, motionId: theirMotion }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("motion.withdraw", () => {
  it("withdraws the motion for a caller holding M3, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.motion.withdraw({ boardId: town.boardId, motionId }),
        );
        expect((await readMotions(db, town, meetingId))[0]?.status).toBe("withdrawn");
        expect(topics).toEqual(["motion"]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M3 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.motion.withdraw({ boardId: town.boardId, motionId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readMotions(db, town, meetingId))[0]?.status).toBe("seconded");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the motion's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const theirMotion = await seedMotion(db, town, theirMeeting, theirItem);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.motion.withdraw({ boardId: town.boardId, motionId: theirMotion }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readMotions(db, town, theirMeeting))[0]?.status).toBe("seconded");
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
          caller.motion.withdraw({
            boardId: town.boardId,
            motionId: "not-a-uuid" as string,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});
