/**
 * `meetingAttendance.countByMeeting` — see `routers/meeting-attendance.ts`'s
 * header for why this router carries only one procedure as of wave 3, Task
 * 3.
 *
 * Same connection discipline as every other router test in this phase: every
 * case that touches tenancy or RLS runs through `connectAsAppRole`, never the
 * owner connection `withTestDb` hands back.
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

async function seedMeeting(db: TestDb, town: TownFixture, boardId: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status, meeting_type, agenda_status)
      VALUES (${id}, ${boardId}, ${town.townId}, 'Regular Meeting', '2026-11-03'::date,
              'draft'::meeting_status, 'regular', 'draft')
    `);
  });
  return id;
}

async function seedAttendance(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  personId: string,
): Promise<void> {
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting_attendance (meeting_id, town_id, person_id)
      VALUES (${meetingId}, ${town.townId}, ${personId})
    `);
  });
}

describe("meetingAttendance.countByMeeting", () => {
  it("counts the attendance records on a meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const admin = await seedActor(db, town, { role: "admin" });
        const other = await seedActor(db, town, { role: "staff", global: [] });
        await seedAttendance(db, town, meetingId, admin.personId);
        await seedAttendance(db, town, meetingId, other.personId);
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        expect(await caller.meetingAttendance.countByMeeting({ meetingId })).toBe(2);
      } finally {
        await app.end();
      }
    });
  });

  it("answers 0 for a meeting with no attendance recorded yet", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.meetingAttendance.countByMeeting({ meetingId })).toBe(0);
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
          caller.meetingAttendance.countByMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an id that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meetingAttendance.countByMeeting({ meetingId: randomUUID() }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

/**
 * ─── Phase E, wave 5, Task 3 — the read and the two writes ────────────────
 *
 * The writes had no authorization check of any kind before this task
 * (`meeting_attendance_tenant_isolation` is tenancy-only), and each screen
 * chose between UPDATE and INSERT in the browser. What the tests below have to
 * establish, beyond the standard four per procedure (M2, board mismatch,
 * reorder pin, FK existence):
 *
 *   - **`setRollCall` and `setStatus` are not the same procedure**, and the
 *     difference is the timestamps. Pinned by asserting that a roll-call
 *     toggle leaves `departed_at` alone where a status change clears it.
 *   - **Both are upserts**, so a second caller updates rather than colliding
 *     with `attendance_unique_per_meeting`.
 *   - **`person_id` is derived from the seat**, never from the request — there
 *     is no `personId` input to send a wrong one through.
 */

import {
  seedSeat,
  readRows,
  captureRealtimeEvents,
  seedMeeting as seedLiveMeeting,
} from "./live-fixtures.js";

interface AttendanceRow {
  id: string;
  board_member_id: string | null;
  person_id: string;
  status: string;
  is_recording_secretary: boolean;
  arrived_at: string | null;
  departed_at: string | null;
}

function readAttendance(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
): Promise<AttendanceRow[]> {
  return readRows<AttendanceRow>(
    db,
    town,
    sql`SELECT id, board_member_id, person_id, status::text AS status, is_recording_secretary,
               arrived_at, departed_at
        FROM meeting_attendance WHERE meeting_id = ${meetingId} ORDER BY person_id`,
  );
}

function recorderSpec(town: TownFixture) {
  return {
    role: "staff" as const,
    global: [],
    boardOverrides: [{ boardId: town.boardId, permissions: { M2: true } }],
  };
}

