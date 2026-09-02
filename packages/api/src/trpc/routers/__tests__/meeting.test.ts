/**
 * `meeting.byTown` / `.byBoard` / `.detail` / `.insert` / `.cancel`.
 *
 * `insert`/`cancel` are this codebase's first REAL call sites for the
 * board-scoped half of conventions item 2 (`requireBoardPermission`/
 * `BoardScope`) — every prior wave's write was an actor-only admin gate. The
 * four things wave 3's task brief asks to prove by mutation, each with its
 * own test below:
 *
 *   1. A caller WITH A1 on a board succeeds; WITHOUT it, FORBIDDEN.
 *   2. A caller with a REVOKING board override for A1 is refused on that
 *      board and still allowed on another — the case the whole board-scoped
 *      mechanism exists for, and (per the task brief) never exercised by a
 *      real procedure before this task.
 *   3. Moving `.use()` after `.input()` turns a reorder pin red — proved
 *      here by input that fails validation on a field the guard does not
 *      read, while the field the guard DOES read (`boardId`) stays valid,
 *      mirroring `require-permission.test.ts`'s own reorder pin rather than
 *      `board-member.test.ts`'s (whose `requireActor` guards read neither
 *      field, so any garbage value works there; `boardIdFrom()` here reads
 *      `boardId` for real, so it has to stay valid for the pin to prove
 *      anything about ORDER rather than about the extractor).
 *   4. Removing `assertBoardExists` from `insert` lets a cross-tenant write
 *      succeed — reproduced once during this task (see the task report),
 *      restored; the NOT_FOUND test below is what stays red without it.
 *
 * `cancel` carries a fifth kind of test neither `insert` nor any prior
 * router needed: the board-MISMATCH case `meeting.ts`'s own header names —
 * a caller claims a board they hold A1 on for a meeting that actually
 * belongs to a different board.
 *
 * Same connection discipline as every other router test in this phase:
 * every case that touches tenancy or RLS runs through `connectAsAppRole`,
 * never the owner connection `withTestDb` hands back.
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
import { toRows } from "../../../db/rows.js";

async function seedMeeting(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  opts: {
    title: string;
    scheduledDate: string;
    scheduledTime?: string | null;
    status?: string;
    meetingType?: string;
    agendaStatus?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (
        id, board_id, town_id, title, scheduled_date, scheduled_time, status,
        meeting_type, agenda_status
      )
      VALUES (
        ${id}, ${boardId}, ${town.townId}, ${opts.title}, ${opts.scheduledDate}::date,
        ${opts.scheduledTime ?? null}, ${opts.status ?? "draft"}::meeting_status,
        ${opts.meetingType ?? "regular"}, ${opts.agendaStatus ?? "draft"}
      )
    `);
  });
  return id;
}

async function readMeetingStatus(db: TestDb, town: TownFixture, meetingId: string) {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT status FROM meeting WHERE id = ${meetingId}`)
      .then((r) => toRows<{ status: string }>(r, (m) => new Error(m))),
  );
  return rows[0]?.status ?? null;
}

async function countMeetingsNamed(db: TestDb, town: TownFixture, title: string): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT count(*)::int AS count FROM meeting WHERE title = ${title}`)
      .then((r) => toRows<{ count: number }>(r, (m) => new Error(m))),
  );
  return rows[0]?.count ?? 0;
}

const VALID_INSERT_FIELDS = {
  title: "Select Board — Regular Meeting",
  meetingType: "regular" as const,
  scheduledDate: "2026-11-03",
  scheduledTime: "18:00",
  location: null,
};

describe("meeting.byTown", () => {
  it("lists every non-cancelled meeting in the caller's town, oldest first, with the board's name", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        await seedMeeting(db, town, town.boardId, {
          title: "Later",
          scheduledDate: "2026-12-01",
        });
        await seedMeeting(db, town, town.otherBoardId, {
          title: "Earlier",
          scheduledDate: "2026-01-01",
        });
        await seedMeeting(db, town, town.boardId, {
          title: "Cancelled",
          scheduledDate: "2026-01-15",
          status: "cancelled",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.meeting.byTown();
        expect(rows.map((r) => r.title)).toEqual(["Earlier", "Later"]);
        expect(rows[0]?.board_name).toBe("Planning Board");
      } finally {
        await app.end();
      }
    });
  });

  it("does not return another town's meetings", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        await seedMeeting(db, theirs, theirs.boardId, {
          title: "Not Mine",
          scheduledDate: "2026-01-01",
        });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        expect(await caller.meeting.byTown()).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("meeting.byBoard", () => {
  it("lists every meeting on the board, most-recent-first, INCLUDING cancelled ones", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        await seedMeeting(db, town, town.boardId, { title: "Older", scheduledDate: "2026-01-01" });
        await seedMeeting(db, town, town.boardId, {
          title: "Newer",
          scheduledDate: "2026-06-01",
          status: "cancelled",
        });
        await seedMeeting(db, town, town.otherBoardId, {
          title: "Other Board",
          scheduledDate: "2026-12-01",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.meeting.byBoard({ boardId: town.boardId });
        expect(rows.map((r) => r.title)).toEqual(["Newer", "Older"]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.byBoard({ boardId: theirs.boardId }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("meeting.detail", () => {
  it("returns a meeting of the caller's own town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "Annual Meeting",
          scheduledDate: "2026-03-14",
          scheduledTime: "19:00",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const row = await caller.meeting.detail({ meetingId });
        expect(row.title).toBe("Annual Meeting");
        expect(row.board_id).toBe(town.boardId);
        expect(row.scheduled_time).toBe("19:00:00");
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
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId, {
          title: "Not Mine",
          scheduledDate: "2026-01-01",
        });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() => caller.meeting.detail({ meetingId: theirMeeting }));
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

        const err = await expectTrpcError(() => caller.meeting.detail({ meetingId: randomUUID() }));
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("meeting.insert", () => {
  it("refuses a caller with no A1 on this board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.insert({ ...VALID_INSERT_FIELDS, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await countMeetingsNamed(db, town, VALID_INSERT_FIELDS.title)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("lets a caller holding A1 GLOBALLY create a meeting on any board (the additive case)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: ["A1"] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const result = await caller.meeting.insert({
          ...VALID_INSERT_FIELDS,
          boardId: town.otherBoardId,
        });
        expect(result.id).toBeTruthy();
        expect(await countMeetingsNamed(db, town, VALID_INSERT_FIELDS.title)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The case the whole board-scoped mechanism exists for, per the task
   * brief: a global grant REVOKED on one board via `board_overrides` must
   * refuse on that board and still allow on another. Before this task
   * nothing in the product exercised this path through a real procedure.
   */
  it("honours a REVOKING board override: refused on the barred board, allowed on the other", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: ["A1"],
          boardOverrides: [{ boardId: town.boardId, permissions: { A1: false } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const barred = await expectTrpcError(() =>
          caller.meeting.insert({
            ...VALID_INSERT_FIELDS,
            title: "Barred Board Meeting",
            boardId: town.boardId,
          }),
        );
        expect(barred.code).toBe("FORBIDDEN");
        expect(await countMeetingsNamed(db, town, "Barred Board Meeting")).toBe(0);

        const result = await caller.meeting.insert({
          ...VALID_INSERT_FIELDS,
          title: "Other Board Meeting",
          boardId: town.otherBoardId,
        });
        expect(result.id).toBeTruthy();
      } finally {
        await app.end();
      }
    });
  });

  /**
   * And the mirror, which is what the two shipped `designated_boards`
   * templates actually produce: nothing globally, granted on one board only.
   */
  it("honours a GRANTING board override: allowed on the designated board, refused elsewhere", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A1: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.meeting.insert({
          ...VALID_INSERT_FIELDS,
          boardId: town.boardId,
        });
        expect(result.id).toBeTruthy();

        const err = await expectTrpcError(() =>
          caller.meeting.insert({
            ...VALID_INSERT_FIELDS,
            title: "Ungranted Board Meeting",
            boardId: town.otherBoardId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The reorder pin: `boardId` is a REAL uuid the guard reads and would
   * authorize on — this is not "malformed request", it is "one field among
   * several fails validation" (`scheduledTime` here), the realistic case a
   * clerk hits by fat-fingering a form. With `.use()` correctly declared
   * before `.input()`, the guard must run first and answer FORBIDDEN before
   * the parser ever gets a chance to answer BAD_REQUEST. Moving `.use()`
   * after `.input()` in `meeting.ts` turns this red with BAD_REQUEST.
   */
  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.insert({
            ...VALID_INSERT_FIELDS,
            boardId: town.boardId,
            scheduledTime: "not-a-time",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Complement of the reorder pin: proves it is not vacuous. Valid input
   * that is merely unauthorized ALSO answers FORBIDDEN, so the pin above is
   * distinguishing guard-order, not just "any error happens to be FORBIDDEN".
   */
  it("proves the reorder pin is not vacuous: valid-but-unauthorized input also answers FORBIDDEN", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.insert({ ...VALID_INSERT_FIELDS, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Hazard 3 / the FK-bypasses-RLS pattern, reproduced a fourth time.
   * `board_id` is a client-supplied foreign key on a NEW `meeting` row;
   * without `assertBoardExists`, `meeting_board_id_fkey` alone would let
   * this succeed, because FK enforcement bypasses row security. Verified by
   * mutation during this task: with the `assertBoardExists` call removed
   * from `meeting.ts`, this exact case creates a meeting in Newcastle whose
   * `board_id` names one of Bristol's boards — see the task report.
   */
  it("answers NOT_FOUND for a boardId belonging to another town, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.meeting.insert({ ...VALID_INSERT_FIELDS, boardId: theirs.boardId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countMeetingsNamed(db, theirs, VALID_INSERT_FIELDS.title)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("creates a draft meeting with created_by from the caller's own session, never from input", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.meeting.insert({
          ...VALID_INSERT_FIELDS,
          boardId: town.boardId,
        });

        const rows = await inTown(db, town, (tx) =>
          tx
            .execute(
              sql`SELECT status, agenda_status, created_by FROM meeting WHERE id = ${result.id}`,
            )
            .then((r) =>
              toRows<{ status: string; agenda_status: string; created_by: string }>(
                r,
                (m) => new Error(m),
              ),
            ),
        );
        expect(rows[0]?.status).toBe("draft");
        expect(rows[0]?.agenda_status).toBe("draft");
        expect(rows[0]?.created_by).toBe(admin.userAccountId);
      } finally {
        await app.end();
      }
    });
  });
});

describe("meeting.cancel", () => {
  it("refuses a caller with no A1 or M1 on this board, and cancels nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Cancel",
          scheduledDate: "2026-05-01",
        });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.cancel({ meetingId, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMeetingStatus(db, town, meetingId)).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  it("lets a caller holding A1 on this board cancel the meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Cancel",
          scheduledDate: "2026-05-01",
        });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A1"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.meeting.cancel({ meetingId, boardId: town.boardId });
        expect(result.id).toBe(meetingId);
        expect(await readMeetingStatus(db, town, meetingId)).toBe("cancelled");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The M1 fallback `assertCanUpdateMeeting` carries and a straight A1-only
   * guard would not: a caller holding ONLY `start_run_meeting` for this
   * board — no A1 anywhere — can still cancel. This is exactly why `cancel`
   * does not reuse `requireBoardPermission("A1", ...)` verbatim — see
   * `meeting.ts`'s own header.
   */
  it("lets a caller holding ONLY M1 (start_run_meeting) on this board cancel too", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Cancel",
          scheduledDate: "2026-05-01",
        });
        const officer = await seedActor(db, town, { role: "staff", global: ["M1"] });
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const result = await caller.meeting.cancel({ meetingId, boardId: town.boardId });
        expect(result.id).toBe(meetingId);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The board-scoped mechanism's central case, on the update side.
   */
  it("honours a REVOKING board override: refused on the barred board, allowed for the same actor on another", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const barredMeeting = await seedMeeting(db, town, town.boardId, {
          title: "Barred Board Meeting",
          scheduledDate: "2026-05-01",
        });
        const otherMeeting = await seedMeeting(db, town, town.otherBoardId, {
          title: "Other Board Meeting",
          scheduledDate: "2026-05-02",
        });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: ["A1"],
          boardOverrides: [{ boardId: town.boardId, permissions: { A1: false } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.meeting.cancel({ meetingId: barredMeeting, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMeetingStatus(db, town, barredMeeting)).toBe("draft");

        const result = await caller.meeting.cancel({
          meetingId: otherMeeting,
          boardId: town.otherBoardId,
        });
        expect(result.id).toBe(otherMeeting);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The board-MISMATCH case `meeting.ts`'s header names, unique to this
   * procedure: the caller holds A1 on THEIR board and claims it for a
   * meeting that actually belongs to a DIFFERENT board they hold nothing
   * on. `meeting_tenant_isolation` has no board predicate, so the row is
   * visible; only the application-level re-check (against the row's REAL
   * `board_id`, not the client-claimed one the middleware guard used)
   * stands between this and a cross-board privilege escalation. Without the
   * resolver's `assertCanUpdateMeeting` re-check, this case would succeed —
   * verified by mutation during this task (see the report) by removing that
   * line and watching the meeting actually get cancelled.
   */
  it("refuses when the claimed boardId does not match the meeting's real board, and cancels nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId, {
          title: "Not This Clerk's Board",
          scheduledDate: "2026-05-01",
        });
        // A1 on `boardId` only — nothing on `otherBoardId`, where the
        // meeting actually lives.
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A1: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.meeting.cancel({ meetingId: theirMeeting, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMeetingStatus(db, town, theirMeeting)).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The reorder pin, this procedure's shape of it: `boardId` stays a REAL
   * uuid the guard reads and authorizes on; `meetingId` is the field that
   * fails `.input()`'s `.uuid()` check. A refused caller (no A1/M1 on this
   * board) must still answer FORBIDDEN, not BAD_REQUEST — the guard has to
   * run before the parser gets a chance to reject `meetingId`.
   */
  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.cancel({ meetingId: "not-a-uuid", boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("proves the reorder pin is not vacuous: valid-but-unauthorized input also answers FORBIDDEN", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Cancel",
          scheduledDate: "2026-05-01",
        });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.cancel({ meetingId, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meetingId in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId, {
          title: "Not Mine",
          scheduledDate: "2026-01-01",
        });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.meeting.cancel({ meetingId: theirMeeting, boardId: mine.boardId }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});
