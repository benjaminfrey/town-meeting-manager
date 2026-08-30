/**
 * `board.detail` / `board.stats` / `board.recentMeetings` — read-only,
 * tenancy-only.
 *
 * Every case that touches tenancy runs through `connectAsAppRole`, wrapped
 * with `testDb()` into the same Drizzle handle `seedTown`/`seedActor`/
 * `contextFor` expect. The owner connection `withTestDb` hands back is a
 * superuser in every supported setup, so RLS does not bind it — a
 * cross-tenant assertion written on that handle would pass with RLS switched
 * off entirely and prove nothing. Step 6 of the task brief (see the report)
 * proved this test can actually go red, on `detail`; the same connection
 * discipline is used throughout this file.
 *
 * `stats` and `recentMeetings` are covered here specifically because a code
 * reviewer found the first version of this file shipped them untested: five
 * separate mutations to the router (dropping `AND status = 'active'`,
 * swapping the two correlated subqueries, `DESC` → `ASC`, changing the
 * default limit, and dropping the `::int` casts) all passed the suite as it
 * stood. Every test below was verified to catch its named mutation by making
 * the change, watching the test go red, and reverting — see the fix report.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import {
  seedTown,
  seedActor,
  contextFor,
  seedBoard,
  testDb,
  inTown,
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import { toRows } from "../../../db/rows.js";

/** A person with no user_account — board_member seats one directly. */
async function seedPerson(db: TestDb, town: TownFixture, name: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO person (id, town_id, name, email)
      VALUES (${id}, ${town.townId}, ${name}, ${`${id.slice(0, 8)}@example.test`})
    `);
  });
  return id;
}

async function seedBoardMember(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  personId: string,
  status: "active" | "archived" = "active",
): Promise<void> {
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status)
      VALUES (${randomUUID()}, ${personId}, ${boardId}, ${town.townId}, CURRENT_DATE,
              ${status}::board_member_status)
    `);
  });
}

async function seedMeeting(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  opts: { title: string; scheduledDate: string; status?: string },
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status)
      VALUES (${id}, ${boardId}, ${town.townId}, ${opts.title}, ${opts.scheduledDate}::date,
              ${opts.status ?? "draft"}::meeting_status)
    `);
  });
  return id;
}

async function setNoticeTemplate(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  blocks: unknown[] | null,
): Promise<void> {
  const json = blocks === null ? null : JSON.stringify(blocks);
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      UPDATE board SET notice_template_blocks = ${json}::jsonb WHERE id = ${boardId}
    `);
  });
}

