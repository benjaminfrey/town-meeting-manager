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

/** Every column `board.insert`/`board.update` can touch, plus the ones they hardcode or omit. */
interface RawBoardRow {
  name: string;
  board_type: string;
  elected_or_appointed: string | null;
  member_count: number | null;
  election_method: string | null;
  officer_election_method: string | null;
  district_based: boolean;
  staggered_terms: boolean;
  is_governing_board: boolean;
  meeting_formality_override: string | null;
  minutes_style_override: string | null;
  quorum_type: string | null;
  quorum_value: number | null;
  motion_display_format: string | null;
  archived_at: string | null;
}

async function readBoard(
  db: TestDb,
  town: TownFixture,
  boardId: string,
): Promise<RawBoardRow | null> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`
        SELECT name, board_type, elected_or_appointed, member_count, election_method,
          officer_election_method, district_based, staggered_terms, is_governing_board,
          meeting_formality_override, minutes_style_override, quorum_type, quorum_value,
          motion_display_format, archived_at
        FROM board WHERE id = ${boardId}
      `,
      )
      .then((r) => toRows<RawBoardRow>(r, (m) => new Error(m))),
  );
  return rows[0] ?? null;
}

async function countBoardsNamed(db: TestDb, town: TownFixture, name: string): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT count(*)::int AS count FROM board WHERE name = ${name}`)
      .then((r) => toRows<{ count: number }>(r, (m) => new Error(m))),
  );
  return rows[0]?.count ?? 0;
}

/** The full, valid `board.insert`/`board.update` payload shape, minus `name`. */
const VALID_BOARD_FIELDS = {
  elected_or_appointed: "elected" as const,
  member_count: 5,
  election_method: "at_large" as const,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: "simple_majority" as const,
  quorum_value: null,
  motion_display_format: "inline_narrative" as const,
};

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
        // `board_type` (wave 2, Task 2) — no longer excluded from this
        // procedure's column list; `seedBoard` sets no explicit value, so
        // this also pins the column's own DB default.
        expect(board.board_type).toBe("other");
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

  /**
   * `member_count` (Task 5, wave 1) — `ProgressChecklist`'s "N of M seats"
   * row sums this across every board in the town, so a missing or wrong
   * value there would under- or over-report how many seats exist without
   * ever producing a wrong-looking single-board number to notice. `seedBoard`
   * takes no `member_count` option (the column defaults to `NULL`), so this
   * sets it directly, and covers both the real-value and the NULL case in
   * the same assertion — `ProgressChecklist`'s `(b.member_count ?? 0)`
   * reduction is exactly what a NULL here is meant to exercise.
   */
  it("returns each board's member_count, including NULL for one never set", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const withSeats = await seedBoard(db, town, { name: "Budget Committee" });
        await inTown(db, town, (tx) =>
          tx.execute(sql`UPDATE board SET member_count = 5 WHERE id = ${withSeats}`),
        );
        const withoutSeats = await seedBoard(db, town, { name: "Recreation Committee" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.board.list();

        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get(withSeats)?.member_count).toBe(5);
        expect(byId.get(withoutSeats)?.member_count).toBeNull();
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

  /**
   * `elected_or_appointed`/`archived_at`/`is_governing_board`/
   * `active_member_count` — wave 2, Task 2, added for `routes/boards.tsx`
   * (see this procedure's own doc comment). `active_member_count` gets its
   * own assertion distinguishing active from archived board members —
   * exactly the `boardMember.memberCount`-vs-`board.stats.active_members`
   * distinction `board-member.test.ts`/this file already exercise elsewhere,
   * reproduced here for a town-wide scan instead of a single board.
   */
  it("returns each board's type/archived/governing columns and its ACTIVE member count only", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Conservation Commission" });
        await inTown(db, town, (tx) =>
          tx.execute(sql`
            UPDATE board SET elected_or_appointed = 'appointed', archived_at = now()
            WHERE id = ${boardId}
          `),
        );
        const p1 = await seedPerson(db, town, "Active One");
        const p2 = await seedPerson(db, town, "Former Member");
        await seedBoardMember(db, town, boardId, p1, "active");
        await seedBoardMember(db, town, boardId, p2, "archived");
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.board.list();

        const row = rows.find((r) => r.id === boardId);
        expect(row?.elected_or_appointed).toBe("appointed");
        expect(row?.archived_at).not.toBeNull();
        expect(row?.is_governing_board).toBe(false);
        expect(row?.active_member_count).toBe(1);
        expect(typeof row?.active_member_count).toBe("number");
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.listActive", () => {
  it("excludes an archived board, catching a dropped archived_at filter", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const active = await seedBoard(db, town, { name: "Active Committee" });
        const archived = await seedBoard(db, town, { name: "Archived Committee" });
        await inTown(db, town, (tx) =>
          tx.execute(sql`UPDATE board SET archived_at = now() WHERE id = ${archived}`),
        );
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.board.listActive();

        expect(rows.some((r) => r.id === active)).toBe(true);
        expect(rows.some((r) => r.id === archived)).toBe(false);
      } finally {
        await app.end();
      }
    });
  });

  it("orders the governing board first, then alphabetically", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        // seedTown's own two boards ("Select Board", "Planning Board") are
        // both non-governing, so alphabetical order alone would put
        // "Planning Board" first — this only catches a dropped
        // `is_governing_board DESC` if the governing board's name would
        // otherwise sort LAST.
        const governing = await seedBoard(db, town, { name: "Zoning Board of Appeals" });
        await inTown(db, town, (tx) =>
          tx.execute(sql`UPDATE board SET is_governing_board = true WHERE id = ${governing}`),
        );
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.board.listActive();

        expect(rows[0]?.id).toBe(governing);
        expect(rows.slice(1).map((r) => r.name)).toEqual(["Planning Board", "Select Board"]);
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
        const rows = await caller.board.listActive();

        expect(rows.some((r) => r.name === "Their Committee")).toBe(false);
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.insert", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.board.insert({ name: "New Committee", ...VALID_BOARD_FIELDS }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await countBoardsNamed(db, town, "New Committee")).toBe(0);
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

        // `name: ""` fails `.min(2)` at parse time.
        const err = await expectTrpcError(() =>
          caller.board.insert({ name: "", ...VALID_BOARD_FIELDS }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator create a board, hardcoding the fields the dialog never sends", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.board.insert({
          name: "Harbor Committee",
          elected_or_appointed: "appointed",
          member_count: 7,
          election_method: "role_titled",
          meeting_formality_override: "formal",
          minutes_style_override: "narrative",
          quorum_type: "fixed_number",
          quorum_value: 4,
          motion_display_format: "block_format",
        });
        expect(result.name).toBe("Harbor Committee");

        const row = await readBoard(db, town, result.id);
        expect(row).toMatchObject({
          name: "Harbor Committee",
          elected_or_appointed: "appointed",
          member_count: 7,
          election_method: "role_titled",
          meeting_formality_override: "formal",
          minutes_style_override: "narrative",
          quorum_type: "fixed_number",
          quorum_value: 4,
          motion_display_format: "block_format",
          // Hardcoded, never client-supplied — see `insert`'s own doc
          // comment for why each is set (or left to its DB default) rather
          // than exposed as input.
          board_type: "other",
          officer_election_method: "vote_of_board",
          district_based: false,
          staggered_terms: false,
          is_governing_board: false,
        });
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for a name already used in the caller's town, and writes nothing new", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        // seedTown already creates a board named "Select Board".
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.board.insert({ name: "Select Board", ...VALID_BOARD_FIELDS }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await countBoardsNamed(db, town, "Select Board")).toBe(1);
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.update", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Recreation Committee" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.board.update({ boardId, name: "Renamed", ...VALID_BOARD_FIELDS }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const row = await readBoard(db, town, boardId);
        expect(row?.name).toBe("Recreation Committee");
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

        // `boardId` fails `.uuid()` at parse time.
        const err = await expectTrpcError(() =>
          caller.board.update({ boardId: "not-a-uuid", name: "Renamed", ...VALID_BOARD_FIELDS }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator update a board's configuration", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Recreation Committee" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.board.update({
          boardId,
          name: "Parks & Recreation Committee",
          elected_or_appointed: "appointed",
          member_count: 9,
          election_method: "role_titled",
          meeting_formality_override: "semi_formal",
          minutes_style_override: "action",
          quorum_type: "two_thirds",
          quorum_value: null,
          motion_display_format: "block_format",
        });
        expect(result.name).toBe("Parks & Recreation Committee");

        const row = await readBoard(db, town, boardId);
        expect(row).toMatchObject({
          name: "Parks & Recreation Committee",
          member_count: 9,
          election_method: "role_titled",
          meeting_formality_override: "semi_formal",
          minutes_style_override: "action",
          quorum_type: "two_thirds",
          motion_display_format: "block_format",
        });
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board in another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.board.update({ boardId: foreign, name: "Hijacked", ...VALID_BOARD_FIELDS }),
        );
        expect(err.code).toBe("NOT_FOUND");

        const row = await readBoard(db, theirs, foreign);
        expect(row?.name).toBe("Their Board");
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when renaming to a name already used in the same town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Recreation Committee" });
        // seedTown already creates a board named "Select Board".
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.board.update({ boardId, name: "Select Board", ...VALID_BOARD_FIELDS }),
        );
        expect(err.code).toBe("CONFLICT");

        const row = await readBoard(db, town, boardId);
        expect(row?.name).toBe("Recreation Committee");
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

// ─── Wave 6, Task 5: the three writes ArchiveBoardDialog / ────────────────
// NoticeTemplateEditor / MinutesWorkflowEditor used to make raw.

/** The five columns `board.updateMinutesWorkflow` writes. */
interface MinutesWorkflowRow {
  minutes_consent_agenda: boolean;
  minutes_requires_second: boolean;
  r4_board_member_default: boolean;
  audio_retention_policy_override: string | null;
  auto_publish_on_approval_override: boolean | null;
}

async function readMinutesWorkflow(
  db: TestDb,
  town: TownFixture,
  boardId: string,
): Promise<MinutesWorkflowRow | null> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`
        SELECT minutes_consent_agenda, minutes_requires_second, r4_board_member_default,
          audio_retention_policy_override, auto_publish_on_approval_override
        FROM board WHERE id = ${boardId}
      `,
      )
      .then((r) => toRows<MinutesWorkflowRow>(r, (m) => new Error(m))),
  );
  return rows[0] ?? null;
}

async function memberStatuses(db: TestDb, town: TownFixture, boardId: string): Promise<string[]> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT status::text AS status FROM board_member WHERE board_id = ${boardId} ORDER BY status`,
      )
      .then((r) => toRows<{ status: string }>(r, (m) => new Error(m))),
  );
  return rows.map((r) => r.status);
}

