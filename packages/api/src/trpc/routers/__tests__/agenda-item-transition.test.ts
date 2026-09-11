/**
 * The `agendaItemTransition` router — Phase E, wave 5, Task 3.
 *
 * One read and no writes. The assertions worth having are therefore about the
 * read's contract and about the ABSENCE: the router exposes no way to open or
 * close a transition on its own, because a transition row and
 * `meeting.current_agenda_item_id` must move together or the live meeting's
 * clock and its position disagree. See the router's own header.
 */

import { describe, it, expect } from "vitest";
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
import { seedMeeting, seedAgendaItem } from "./live-fixtures.js";

async function seedTransition(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  agendaItemId: string,
  startedAt: string,
): Promise<void> {
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO agenda_item_transition (meeting_id, agenda_item_id, town_id, started_at)
      VALUES (${meetingId}, ${agendaItemId}, ${town.townId}, ${startedAt}::timestamptz)
    `);
  });
}

describe("agendaItemTransition.byMeeting", () => {
  it("returns the meeting's transitions oldest first", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const first = await seedAgendaItem(db, town, meetingId, { title: "First" });
        const second = await seedAgendaItem(db, town, meetingId, { title: "Second" });
        await seedTransition(db, town, meetingId, second, "2026-11-03T19:30:00Z");
        await seedTransition(db, town, meetingId, first, "2026-11-03T19:00:00Z");
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.agendaItemTransition.byMeeting({ meetingId });
        expect(rows.map((r) => r.agenda_item_id)).toEqual([first, second]);
        expect(rows[0]?.ended_at).toBeNull();
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
          caller.agendaItemTransition.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });

  it("exposes no write — transitions move with the meeting, in meeting.ts's composites", () => {
    // A structural pin, not a behavioural one. If someone adds a standalone
    // `insert`/`update` here, this goes red and they read the header that
    // explains why the writes live where they do — which is the only place
    // that reasoning exists.
    const names = Object.keys(appRouter._def.procedures).filter((name) =>
      name.startsWith("agendaItemTransition."),
    );
    expect(names).toEqual(["agendaItemTransition.byMeeting"]);
  });
});
