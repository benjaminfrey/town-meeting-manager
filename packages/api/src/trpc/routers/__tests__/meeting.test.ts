/**
 * `meeting.byTown` / `.byBoard` / `.detail` / `.insert` / `.cancel` /
 * `.updateStatus` / `.publishAgenda`.
 *
 * `publishAgenda` is Phase E wave 4, Task 2's — the first procedure in this
 * codebase to consult A5 at all. Its own describe block at the bottom of this
 * file carries the reasoning; everything below is wave 3's.
 *
 * `insert`/`cancel`/`updateStatus` are this codebase's first REAL call sites
 * for the board-scoped half of conventions item 2 (`requireBoardPermission`/
 * `requireBoardActor`/`BoardScope`) — every prior wave's write was an
 * actor-only admin gate. The four things wave 3's task brief asks to prove
 * by mutation, each with its own test below, for `insert` and (where the
 * shape differs) `cancel`/`updateStatus` too:
 *
 *   1. A caller WITH A1 (or, for `cancel`/`updateStatus`, A1 OR M1 OR admin)
 *      on a board succeeds; WITHOUT it, FORBIDDEN.
 *   2. A caller with a REVOKING board override is refused on that board and
 *      still allowed on another — the case the whole board-scoped mechanism
 *      exists for, and (per the task brief) never exercised by a real
 *      procedure before this task.
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
 * `cancel`/`updateStatus` carry a fifth kind of test neither `insert` nor
 * any prior router needed: the board-MISMATCH case `trpc.ts`'s
 * `requireBoardActor` doc comment names — a caller claims a board they hold
 * A1 on for a meeting that actually belongs to a different board.
 *
 * Both also carry a sixth, and its actual shape is worth stating precisely
 * because an earlier draft of this comment got it wrong: deleting the
 * `.use(requireBoardActor(...))` guard ENTIRELY does NOT leave
 * `assertMatchesAuthorizedBoard` behaving as an independent re-check that
 * still separates authorized from unauthorized callers. It leaves
 * `ctx.authorizedBoardId` unset for EVERY call, and `assertMatchesAuthorizedBoard`
 * refuses to proceed at all when that happens (a plain `Error`, "this
 * procedure's guard must be requireBoardActor" — a wiring-bug signal, not an
 * `AuthorizationError`) — so deleting the guard fails EVERY test in this
 * describe block, the successful ones included, not just the refusal ones.
 * That is arguably a STRONGER property (a missing guard cannot silently let
 * an authorized call through by accident, the way a same-permission
 * resolver-side re-check might if it were ever miscoded), but it is a
 * DIFFERENT property than "the resolver alone still tells authorized and
 * unauthorized callers apart," and this file used to claim the latter.
 * Verified directly: see "answers a wiring-bug error, not a silent
 * authorization gap, when the guard never ran at all" below.
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

async function readAgendaStatus(db: TestDb, town: TownFixture, meetingId: string) {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT agenda_status FROM meeting WHERE id = ${meetingId}`)
      .then((r) => toRows<{ agenda_status: string }>(r, (m) => new Error(m))),
  );
  return rows[0]?.agenda_status ?? null;
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
        // Wave 4, Task 3: the kanban builds a Date from this value with
        // `+ "T00:00:00"`, so its bare-YYYY-MM-DD shape is load-bearing.
        expect(rows.map((r) => r.scheduled_date)).toEqual(["2026-01-01", "2026-12-01"]);
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
        // Wave 4, Task 3: `boards.$boardId.meetings.tsx` builds a Date from
        // this value the same way.
        expect(rows.map((r) => r.scheduled_date)).toEqual(["2026-06-01", "2026-01-01"]);
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

  // Wave 4, Task 3. `scheduled_date` is a `date` column, declared `string`
  // here and NOT cast `::text` — see this router's header for the probe that
  // settled why no cast is needed on the drizzle path. This pins the property
  // the declaration depends on, by `typeof` and not only by value, because a
  // Date would compare loosely in a template literal and render convincingly.
  // The last assertion is the shape every consumer actually needs: a bare
  // `YYYY-MM-DD` that `+ "T00:00:00"` turns into a valid local date.
  it("returns scheduled_date as a plain YYYY-MM-DD string, not a Date", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "Annual Meeting",
          scheduledDate: "2026-03-14",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const row = await caller.meeting.detail({ meetingId });
        expect(row.scheduled_date).toBe("2026-03-14");
        expect(typeof row.scheduled_date).toBe("string");
        // The shape every consumer actually depends on.
        expect(new Date(row.scheduled_date + "T00:00:00").getTime()).not.toBeNaN();
      } finally {
        await app.end();
      }
    });
  });

  // Wave 4, Task 3 added these four for `routes/meetings.$meetingId.agenda.tsx`
  // — the buttons that switch between "Generate" and "Regenerate" read them.
  it("returns the agenda-packet and meeting-notice document columns", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "Annual Meeting",
          scheduledDate: "2026-03-14",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const before = await caller.meeting.detail({ meetingId });
        expect(before.agenda_packet_url).toBeNull();
        expect(before.agenda_packet_generated_at).toBeNull();
        expect(before.meeting_notice_url).toBeNull();
        expect(before.meeting_notice_generated_at).toBeNull();

        await inTown(db, town, async (tx) => {
          await tx.execute(sql`
            UPDATE meeting
            SET agenda_packet_url = 'https://example.test/packet.pdf',
                agenda_packet_generated_at = now(),
                meeting_notice_url = 'https://example.test/notice.pdf',
                meeting_notice_generated_at = now()
            WHERE id = ${meetingId}
          `);
        });

        const after = await caller.meeting.detail({ meetingId });
        expect(after.agenda_packet_url).toBe("https://example.test/packet.pdf");
        expect(after.meeting_notice_url).toBe("https://example.test/notice.pdf");
        expect(after.agenda_packet_generated_at).not.toBeNull();
        expect(after.meeting_notice_generated_at).not.toBeNull();
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
   * The board-MISMATCH case `trpc.ts`'s `requireBoardActor` doc comment
   * names, unique to a row-targeted board-scoped write like this one: the
   * caller holds A1 on THEIR board and claims it for a meeting that
   * actually belongs to a DIFFERENT board they hold nothing on.
   * `meeting_tenant_isolation` has no board predicate, so the row is
   * visible; only the resolver's `assertMatchesAuthorizedBoard(ctx,
   * meeting.board_id)` call — comparing the board the guard authorized
   * against the row's REAL board — stands between this and a cross-board
   * privilege escalation. Without that call, this case would succeed —
   * verified by mutation during this task (see the report) by removing it
   * and watching the meeting actually get cancelled.
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

describe("meeting.updateStatus", () => {
  it("refuses a caller with no A1 or M1 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Notice",
          scheduledDate: "2026-05-01",
        });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.updateStatus({ meetingId, boardId: town.boardId, status: "noticed" }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMeetingStatus(db, town, meetingId)).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  it("lets a caller holding A1 on this board change the status", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Notice",
          scheduledDate: "2026-05-01",
        });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A1"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.meeting.updateStatus({
          meetingId,
          boardId: town.boardId,
          status: "noticed",
        });
        expect(result.status).toBe("noticed");
        expect(await readMeetingStatus(db, town, meetingId)).toBe("noticed");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The M1 fallback, identical reason `cancel` needs it: a presiding
   * officer holding only `start_run_meeting` — no A1 — can still move a
   * meeting's status (e.g. opening one for attendance).
   */
  it("lets a caller holding ONLY M1 (start_run_meeting) on this board change the status too", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Open",
          scheduledDate: "2026-05-01",
          status: "noticed",
        });
        const officer = await seedActor(db, town, { role: "staff", global: ["M1"] });
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        const result = await caller.meeting.updateStatus({
          meetingId,
          boardId: town.boardId,
          status: "open",
        });
        expect(result.status).toBe("open");
      } finally {
        await app.end();
      }
    });
  });

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
          caller.meeting.updateStatus({
            meetingId: barredMeeting,
            boardId: town.boardId,
            status: "noticed",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMeetingStatus(db, town, barredMeeting)).toBe("draft");

        const result = await caller.meeting.updateStatus({
          meetingId: otherMeeting,
          boardId: town.otherBoardId,
          status: "noticed",
        });
        expect(result.status).toBe("noticed");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The board-MISMATCH case, identical shape to `cancel`'s own — see that
   * describe block's own comment, and `trpc.ts`'s `requireBoardActor` doc
   * comment for the general rule.
   */
  it("refuses when the claimed boardId does not match the meeting's real board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId, {
          title: "Not This Clerk's Board",
          scheduledDate: "2026-05-01",
        });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A1: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.meeting.updateStatus({
            meetingId: theirMeeting,
            boardId: town.boardId,
            status: "noticed",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readMeetingStatus(db, town, theirMeeting)).toBe("draft");
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
          caller.meeting.updateStatus({
            meetingId: "not-a-uuid",
            boardId: town.boardId,
            status: "noticed",
          }),
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
          title: "To Notice",
          scheduledDate: "2026-05-01",
        });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.updateStatus({ meetingId, boardId: town.boardId, status: "noticed" }),
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
          caller.meeting.updateStatus({
            meetingId: theirMeeting,
            boardId: mine.boardId,
            status: "noticed",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });

  it("rejects 'cancelled' as a status value — cancel is the dedicated procedure for that", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "Not Via updateStatus",
          scheduledDate: "2026-05-01",
        });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await expect(
          caller.meeting.updateStatus({
            meetingId,
            boardId: town.boardId,
            // @ts-expect-error — "cancelled" is deliberately outside the
            // zod enum; this proves it at RUNTIME too (BAD_REQUEST), not
            // just at the type level.
            status: "cancelled",
          }),
        ).rejects.toThrow();
      } finally {
        await app.end();
      }
    });
  });
});