const BLOCKS = [
  { id: "b1", type: "letterhead" as const, order: 0, config: { showSeal: true } },
  { id: "b2", type: "rich_text" as const, order: 1, config: { content: "<p>Hello</p>" } },
];

describe("board.updateNoticeTemplate", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Shellfish Commission" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.board.updateNoticeTemplate({ boardId, blocks: BLOCKS }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await readNoticeTemplate(db, town, boardId)).toBeNull();
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

        const err = await expectTrpcError(() =>
          caller.board.updateNoticeTemplate({ boardId: "not-a-uuid", blocks: BLOCKS }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator replace the board's blocks, and can empty them", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Shellfish Commission" });
        await setNoticeTemplate(db, town, boardId, [{ id: "old", type: "spacer" }]);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.board.updateNoticeTemplate({ boardId, blocks: BLOCKS });
        expect(await readNoticeTemplate(db, town, boardId)).toEqual(BLOCKS);

        // An empty array is a real value the editor can send (remove every
        // block, then save) and must not be confused with "leave it alone".
        await caller.board.updateNoticeTemplate({ boardId, blocks: [] });
        expect(await readNoticeTemplate(db, town, boardId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board in another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.board.updateNoticeTemplate({ boardId: foreign, blocks: BLOCKS }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readNoticeTemplate(db, theirs, foreign)).toBeNull();
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.updateMinutesWorkflow", () => {
  const PAYLOAD = {
    minutes_consent_agenda: true,
    minutes_requires_second: false,
    r4_board_member_default: false,
    audio_retention_policy_override: "retain_90_days" as const,
    auto_publish_on_approval_override: true,
  };

  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Shellfish Commission" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.board.updateMinutesWorkflow({ boardId, ...PAYLOAD }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        // The column defaults from `0000_baseline.sql`, untouched.
        expect(await readMinutesWorkflow(db, town, boardId)).toEqual({
          minutes_consent_agenda: false,
          minutes_requires_second: true,
          r4_board_member_default: true,
          audio_retention_policy_override: null,
          auto_publish_on_approval_override: null,
        });
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

        const err = await expectTrpcError(() =>
          caller.board.updateMinutesWorkflow({ boardId: "not-a-uuid", ...PAYLOAD }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator save the five columns, and clear both overrides back to null", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Shellfish Commission" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.board.updateMinutesWorkflow({ boardId, ...PAYLOAD });
        expect(await readMinutesWorkflow(db, town, boardId)).toEqual({
          minutes_consent_agenda: true,
          minutes_requires_second: false,
          r4_board_member_default: false,
          audio_retention_policy_override: "retain_90_days",
          auto_publish_on_approval_override: true,
        });

        // "Inherit the town default" is `null`, and it must be reachable
        // again after an override has been set — the editor's Override
        // switches write exactly this.
        await caller.board.updateMinutesWorkflow({
          boardId,
          ...PAYLOAD,
          audio_retention_policy_override: null,
          auto_publish_on_approval_override: null,
        });
        const row = await readMinutesWorkflow(db, town, boardId);
        expect(row?.audio_retention_policy_override).toBeNull();
        expect(row?.auto_publish_on_approval_override).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board in another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.board.updateMinutesWorkflow({ boardId: foreign, ...PAYLOAD }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readMinutesWorkflow(db, theirs, foreign))?.minutes_consent_agenda).toBe(
          false,
        );
      } finally {
        await app.end();
      }
    });
  });
});

