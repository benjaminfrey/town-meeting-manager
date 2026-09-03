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