describe("meetingAttendance.byMeeting", () => {
  it("returns the meeting's whole roll", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedLiveMeeting(db, town, town.boardId);
        const seat = await seedSeat(db, town, town.boardId);
        const recorder = await seedActor(db, town, recorderSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, recorder));
        await caller.meetingAttendance.setRollCall({
          boardId: town.boardId,
          meetingId,
          boardMemberId: seat.boardMemberId,
          status: "present",
        });

        const rows = await caller.meetingAttendance.byMeeting({ meetingId });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          board_member_id: seat.boardMemberId,
          person_id: seat.personId,
          status: "present",
          is_recording_secretary: false,
        });
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
          caller.meetingAttendance.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("meetingAttendance.setRollCall", () => {
  it("inserts then updates the same row, deriving person_id from the seat, and announces both", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedLiveMeeting(db, town, town.boardId);
        const seat = await seedSeat(db, town, town.boardId);
        const recorder = await seedActor(db, town, recorderSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, recorder));

        const { result, topics } = await captureRealtimeEvents(client, 1, () =>
          caller.meetingAttendance.setRollCall({
            boardId: town.boardId,
            meetingId,
            boardMemberId: seat.boardMemberId,
            status: "present",
          }),
        );
        expect(topics).toEqual(["meeting_attendance"]);

        // The second call is the ON CONFLICT branch: one row, not two, and
        // not a unique-violation error the way the browser's read-then-decide
        // produced when two clerks raced.
        const second = await caller.meetingAttendance.setRollCall({
          boardId: town.boardId,
          meetingId,
          boardMemberId: seat.boardMemberId,
          status: "absent",
        });
        expect(second.id).toBe(result.id);

        const rows = await readAttendance(db, town, meetingId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ person_id: seat.personId, status: "absent" });
      } finally {
        await app.end();
      }
    });
  });

  it("leaves departed_at alone, unlike setStatus", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedLiveMeeting(db, town, town.boardId);
        const seat = await seedSeat(db, town, town.boardId);
        const recorder = await seedActor(db, town, recorderSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, recorder));

        // The row has to EXIST first: both procedures' INSERT branch writes
        // `departed_at = NULL` unconditionally, matching `AttendancePanel`'s
        // own insert branch (`departed_at: null`), so the timestamp rules only
        // apply on the UPDATE side. Faithful, and easy to misread as a bug.
        await caller.meetingAttendance.setStatus({
          boardId: town.boardId,
          meetingId,
          boardMemberId: seat.boardMemberId,
          status: "present",
        });
        // `setStatus` stamps `departed_at`…
        await caller.meetingAttendance.setStatus({
          boardId: town.boardId,
          meetingId,
          boardMemberId: seat.boardMemberId,
          status: "early_departure",
        });
        expect((await readAttendance(db, town, meetingId))[0]?.departed_at).not.toBeNull();

        // …and the pre-meeting roll-call toggle must not clear it, because
        // `MeetingStartFlow`'s update writes `{status}` and nothing else.
        await caller.meetingAttendance.setRollCall({
          boardId: town.boardId,
          meetingId,
          boardMemberId: seat.boardMemberId,
          status: "present",
        });
        const row = (await readAttendance(db, town, meetingId))[0];
        expect(row?.status).toBe("present");
        expect(row?.departed_at).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M2 on this board, and records nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedLiveMeeting(db, town, town.boardId);
        const seat = await seedSeat(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meetingAttendance.setRollCall({
            boardId: town.boardId,
            meetingId,
            boardMemberId: seat.boardMemberId,
            status: "present",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("M2");
        expect(await readAttendance(db, town, meetingId)).toEqual([]);
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
        const theirMeeting = await seedLiveMeeting(db, town, town.otherBoardId);
        const theirSeat = await seedSeat(db, town, town.otherBoardId);
        const recorder = await seedActor(db, town, recorderSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, recorder));

        const err = await expectTrpcError(() =>
          caller.meetingAttendance.setRollCall({
            boardId: town.boardId,
            meetingId: theirMeeting,
            boardMemberId: theirSeat.boardMemberId,
            status: "present",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readAttendance(db, town, theirMeeting)).toEqual([]);
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
          caller.meetingAttendance.setRollCall({
            boardId: town.boardId,
            meetingId: "not-a-uuid" as string,
            boardMemberId: randomUUID(),
            status: "present",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the seat is on another board, and records nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedLiveMeeting(db, town, town.boardId);
        // A real seat, in the same town, on a DIFFERENT board. FK enforcement
        // bypasses row security and would accept it.
        const foreignSeat = await seedSeat(db, town, town.otherBoardId);
        const recorder = await seedActor(db, town, recorderSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, recorder));

        const err = await expectTrpcError(() =>
          caller.meetingAttendance.setRollCall({
            boardId: town.boardId,
            meetingId,
            boardMemberId: foreignSeat.boardMemberId,
            status: "present",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readAttendance(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("meetingAttendance.setStatus", () => {
  it("stamps arrived_at for late_arrival and keeps it across a later status change", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedLiveMeeting(db, town, town.boardId);
        const seat = await seedSeat(db, town, town.boardId);
        const recorder = await seedActor(db, town, recorderSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, recorder));

        const { topics } = await captureRealtimeEvents(client, 1, () =>
          caller.meetingAttendance.setStatus({
            boardId: town.boardId,
            meetingId,
            boardMemberId: seat.boardMemberId,
            status: "late_arrival",
          }),
        );
        expect(topics).toEqual(["meeting_attendance"]);
        const arrived = (await readAttendance(db, town, meetingId))[0]?.arrived_at;
        expect(arrived).not.toBeNull();

        // The asymmetry `AttendancePanel` has always had: `arrived_at` is kept
        // on a non-late status, `departed_at` is cleared.
        await caller.meetingAttendance.setStatus({
          boardId: town.boardId,
          meetingId,
          boardMemberId: seat.boardMemberId,
          status: "present",
        });
        const row = (await readAttendance(db, town, meetingId))[0];
        expect(row?.arrived_at).toBe(arrived);
        expect(row?.departed_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M2 on this board, and records nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedLiveMeeting(db, town, town.boardId);
        const seat = await seedSeat(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meetingAttendance.setStatus({
            boardId: town.boardId,
            meetingId,
            boardMemberId: seat.boardMemberId,
            status: "present",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readAttendance(db, town, meetingId)).toEqual([]);
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
        const theirMeeting = await seedLiveMeeting(db, town, town.otherBoardId);
        const theirSeat = await seedSeat(db, town, town.otherBoardId);
        const recorder = await seedActor(db, town, recorderSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, recorder));

        const err = await expectTrpcError(() =>
          caller.meetingAttendance.setStatus({
            boardId: town.boardId,
            meetingId: theirMeeting,
            boardMemberId: theirSeat.boardMemberId,
            status: "present",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readAttendance(db, town, theirMeeting)).toEqual([]);
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
          caller.meetingAttendance.setStatus({
            boardId: town.boardId,
            meetingId: "not-a-uuid" as string,
            boardMemberId: randomUUID(),
            status: "present",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the seat is on another town's board, and records nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const meetingId = await seedLiveMeeting(db, mine, mine.boardId);
        const foreignSeat = await seedSeat(db, theirs, theirs.boardId);
        const recorder = await seedActor(db, mine, recorderSpec(mine));
        const caller = appRouter.createCaller(contextFor(db, mine, recorder));

        const err = await expectTrpcError(() =>
          caller.meetingAttendance.setStatus({
            boardId: mine.boardId,
            meetingId,
            boardMemberId: foreignSeat.boardMemberId,
            status: "present",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readAttendance(db, mine, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});