describe("board.archive", () => {
  it("refuses a caller who is not an administrator, and writes neither table", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Harbor Committee" });
        const personId = await seedPerson(db, town, "Seated Member");
        await seedBoardMember(db, town, boardId, personId);

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() => caller.board.archive({ boardId }));
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect((await readBoard(db, town, boardId))?.archived_at).toBeNull();
        expect(await memberStatuses(db, town, boardId)).toEqual(["active"]);
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

        const err = await expectTrpcError(() => caller.board.archive({ boardId: "not-a-uuid" }));
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("archives the board and every ACTIVE seat on it, in one call", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Harbor Committee" });
        const a = await seedPerson(db, town, "Active One");
        const b = await seedPerson(db, town, "Active Two");
        const c = await seedPerson(db, town, "Already Archived");
        await seedBoardMember(db, town, boardId, a);
        await seedBoardMember(db, town, boardId, b);
        await seedBoardMember(db, town, boardId, c, "archived");

        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const result = await caller.board.archive({ boardId });

        // Two, not three: the already-archived seat is not re-touched, which
        // is what `AND status = 'active'` buys.
        expect(result.archivedMembers).toBe(2);
        expect((await readBoard(db, town, boardId))?.archived_at).not.toBeNull();
        expect(await memberStatuses(db, town, boardId)).toEqual([
          "archived",
          "archived",
          "archived",
        ]);
      } finally {
        await app.end();
      }
    });
  });

  it("leaves another board's seats alone", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const archived = await seedBoard(db, town, { name: "Harbor Committee" });
        const untouched = await seedBoard(db, town, { name: "Road Committee" });
        const person = await seedPerson(db, town, "Sits On Both");
        await seedBoardMember(db, town, archived, person);
        await seedBoardMember(db, town, untouched, person);

        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.board.archive({ boardId: archived });

        expect(await memberStatuses(db, town, untouched)).toEqual(["active"]);
        expect((await readBoard(db, town, untouched))?.archived_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The failure-mode test: the reason this procedure exists.
   *
   * `ArchiveBoardDialog` made two untransacted round trips, so a failure
   * between them left a board archived with its members still `active`. This
   * forces a failure AFTER the `board` write and BEFORE the `board_member`
   * write commits, and asserts the board write did not survive it.
   *
   * The failure is injected on the real code path rather than a paraphrase
   * of it: a `BEFORE UPDATE` trigger on `board_member` that raises. The
   * `board` UPDATE has already run by the time it fires, inside the same
   * transaction. If `withTenant` were not a transaction — if this procedure
   * were two independently-committed round trips, the way the dialog was —
   * the board would stay archived and the last assertion here would fail.
   * That is the mutation to run when checking this test can go red: move the
   * `board_member` UPDATE into its own `ctx.withTenant` call, separate from
   * the `board` one, reproducing the shipped dialog's shape exactly.
   */
  it("rolls the board write back when the member write fails (the whole point of the procedure)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Harbor Committee" });
        const personId = await seedPerson(db, town, "Seated Member");
        await seedBoardMember(db, town, boardId, personId);

        // Owner connection (`client` is the raw postgres.js handle
        // `withTestDb` hands back): creating a trigger is DDL on a scratch
        // database, not a tenant write, so it does not go through
        // `connectAsAppRole`.
        await client.unsafe(`
          CREATE FUNCTION injected_board_member_failure() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'injected board_member failure'; END $$
        `);
        await client.unsafe(`
          CREATE TRIGGER board_member_injected_failure
          BEFORE UPDATE ON board_member
          FOR EACH ROW EXECUTE FUNCTION injected_board_member_failure()
        `);

        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await expect(caller.board.archive({ boardId })).rejects.toThrow();

        await client.unsafe(`DROP TRIGGER board_member_injected_failure ON board_member`);

        // Neither write survived.
        expect((await readBoard(db, town, boardId))?.archived_at).toBeNull();
        expect(await memberStatuses(db, town, boardId)).toEqual(["active"]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board in another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });
        const person = await seedPerson(db, theirs, "Their Member");
        await seedBoardMember(db, theirs, foreign, person);
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() => caller.board.archive({ boardId: foreign }));
        expect(err.code).toBe("NOT_FOUND");
        expect((await readBoard(db, theirs, foreign))?.archived_at).toBeNull();
        expect(await memberStatuses(db, theirs, foreign)).toEqual(["active"]);
      } finally {
        await app.end();
      }
    });
  });
});