async function readNoticeTemplate(
  db: TestDb,
  town: TownFixture,
  boardId: string,
): Promise<unknown[] | null> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT notice_template_blocks FROM board WHERE id = ${boardId}`)
      .then((r) => toRows<{ notice_template_blocks: unknown[] | null }>(r, (m) => new Error(m))),
  );
  return rows[0]?.notice_template_blocks ?? null;
}

describe("board.detail", () => {
  it("returns a board of the caller's own town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        // "Select Board" collides with the board `seedTown` already creates
        // for this town under `board_name_unique_per_town` — a name that
        // does not appear anywhere in this test would not have caught that.
        const boardId = await seedBoard(db, town, { name: "Historical Commission" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const board = await caller.board.detail({ boardId });

        expect(board.name).toBe("Historical Commission");
      } finally {
        await app.end();
      }
    });
  });

  it("cannot reach a board of another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db);
        const theirs = await seedTown(db, "Bristol");
        const actor = await seedActor(db, mine, { role: "staff", global: [] });
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        await expect(caller.board.detail({ boardId: foreign })).rejects.toThrow(/NOT_FOUND/);
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
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        await expect(caller.board.detail({ boardId: randomUUID() })).rejects.toThrow(/NOT_FOUND/);
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.stats", () => {
  it("counts only active board members, and does not confuse members with meetings", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const boardId = await seedBoard(db, town, { name: "Assessors" });

        // 2 active, 1 archived — catches a dropped `AND status = 'active'`,
        // which would report 3 instead of 2.
        const p1 = await seedPerson(db, town, "Active One");
        const p2 = await seedPerson(db, town, "Active Two");
        const p3 = await seedPerson(db, town, "Former Member");
        await seedBoardMember(db, town, boardId, p1, "active");
        await seedBoardMember(db, town, boardId, p2, "active");
        await seedBoardMember(db, town, boardId, p3, "archived");

        // 5 meetings — deliberately a different count from the 2 active
        // members, so a swap of the two correlated subqueries (members <->
        // meetings) is caught by the pair not matching, not just by one
        // field happening to be right.
        for (let i = 0; i < 5; i += 1) {
          await seedMeeting(db, town, boardId, {
            title: `Meeting ${i}`,
            scheduledDate: `2026-0${(i % 9) + 1}-01`,
          });
        }

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const stats = await caller.board.stats({ boardId });

        expect(stats).toEqual({ active_members: 2, meetings: 5 });
        // postgres.js returns count(*) as the STRING "2" without an explicit
        // ::int cast. `toEqual` above would already fail on that (`"2" !==
        // 2`), but this makes the reason explicit rather than leaving a
        // reader to infer it from a diff.
        expect(typeof stats.active_members).toBe("number");
        expect(typeof stats.meetings).toBe("number");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board of another town, matching detail's convention", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db);
        const theirs = await seedTown(db, "Bristol");
        const actor = await seedActor(db, mine, { role: "staff", global: [] });
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        await expect(caller.board.stats({ boardId: foreign })).rejects.toThrow(/NOT_FOUND/);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an id that never existed, rather than a convincing {0,0}", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        await expect(caller.board.stats({ boardId: randomUUID() })).rejects.toThrow(/NOT_FOUND/);
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.recentMeetings", () => {
  it("orders most-recent-first and caps at the default of 5", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const boardId = await seedBoard(db, town, { name: "Zoning Board" });

        // 6 meetings on distinct dates so DESC vs ASC and a changed default
        // limit are both distinguishable from the result.
        const dates = [
          "2026-01-05",
          "2026-02-10",
          "2026-03-15",
          "2026-04-20",
          "2026-05-25",
          "2026-06-30",
        ];
        for (const [i, date] of dates.entries()) {
          await seedMeeting(db, town, boardId, { title: `Meeting ${i}`, scheduledDate: date });
        }

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const meetings = await caller.board.recentMeetings({ boardId });

        expect(meetings).toHaveLength(5);
        expect(meetings.map((m) => m.scheduled_date)).toEqual([
          "2026-06-30",
          "2026-05-25",
          "2026-04-20",
          "2026-03-15",
          "2026-02-10",
        ]);
      } finally {
        await app.end();
      }
    });
  });

  it("excludes cancelled meetings, even the most recent one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const boardId = await seedBoard(db, town, { name: "Conservation Commission" });

        await seedMeeting(db, town, boardId, {
          title: "Regular Session",
          scheduledDate: "2026-01-10",
        });
        // Most recent by date, but cancelled — must not appear, and must not
        // bump the regular session out of a 5-row cap either.
        await seedMeeting(db, town, boardId, {
          title: "Cancelled Session",
          scheduledDate: "2026-06-01",
          status: "cancelled",
        });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const meetings = await caller.board.recentMeetings({ boardId });

        expect(meetings.map((m) => m.title)).toEqual(["Regular Session"]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board of another town, matching detail's convention", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db);
        const theirs = await seedTown(db, "Bristol");
        const actor = await seedActor(db, mine, { role: "staff", global: [] });
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        await expect(caller.board.recentMeetings({ boardId: foreign })).rejects.toThrow(
          /NOT_FOUND/,
        );
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.list", () => {
  it("returns every board in the caller's town, configured and not", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const configured = await seedBoard(db, town, { name: "Planning Board Extra" });
        await setNoticeTemplate(db, town, configured, [{ id: "b1", type: "letterhead" }]);
        const unconfigured = await seedBoard(db, town, { name: "Recreation Committee" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.board.list();

        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get(configured)?.notice_template_blocks).toEqual([
          { id: "b1", type: "letterhead" },
        ]);
        expect(byId.get(unconfigured)?.notice_template_blocks).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("does not return another town's boards", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        await seedBoard(db, theirs, { name: "Their Committee" });
        const actor = await seedActor(db, mine, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        const rows = await caller.board.list();

        expect(rows.some((r) => r.name === "Their Committee")).toBe(false);
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.copyNoticeTemplate", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const source = await seedBoard(db, town, { name: "Source Board" });
        await setNoticeTemplate(db, town, source, [{ id: "b1", type: "letterhead" }]);
        const target = await seedBoard(db, town, { name: "Target Board" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.board.copyNoticeTemplate({ sourceBoardId: source, targetBoardId: target }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await readNoticeTemplate(db, town, target)).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        // `sourceBoardId` fails `.uuid()` at parse time — see `town.test.ts`'s
        // identical pin for why this is the discriminator, not "input that
        // parses".
        const err = await expectTrpcError(() =>
          caller.board.copyNoticeTemplate({
            sourceBoardId: "not-a-uuid",
            targetBoardId: randomUUID(),
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator copy one board's notice template onto another", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const source = await seedBoard(db, town, { name: "Source Board" });
        const blocks = [
          { id: "b1", type: "letterhead" },
          { id: "b2", type: "rich_text" },
        ];
        await setNoticeTemplate(db, town, source, blocks);
        const target = await seedBoard(db, town, { name: "Target Board" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.board.copyNoticeTemplate({
          sourceBoardId: source,
          targetBoardId: target,
        });
        expect(result.notice_template_blocks).toEqual(blocks);

        expect(await readNoticeTemplate(db, town, target)).toEqual(blocks);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a source board in another town, and writes nothing to the target", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreignSource = await seedBoard(db, theirs, { name: "Their Board" });
        await setNoticeTemplate(db, theirs, foreignSource, [{ id: "b1", type: "letterhead" }]);
        const target = await seedBoard(db, mine, { name: "Target Board" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.board.copyNoticeTemplate({ sourceBoardId: foreignSource, targetBoardId: target }),
        );
        expect(err.code).toBe("NOT_FOUND");

        expect(await readNoticeTemplate(db, mine, target)).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a target board in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const source = await seedBoard(db, mine, { name: "Source Board" });
        await setNoticeTemplate(db, mine, source, [{ id: "b1", type: "letterhead" }]);
        const foreignTarget = await seedBoard(db, theirs, { name: "Their Board" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.board.copyNoticeTemplate({ sourceBoardId: source, targetBoardId: foreignTarget }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});