/**
 * `meeting.publishAgenda` — Phase E wave 4, Task 2.
 *
 * The code under test is the FIRST thing in `packages/api` to consult A5:
 * before this task `grep -rn "A5" packages/api/src` matched only two test
 * fixtures, so `PublishAgendaDialog`'s write was governed by nothing but
 * `meeting_tenant_isolation` — any signed-in member of the town, any role,
 * could declare any board's agenda the public record.
 *
 * Two properties these tests establish that no other `meeting` test does:
 *
 *   - A5 is NOT A1 and NOT A2. A clerk who may schedule meetings, or edit
 *     this agenda's items, is still refused here unless the matrix grants
 *     A5 as well — otherwise the new guard would be decorative, satisfied by
 *     any permission the same account is likely to already hold.
 *   - The refusal is FORBIDDEN even when the rest of the input does not
 *     parse (the reorder pin), which is what proves `.use()` sits before
 *     `.input()`.
 *
 * Deletion pin, run and recorded rather than asserted: with the
 * `.use(requireBoardPermission("A5", ...))` line removed, this block goes
 * from 8 green to 6 red — the two NOT_FOUND/`assertMeetingExists`-style
 * cases survive (they are answered before the mismatch defence), every other
 * case fails, and the successful ones fail too, with
 * `assertMatchesAuthorizedBoard`'s wiring-bug `Error` rather than a refusal.
 * Same shape `agenda-item.test.ts`'s header records for `update`.
 */
