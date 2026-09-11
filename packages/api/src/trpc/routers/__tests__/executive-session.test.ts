/**
 * The `executiveSession` router — Phase E, wave 5, Task 3.
 *
 * Five writes that reached the database through the Supabase client with **no
 * authorization check of any kind** until this task, under a tenancy-only
 * policy. So the first assertion for each is not "the right people can" but
 * "the wrong people cannot", and the four-per-procedure shape is the same one
 * `motion.test.ts` states: the code (M6), the board mismatch, the reorder pin,
 * and the FK existence check where there is an FK.
 *
 * Two assertions here are about behaviour this task CHANGED rather than
 * carried over, and both are named as such in `routers/executive-session.ts`'s
 * header: `discard` refuses a session that has already begun, and
 * `appendPostSessionActionMotions` unions instead of overwriting.
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
  seedMotion,
  seedExecutiveSession,
  readRows,
  captureRealtimeEvents,
} from "./live-fixtures.js";

interface SessionRow {
  id: string;
  agenda_item_id: string | null;
  statutory_basis: string;
  entered_at: string | null;
  exited_at: string | null;
  entry_motion_id: string | null;
  post_session_action_motion_ids: string[] | null;
}

function readSessions(db: TestDb, town: TownFixture, meetingId: string): Promise<SessionRow[]> {
  return readRows<SessionRow>(
    db,
    town,
    sql`SELECT id, agenda_item_id, statutory_basis, entered_at, exited_at, entry_motion_id,
               post_session_action_motion_ids
        FROM executive_session WHERE meeting_id = ${meetingId} ORDER BY created_at, id`,
  );
}

function officerSpec(town: TownFixture) {
  return {
    role: "staff" as const,
    global: [],
    boardOverrides: [{ boardId: town.boardId, permissions: { M6: true } }],
  };
}

/** A meeting with an item and an entry motion — what every test below needs. */
async function scene(db: TestDb, town: TownFixture, boardId: string) {
  const meetingId = await seedMeeting(db, town, boardId);
  const itemId = await seedAgendaItem(db, town, meetingId);
  const motionId = await seedMotion(db, town, meetingId, itemId, {
    text: "to enter Executive Session under 1 M.R.S.A. §405(6)(A)",
  });
  return { meetingId, itemId, motionId };
}