describe("meeting.publishAgenda", () => {
  it("lets a caller holding A5 on this board publish the agenda", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "To Publish",
          scheduledDate: "2026-05-01",
        });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A5"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.meeting.publishAgenda({ meetingId, boardId: town.boardId });
        expect(result.agenda_status).toBe("published");
        expect(await readAgendaStatus(db, town, meetingId)).toBe("published");
        // `status` is a different column with its own procedure — this write
        // must not touch it. See the router header.
        expect(await readMeetingStatus(db, town, meetingId)).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no A5 on this board, and leaves the agenda a draft", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "Not Published",
          scheduledDate: "2026-05-01",
        });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.meeting.publishAgenda({ meetingId, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("A5");
        expect(await readAgendaStatus(db, town, meetingId)).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * A5 is its own action. A clerk holding A1 (schedule meetings) and A2
   * (edit the agenda) — the two codes the account that BUILDS an agenda
   * almost always has — is still refused, because publishing is a separate
   * grant in the matrix. Without this test, wiring the guard to A1 or A2
   * instead would pass every other case in this block.
   */
  it("refuses a caller holding A1 and A2 but not A5 — publishing is its own action", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, {
          title: "Built But Not Publishable",
          scheduledDate: "2026-05-01",
        });
        const builder = await seedActor(db, town, { role: "staff", global: ["A1", "A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, builder));

        const err = await expectTrpcError(() =>
          caller.meeting.publishAgenda({ meetingId, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readAgendaStatus(db, town, meetingId)).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  it("honours a REVOKING board override: refused on the barred board, allowed for the same actor on another", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const barred = await seedMeeting(db, town, town.boardId, {
          title: "Barred Board Meeting",
          scheduledDate: "2026-05-01",
        });
        const other = await seedMeeting(db, town, town.otherBoardId, {
          title: "Other Board Meeting",
          scheduledDate: "2026-05-02",
        });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: ["A5"],
          boardOverrides: [{ boardId: town.boardId, permissions: { A5: false } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.meeting.publishAgenda({ meetingId: barred, boardId: town.boardId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readAgendaStatus(db, town, barred)).toBe("draft");

        const result = await caller.meeting.publishAgenda({
          meetingId: other,
          boardId: town.otherBoardId,
        });
        expect(result.agenda_status).toBe("published");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The mismatch defence, identical shape to `cancel`'s and
   * `updateStatus`'s: the guard authorizes the CLAIMED board, the write
   * targets a row named by `meetingId`, and `meeting_tenant_isolation` has
   * no board predicate — so any town member can already learn any meeting's
   * true board and name it here.
   */
  it("refuses when the claimed boardId does not match the meeting's real board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId, {
          title: "Not This Clerk's Board",
          scheduledDate: "2026-05-01",
        });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A5: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.meeting.publishAgenda({
            meetingId: theirMeeting,
            boardId: town.boardId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readAgendaStatus(db, town, theirMeeting)).toBe("draft");
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
          caller.meeting.publishAgenda({ meetingId: "not-a-uuid", boardId: town.boardId }),
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
          caller.meeting.publishAgenda({ meetingId: theirMeeting, boardId: mine.boardId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readAgendaStatus(db, theirs, theirMeeting)).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meetingId that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.meeting.publishAgenda({ meetingId: randomUUID(), boardId: town.boardId }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});