describe("executiveSession.byMeeting", () => {
  it("returns the meeting's executive session records", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, itemId, motionId } = await scene(db, town, town.boardId);
        await seedExecutiveSession(db, town, meetingId, {
          agendaItemId: itemId,
          entryMotionId: motionId,
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.executiveSession.byMeeting({ meetingId });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ agenda_item_id: itemId, entry_motion_id: motionId });
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
          caller.executiveSession.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("executiveSession.insert", () => {
  it("files a PENDING session for a caller holding M6, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, itemId, motionId } = await scene(db, town, town.boardId);
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.executiveSession.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            entryMotionId: motionId,
            statutoryBasis: "1 M.R.S.A. §405(6)(A)",
          }),
        );

        const rows = await readSessions(db, town, meetingId);
        expect(rows).toHaveLength(1);
        // Pending: an entry motion and neither timestamp — exactly how the
        // live screen recognises one.
        expect(rows[0]).toMatchObject({
          entry_motion_id: motionId,
          entered_at: null,
          exited_at: null,
          statutory_basis: "1 M.R.S.A. §405(6)(A)",
        });
        expect(rows[0]?.post_session_action_motion_ids).toEqual([]);
        expect(topics).toEqual(["executive_session"]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M6 on this board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, itemId, motionId } = await scene(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.executiveSession.insert({
            boardId: town.boardId,
            meetingId,
            agendaItemId: itemId,
            entryMotionId: motionId,
            statutoryBasis: "1 M.R.S.A. §405(6)(A)",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("M6");
        expect(await readSessions(db, town, meetingId)).toEqual([]);
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
        const theirs = await scene(db, town, town.otherBoardId);
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.insert({
            boardId: town.boardId,
            meetingId: theirs.meetingId,
            agendaItemId: theirs.itemId,
            entryMotionId: theirs.motionId,
            statutoryBasis: "1 M.R.S.A. §405(6)(A)",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readSessions(db, town, theirs.meetingId)).toEqual([]);
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
          caller.executiveSession.insert({
            boardId: town.boardId,
            meetingId: randomUUID(),
            agendaItemId: randomUUID(),
            entryMotionId: randomUUID(),
            statutoryBasis: "",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the entry motion belongs to a different meeting, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const here = await scene(db, town, town.boardId);
        const elsewhere = await scene(db, town, town.boardId);
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.insert({
            boardId: town.boardId,
            meetingId: here.meetingId,
            agendaItemId: here.itemId,
            entryMotionId: elsewhere.motionId,
            statutoryBasis: "1 M.R.S.A. §405(6)(A)",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readSessions(db, town, here.meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("executiveSession.markEntered", () => {
  it("stamps entered_at for a caller holding M6, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, itemId, motionId } = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, meetingId, {
          agendaItemId: itemId,
          entryMotionId: motionId,
        });
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.executiveSession.markEntered({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect((await readSessions(db, town, meetingId))[0]?.entered_at).not.toBeNull();
        expect(topics).toEqual(["executive_session"]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M6 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId } = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, meetingId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.executiveSession.markEntered({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readSessions(db, town, meetingId))[0]?.entered_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the session's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirs = await scene(db, town, town.otherBoardId);
        const sessionId = await seedExecutiveSession(db, town, theirs.meetingId);
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.markEntered({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readSessions(db, town, theirs.meetingId))[0]?.entered_at).toBeNull();
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
          caller.executiveSession.markEntered({
            boardId: town.boardId,
            executiveSessionId: "not-a-uuid" as string,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a session in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const theirSession = await seedExecutiveSession(db, theirs, theirMeeting);
        const officer = await seedActor(db, mine, officerSpec(mine));
        const caller = appRouter.createCaller(contextFor(db, mine, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.markEntered({
            boardId: mine.boardId,
            executiveSessionId: theirSession,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("executiveSession.markExited", () => {
  it("stamps exited_at for a caller holding M6, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId } = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, meetingId, { enteredAt: true });
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.executiveSession.markExited({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect((await readSessions(db, town, meetingId))[0]?.exited_at).not.toBeNull();
        expect(topics).toEqual(["executive_session"]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M6 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId } = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, meetingId, { enteredAt: true });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.executiveSession.markExited({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readSessions(db, town, meetingId))[0]?.exited_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the session's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirs = await scene(db, town, town.otherBoardId);
        const sessionId = await seedExecutiveSession(db, town, theirs.meetingId, {
          enteredAt: true,
        });
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.markExited({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readSessions(db, town, theirs.meetingId))[0]?.exited_at).toBeNull();
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
          caller.executiveSession.markExited({
            boardId: town.boardId,
            executiveSessionId: "not-a-uuid" as string,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

describe("executiveSession.discard", () => {
  it("removes a PENDING session for a caller holding M6, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId } = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, meetingId);
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.executiveSession.discard({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(await readSessions(db, town, meetingId)).toEqual([]);
        expect(topics).toEqual(["executive_session"]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for a session that has already begun, and deletes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId } = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, meetingId, { enteredAt: true });
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        // The ADDED precondition — see the procedure's own doc comment. The
        // raw `.delete().eq("id", …)` this replaces had none.
        const err = await expectTrpcError(() =>
          caller.executiveSession.discard({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await readSessions(db, town, meetingId)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M6 on this board, and deletes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId } = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, meetingId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.executiveSession.discard({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readSessions(db, town, meetingId)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the session's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirs = await scene(db, town, town.otherBoardId);
        const sessionId = await seedExecutiveSession(db, town, theirs.meetingId);
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.discard({
            boardId: town.boardId,
            executiveSessionId: sessionId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readSessions(db, town, theirs.meetingId)).toHaveLength(1);
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
          caller.executiveSession.discard({
            boardId: town.boardId,
            executiveSessionId: "not-a-uuid" as string,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

describe("executiveSession.appendPostSessionActionMotions", () => {
  it("unions rather than overwriting, so two appends both survive", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, itemId } = await scene(db, town, town.boardId);
        const first = await seedMotion(db, town, meetingId, itemId, { text: "first action" });
        const second = await seedMotion(db, town, meetingId, itemId, { text: "second action" });
        const sessionId = await seedExecutiveSession(db, town, meetingId, { enteredAt: true });
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        await caller.executiveSession.appendPostSessionActionMotions({
          boardId: town.boardId,
          executiveSessionId: sessionId,
          motionIds: [first],
        });
        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.executiveSession.appendPostSessionActionMotions({
            boardId: town.boardId,
            executiveSessionId: sessionId,
            // `first` again — appending an id already stored must not
            // duplicate it, which is what makes the client's reactive effect
            // safe to re-run.
            motionIds: [first, second],
          }),
        );

        const stored = (await readSessions(db, town, meetingId))[0]?.post_session_action_motion_ids;
        expect(stored).toHaveLength(2);
        expect(new Set(stored ?? [])).toEqual(new Set([first, second]));
        expect(topics).toEqual(["executive_session"]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M6 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, itemId } = await scene(db, town, town.boardId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const sessionId = await seedExecutiveSession(db, town, meetingId, { enteredAt: true });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.executiveSession.appendPostSessionActionMotions({
            boardId: town.boardId,
            executiveSessionId: sessionId,
            motionIds: [motionId],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(
          (await readSessions(db, town, meetingId))[0]?.post_session_action_motion_ids,
        ).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the session's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirs = await scene(db, town, town.otherBoardId);
        const sessionId = await seedExecutiveSession(db, town, theirs.meetingId, {
          enteredAt: true,
        });
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.appendPostSessionActionMotions({
            boardId: town.boardId,
            executiveSessionId: sessionId,
            motionIds: [theirs.motionId],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
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
          caller.executiveSession.appendPostSessionActionMotions({
            boardId: town.boardId,
            executiveSessionId: randomUUID(),
            motionIds: [],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when a named motion belongs to a different meeting, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const here = await scene(db, town, town.boardId);
        const elsewhere = await scene(db, town, town.boardId);
        const sessionId = await seedExecutiveSession(db, town, here.meetingId, {
          enteredAt: true,
        });
        const officer = await seedActor(db, town, officerSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const err = await expectTrpcError(() =>
          caller.executiveSession.appendPostSessionActionMotions({
            boardId: town.boardId,
            executiveSessionId: sessionId,
            motionIds: [here.motionId, elsewhere.motionId],
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(
          (await readSessions(db, town, here.meetingId))[0]?.post_session_action_motion_ids,
        ).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});
