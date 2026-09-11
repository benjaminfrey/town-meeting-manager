/**
 * The `agendaItem` router — one read (`countByMeeting`, wave 3), the agenda
 * builder's read (`byMeeting`) and all seven writes (wave 4, Task 1).
 *
 * ─── What this file has to prove that no previous router's tests did ──────
 *
 * `agenda_item` has no `board_id` column, so every write authorizes a
 * CLIENT-CLAIMED board in middleware and re-derives the row's real board by
 * JOINING through `meeting` inside the write's own transaction. The four
 * proofs this task's brief asks for, each by mutation:
 *
 *   1. A caller WITH A2 on that board succeeds; WITHOUT it, FORBIDDEN.
 *   2. A caller with a REVOKING board override for A2 is refused on that
 *      board and still allowed on another.
 *   3. A caller with A2 on board X, sending an `itemId` whose MEETING
 *      belongs to board Y, is refused — the mismatch case, two joins deep.
 *   4. Removing the existence check lets a cross-tenant write succeed;
 *      reproduced, then confirmed refused (the NOT_FOUND tests below).
 *
 * Plus one shape wave 3 never needed: `reorder` writes MANY rows, so a list
 * of ids spanning two meetings on two boards must be refused even though one
 * of the two boards IS the authorized one — "derive the distinct board set",
 * not "check the first row's board."
 *
 * ─── What deleting a guard does here, stated precisely ───────────────────
 *
 * The same thing `meeting.test.ts`'s header records for `cancel`: deleting a
 * `.use(requireBoardPermission("A2", …))` line does NOT leave the resolver's
 * `assertMatchesAuthorizedBoard` working as an independent re-check. It
 * leaves `ctx.authorizedBoardId` unset for EVERY call, and the helper refuses
 * to proceed at all (a plain `Error`, "this procedure's guard must be
 * requireBoardActor or requireBoardPermission" — a wiring-bug signal, not an
 * `AuthorizationError`), so nearly every test in that procedure's describe
 * block goes red, the successful ones included. That is a stronger property
 * than "the refusal tests go red", and a different one; it is recorded rather
 * than left for the next reader to re-derive.
 *
 * Measured on `update`, not assumed: deleting its guard turns **5 of 6** red.
 * The sixth — "answers NOT_FOUND for an itemId in another town" — stays green,
 * because the existence check inside `assertItemsOnAuthorizedBoard` runs
 * before the mismatch defence and answers NOT_FOUND on its own. "Every test"
 * would have been the tidier sentence and the wrong one.
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
import { toRows } from "../../../db/rows.js";

async function seedMeeting(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  opts: { title?: string; scheduledDate?: string; status?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status, meeting_type, agenda_status)
      VALUES (${id}, ${boardId}, ${town.townId}, ${opts.title ?? "Regular Meeting"},
              ${opts.scheduledDate ?? "2026-11-03"}::date,
              ${opts.status ?? "draft"}::meeting_status, 'regular', 'draft')
    `);
  });
  return id;
}

async function seedAgendaItem(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  opts: {
    title?: string;
    sectionType?: string;
    sortOrder?: number;
    parentItemId?: string | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO agenda_item (id, meeting_id, town_id, section_type, title, sort_order, parent_item_id)
      VALUES (${id}, ${meetingId}, ${town.townId}, ${opts.sectionType ?? "new_business"},
              ${opts.title ?? "Discuss the budget"}, ${opts.sortOrder ?? 0},
              ${opts.parentItemId ?? null})
    `);
  });
  return id;
}

async function seedExhibit(db: TestDb, town: TownFixture, agendaItemId: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO exhibit (id, agenda_item_id, town_id, title, file_storage_path, file_type)
      VALUES (${id}, ${agendaItemId}, ${town.townId}, 'Budget PDF', 'exhibits/budget.pdf',
              'application/pdf')
    `);
  });
  return id;
}

async function seedTemplate(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  sections: unknown[],
): Promise<string> {
  const id = randomUUID();
  const json = JSON.stringify(sections);
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO agenda_template (id, board_id, town_id, name, sections)
      VALUES (${id}, ${boardId}, ${town.townId}, ${`Template ${id.slice(0, 8)}`}, ${json}::jsonb)
    `);
  });
  return id;
}

async function seedMinutesDocument(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  boardId: string,
  opts: { status?: string; amendments?: unknown[] } = {},
): Promise<string> {
  const id = randomUUID();
  const amendments = JSON.stringify(opts.amendments ?? []);
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO minutes_document (id, meeting_id, town_id, board_id, status, amendments_history)
      VALUES (${id}, ${meetingId}, ${town.townId}, ${boardId},
              ${opts.status ?? "review"}::minutes_document_status, ${amendments}::jsonb)
    `);
  });
  return id;
}

interface ItemRow {
  id: string;
  title: string;
  sort_order: number;
  section_type: string;
  parent_item_id: string | null;
  status: string;
  operator_notes: string | null;
  suggested_motion: string | null;
  source_minutes_document_id: string | null;
  description: string | null;
  presenter: string | null;
  estimated_duration: number | null;
  staff_resource: string | null;
  background: string | null;
  recommendation: string | null;
}

/** Every agenda item on a meeting, straight from the table. */
async function readItems(db: TestDb, town: TownFixture, meetingId: string): Promise<ItemRow[]> {
  return inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT id, title, sort_order, section_type, parent_item_id, status::text AS status,
                   operator_notes, suggested_motion, source_minutes_document_id, description,
                   presenter, estimated_duration, staff_resource, background, recommendation
            FROM agenda_item WHERE meeting_id = ${meetingId}
            ORDER BY parent_item_id NULLS FIRST, sort_order, title`,
      )
      .then((r) => toRows<ItemRow>(r, (m) => new Error(m))),
  );
}

async function countRows(db: TestDb, town: TownFixture, statement: ReturnType<typeof sql>) {
  const rows = await inTown(db, town, (tx) =>
    tx.execute(statement).then((r) => toRows<{ count: number }>(r, (m) => new Error(m))),
  );
  return rows[0]?.count ?? 0;
}

const VALID_ITEM_FIELDS = {
  title: "Discuss the budget",
  description: null,
  presenter: null,
  estimatedDuration: null,
  staffResource: null,
  background: null,
  recommendation: null,
  suggestedMotion: null,
};

describe("agendaItem.countByMeeting", () => {
  it("counts the agenda items on a meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        await seedAgendaItem(db, town, meetingId);
        await seedAgendaItem(db, town, meetingId);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.agendaItem.countByMeeting({ meetingId })).toBe(2);
      } finally {
        await app.end();
      }
    });
  });

  it("answers 0 for a meeting with no agenda items", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.agendaItem.countByMeeting({ meetingId })).toBe(0);
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
          caller.agendaItem.countByMeeting({ meetingId: theirMeeting }),
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
          caller.agendaItem.countByMeeting({ meetingId: randomUUID() }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaItem.byMeeting", () => {
  // Wave 4, Task 3 removed `exhibit_count` from this procedure's output — the
  // unfiltered `count(*)` disagreed with `exhibit.byMeeting`'s rule-14 filter
  // and disclosed the cardinality of the very rows that rule hides (see the
  // procedure's own doc comment). The two exhibits seeded below stay: they are
  // now the pin that this read does NOT count them, which is what
  // `expect(row).not.toHaveProperty("exhibit_count")` asserts.
  it("returns the meeting's items flat, ordered by sort_order, and counts no exhibits", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const section = await seedAgendaItem(db, town, meetingId, {
          title: "New Business",
          sortOrder: 0,
        });
        const child = await seedAgendaItem(db, town, meetingId, {
          title: "Budget",
          sortOrder: 1,
          parentItemId: section,
        });
        await seedExhibit(db, town, child);
        await seedExhibit(db, town, child);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.agendaItem.byMeeting({ meetingId });
        expect(rows.map((r) => r.title)).toEqual(["New Business", "Budget"]);
        expect(rows[0]?.parent_item_id).toBeNull();
        expect(rows[1]?.parent_item_id).toBe(section);
        // `child` has two exhibits and this read reports neither, by
        // absence rather than by a zero: re-adding the column would turn
        // this red.
        expect(rows[0]).not.toHaveProperty("exhibit_count");
        expect(rows[1]).not.toHaveProperty("exhibit_count");
      } finally {
        await app.end();
      }
    });
  });

  it("does not return another town's items, and answers NOT_FOUND for its meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        await seedAgendaItem(db, theirs, theirMeeting, { title: "Not Mine" });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaItem.insert", () => {
  it("lets a caller holding A2 on this board add a section, with town_id from the session and status pending", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.agendaItem.insert({
          boardId: town.boardId,
          meetingId,
          parentItemId: null,
          sectionType: "action",
          sortOrder: 3,
          ...VALID_ITEM_FIELDS,
          title: "New Business",
        });

        const items = await readItems(db, town, meetingId);
        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe(result.id);
        expect(items[0]?.title).toBe("New Business");
        expect(items[0]?.sort_order).toBe(3);
        expect(items[0]?.status).toBe("pending");
        expect(items[0]?.parent_item_id).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no A2 on this board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.insert({
            boardId: town.boardId,
            meetingId,
            parentItemId: null,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("A2");
        expect(await readItems(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The case the whole board-scoped mechanism exists for, on the shape wave
   * 3 could not exercise: the board is not on the row, it is on the meeting.
   */
  it("honours a REVOKING board override: refused on the barred board, allowed for the same actor on another", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const barredMeeting = await seedMeeting(db, town, town.boardId);
        const otherMeeting = await seedMeeting(db, town, town.otherBoardId);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: ["A2"],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: false } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.insert({
            boardId: town.boardId,
            meetingId: barredMeeting,
            parentItemId: null,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readItems(db, town, barredMeeting)).toEqual([]);

        const allowed = await caller.agendaItem.insert({
          boardId: town.otherBoardId,
          meetingId: otherMeeting,
          parentItemId: null,
          sectionType: "action",
          sortOrder: 0,
          ...VALID_ITEM_FIELDS,
        });
        expect(allowed.id).toBeTruthy();
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The board-MISMATCH case, one join deep: the caller holds A2 on THEIR
   * board and claims it, but the `meetingId` names a meeting on a board they
   * hold nothing on. `agenda_item_tenant_isolation` has no board predicate,
   * so nothing in the database stops this; only the resolver's re-derivation
   * does. Verified by mutation: with `assertMeetingOnAuthorizedBoard`'s
   * `assertMatchesAuthorizedBoard` call removed, this creates the item.
   */
  it("refuses when the claimed boardId does not match the meeting's real board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.insert({
            boardId: town.boardId,
            meetingId: theirMeeting,
            parentItemId: null,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readItems(db, town, theirMeeting)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The FK-bypasses-RLS hazard (conventions item 3), on `meeting_id`.
   * Verified by mutation during this task: with the `if (!row) throw
   * NOT_FOUND` line removed from `assertMeetingOnAuthorizedBoard`, an admin
   * in Newcastle writes an `agenda_item` row whose `meeting_id` names
   * Bristol's meeting — `agenda_item_meeting_id_fkey` accepts it, because FK
   * enforcement bypasses row security. See the task report.
   */
  it("answers NOT_FOUND for a meetingId belonging to another town, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaItem.insert({
            boardId: mine.boardId,
            meetingId: theirMeeting,
            parentItemId: null,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
            title: "Cross-tenant item",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(
          await countRows(
            db,
            theirs,
            sql`SELECT count(*)::int AS count FROM agenda_item WHERE meeting_id = ${theirMeeting}`,
          ),
        ).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The second FK on this procedure, and the one an existence check alone
   * would not close: `parentItemId` must be a real item ON THE SAME MEETING.
   * A real parent in another meeting satisfies
   * `agenda_item_parent_item_id_fkey` while hanging the new row under a
   * parent nothing renders.
   */
  it("answers NOT_FOUND for a parentItemId belonging to a different meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const otherMeeting = await seedMeeting(db, town, town.boardId, { title: "Other" });
        const foreignParent = await seedAgendaItem(db, town, otherMeeting);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.agendaItem.insert({
            boardId: town.boardId,
            meetingId,
            parentItemId: foreignParent,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readItems(db, town, meetingId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The reorder pin: `boardId` is a real uuid the guard reads and would
   * authorize on, while `title` fails `.input()`'s `min(1)`. With `.use()`
   * declared before `.input()`, the guard runs first and answers FORBIDDEN;
   * moving it after `.input()` turns this red with BAD_REQUEST.
   */
  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.insert({
            boardId: town.boardId,
            meetingId,
            parentItemId: null,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
            title: "",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Complement of the reorder pin, proving it is not vacuous: the same
   * refused caller sending input that PARSES also gets FORBIDDEN, so the pin
   * above distinguishes guard ORDER rather than "any error is FORBIDDEN".
   * (Written once, here — every other procedure's reorder pin below has the
   * identical structure, and its own "refuses a caller with no A2" test is
   * that same complement.)
   */
  it("proves the reorder pin is not vacuous: valid-but-unauthorized input also answers FORBIDDEN", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.insert({
            boardId: town.boardId,
            meetingId,
            parentItemId: null,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaItem.update", () => {
  it("lets a caller holding A2 edit the eight editable fields and nothing else", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId, {
          sectionType: "report",
          sortOrder: 4,
        });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        await caller.agendaItem.update({
          boardId: town.boardId,
          itemId,
          title: "Revised title",
          description: "Some detail",
          presenter: "Town Manager",
          estimatedDuration: 15,
          staffResource: "Finance",
          background: "Background",
          recommendation: "Approve",
          suggestedMotion: "to approve",
        });

        const item = (await readItems(db, town, meetingId))[0];
        expect(item?.title).toBe("Revised title");
        expect(item?.estimated_duration).toBe(15);
        expect(item?.recommendation).toBe("Approve");
        // Structural columns are not this procedure's to touch.
        expect(item?.section_type).toBe("report");
        expect(item?.sort_order).toBe(4);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no A2 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId, { title: "Untouched" });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.update({ boardId: town.boardId, itemId, ...VALID_ITEM_FIELDS }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readItems(db, town, meetingId))[0]?.title).toBe("Untouched");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The mismatch case, TWO joins from the authorized board: the caller names
   * an `itemId` whose MEETING belongs to a board they hold nothing on, and
   * claims their own board for it. The item id itself carries no board at
   * all, so this is the shape wave 3's `meeting.cancel` test could not
   * exercise.
   */
  it("refuses when the item's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting, { title: "Theirs" });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.update({
            boardId: town.boardId,
            itemId: theirItem,
            ...VALID_ITEM_FIELDS,
            title: "Hijacked",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readItems(db, town, theirMeeting))[0]?.title).toBe("Theirs");
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
        const barredMeeting = await seedMeeting(db, town, town.boardId);
        const barredItem = await seedAgendaItem(db, town, barredMeeting, { title: "Barred" });
        const otherMeeting = await seedMeeting(db, town, town.otherBoardId);
        const otherItem = await seedAgendaItem(db, town, otherMeeting, { title: "Other" });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: ["A2"],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: false } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.update({
            boardId: town.boardId,
            itemId: barredItem,
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");

        await caller.agendaItem.update({
          boardId: town.otherBoardId,
          itemId: otherItem,
          ...VALID_ITEM_FIELDS,
          title: "Edited",
        });
        expect((await readItems(db, town, otherMeeting))[0]?.title).toBe("Edited");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an itemId in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const theirItem = await seedAgendaItem(db, theirs, theirMeeting, { title: "Not Mine" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaItem.update({
            boardId: mine.boardId,
            itemId: theirItem,
            ...VALID_ITEM_FIELDS,
            title: "Hijacked",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readItems(db, theirs, theirMeeting))[0]?.title).toBe("Not Mine");
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
          caller.agendaItem.update({
            boardId: town.boardId,
            itemId: "not-a-uuid",
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaItem.reorder", () => {
  it("rewrites sort_order to each id's position in the list", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const first = await seedAgendaItem(db, town, meetingId, { title: "A", sortOrder: 0 });
        const second = await seedAgendaItem(db, town, meetingId, { title: "B", sortOrder: 1 });
        const third = await seedAgendaItem(db, town, meetingId, { title: "C", sortOrder: 2 });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.agendaItem.reorder({
          boardId: town.boardId,
          itemIds: [third, first, second],
        });
        expect(result.count).toBe(3);

        const rows = await caller.agendaItem.byMeeting({ meetingId });
        expect(rows.map((r) => r.title)).toEqual(["C", "A", "B"]);
        expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no A2 on this board, and reorders nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const first = await seedAgendaItem(db, town, meetingId, { title: "A", sortOrder: 0 });
        const second = await seedAgendaItem(db, town, meetingId, { title: "B", sortOrder: 1 });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.reorder({ boardId: town.boardId, itemIds: [second, first] }),
        );
        expect(err.code).toBe("FORBIDDEN");
        const rows = await readItems(db, town, meetingId);
        expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The many-row proof this task's brief asks for by name: a list mixing ids
   * from two meetings on two boards, one of which IS the authorized board.
   * A single re-authorization that looked at the first row (or at "the"
   * board) would pass here. Deriving the DISTINCT set and refusing anything
   * but the one authorized board is what makes this FORBIDDEN.
   *
   * Verified by mutation, and the result is worth stating exactly because
   * the first version of this comment overstated it. Replacing the
   * `for (const boardId of new Set(...))` loop in
   * `assertItemsOnAuthorizedBoard` with a single
   * `assertMatchesAuthorizedBoard(ctx, rows[0]!.board_id)` turns this test
   * red as `expected 'BAD_REQUEST' to be 'FORBIDDEN'` — NOT as a successful
   * reorder. The authorization check stops refusing; what stops the write is
   * the unrelated same-meeting check below, which happens to catch every
   * cross-board list because a meeting has exactly one board. Removing BOTH
   * (that single check plus the `meetingIds.length > 1` refusal) and the
   * cross-board reorder SUCCEEDS outright — `expected a TRPCError, got
   * undefined`. So the distinct-set loop is what makes this an authorization
   * refusal rather than an integrity accident, and the accident is one
   * refactor away from not being there. See the task report.
   */
  it("refuses a list whose ids span two boards, even though one of them is the authorized board", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const mineMeeting = await seedMeeting(db, town, town.boardId);
        const mineItem = await seedAgendaItem(db, town, mineMeeting, { title: "A", sortOrder: 0 });
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting, {
          title: "B",
          sortOrder: 7,
        });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.reorder({
            boardId: town.boardId,
            itemIds: [mineItem, theirItem],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        // Neither side moved — the refusal happens before any UPDATE.
        expect((await readItems(db, town, mineMeeting))[0]?.sort_order).toBe(0);
        expect((await readItems(db, town, theirMeeting))[0]?.sort_order).toBe(7);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The other half of the many-row shape, and a DIFFERENT refusal for a
   * different reason: two meetings on the SAME board pass the authorization
   * check honestly, and are still refused — `sort_order` is meaningful only
   * within one meeting, so interleaving two agendas would be silent
   * corruption. BAD_REQUEST, not FORBIDDEN: nothing about this caller is
   * unauthorized.
   */
  it("refuses a list spanning two meetings of the SAME board, with BAD_REQUEST", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const firstMeeting = await seedMeeting(db, town, town.boardId, { title: "One" });
        const secondMeeting = await seedMeeting(db, town, town.boardId, { title: "Two" });
        const a = await seedAgendaItem(db, town, firstMeeting, { title: "A", sortOrder: 0 });
        const b = await seedAgendaItem(db, town, secondMeeting, { title: "B", sortOrder: 5 });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.reorder({ boardId: town.boardId, itemIds: [b, a] }),
        );
        expect(err.code).toBe("BAD_REQUEST");
        expect((await readItems(db, town, secondMeeting))[0]?.sort_order).toBe(5);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when any id in the list is another town's", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const myMeeting = await seedMeeting(db, mine, mine.boardId);
        const myItem = await seedAgendaItem(db, mine, myMeeting, { title: "A", sortOrder: 3 });
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const theirItem = await seedAgendaItem(db, theirs, theirMeeting, { title: "B" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaItem.reorder({ boardId: mine.boardId, itemIds: [theirItem, myItem] }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readItems(db, mine, myMeeting))[0]?.sort_order).toBe(3);
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
          caller.agendaItem.reorder({ boardId: town.boardId, itemIds: ["not-a-uuid"] }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaItem.delete", () => {
  /**
   * The cascade, in one statement: `agenda_item_parent_item_id_fkey` and
   * `exhibit_agenda_item_id_fkey` are both ON DELETE CASCADE, so deleting a
   * section removes its children and their exhibits atomically — replacing
   * `InlineItemForm`'s three unguarded round trips and `AgendaSection`'s
   * per-child loop.
   */
  it("deletes a section, its child items and their exhibits, in one transaction", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const section = await seedAgendaItem(db, town, meetingId, { title: "Section" });
        const child = await seedAgendaItem(db, town, meetingId, {
          title: "Child",
          parentItemId: section,
        });
        const exhibitId = await seedExhibit(db, town, child);
        const survivor = await seedAgendaItem(db, town, meetingId, { title: "Survivor" });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        await caller.agendaItem.delete({ boardId: town.boardId, itemId: section });

        const remaining = await readItems(db, town, meetingId);
        expect(remaining.map((r) => r.id)).toEqual([survivor]);
        expect(
          await countRows(
            db,
            town,
            sql`SELECT count(*)::int AS count FROM exhibit WHERE id = ${exhibitId}`,
          ),
        ).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no A2 on this board, and deletes nothing", async () => {
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
          caller.agendaItem.delete({ boardId: town.boardId, itemId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("A2");
        expect(await readItems(db, town, meetingId)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the item's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.delete({ boardId: town.boardId, itemId: theirItem }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readItems(db, town, theirMeeting)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an itemId in another town, and deletes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const theirItem = await seedAgendaItem(db, theirs, theirMeeting);
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaItem.delete({ boardId: mine.boardId, itemId: theirItem }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readItems(db, theirs, theirMeeting)).toHaveLength(1);
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
          caller.agendaItem.delete({ boardId: town.boardId, itemId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

const SECTIONS_FIXTURE = [
  {
    title: "Call to Order",
    sort_order: 0,
    section_type: "procedural",
    is_fixed: true,
    description: "Opening",
    default_items: ["Roll call", "Pledge"],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
  {
    title: "New Business",
    sort_order: 1,
    section_type: "action",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "full_record",
    show_item_commentary: true,
  },
];

describe("agendaItem.instantiateFromTemplate", () => {
  it("creates one item per section and one child per default item, in template order", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const templateId = await seedTemplate(db, town, town.boardId, SECTIONS_FIXTURE);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.agendaItem.instantiateFromTemplate({
          boardId: town.boardId,
          meetingId,
          templateId,
        });
        expect(result.count).toBe(4);

        const rows = await caller.agendaItem.byMeeting({ meetingId });
        const sections = rows.filter((r) => r.parent_item_id === null);
        expect(sections.map((s) => s.title)).toEqual(["Call to Order", "New Business"]);
        expect(sections[0]?.description).toBe("Opening");
        expect(sections[0]?.section_type).toBe("procedural");

        const children = rows.filter((r) => r.parent_item_id === sections[0]?.id);
        expect(children.map((c) => c.title)).toEqual(["Roll call", "Pledge"]);
        expect(children.map((c) => c.sort_order)).toEqual([0, 1]);
        expect(children[0]?.section_type).toBe("procedural");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The `minutes_approval` branch, carried over from
   * `lib/meeting-helpers.ts`'s `autoPopulateMinutesApproval` rather than
   * quietly dropped when the helper moved server-side: a section of that type
   * ignores its `default_items` and gets one child per meeting of this board
   * awaiting minutes approval, each with a suggested motion naming the board
   * and the meeting's date, and "as amended" when that meeting's minutes
   * carry an amendment history.
   */
  it("auto-populates a minutes_approval section from the board's meetings awaiting approval", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId, { title: "Upcoming" });
        // Qualifies by STATUS.
        await seedMeeting(db, town, town.boardId, {
          title: "Adjourned one",
          scheduledDate: "2026-01-05",
          status: "adjourned",
        });
        // Qualifies by having minutes in review, despite an ordinary status,
        // and its minutes carry an amendment.
        const amended = await seedMeeting(db, town, town.boardId, {
          title: "Amended one",
          scheduledDate: "2026-02-09",
          status: "draft",
        });
        await seedMinutesDocument(db, town, amended, town.boardId, {
          status: "review",
          amendments: [{ note: "corrected a name" }],
        });
        // Another board's meeting must not appear.
        await seedMeeting(db, town, town.otherBoardId, {
          title: "Other board",
          scheduledDate: "2026-01-06",
          status: "adjourned",
        });
        const templateId = await seedTemplate(db, town, town.boardId, [
          {
            title: "Minutes",
            sort_order: 0,
            section_type: "minutes_approval",
            is_fixed: true,
            description: null,
            default_items: ["ignored"],
            minutes_behavior: "action_only",
            show_item_commentary: false,
          },
        ]);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.agendaItem.instantiateFromTemplate({
          boardId: town.boardId,
          meetingId,
          templateId,
        });
        expect(result.count).toBe(3);

        const rows = await readItems(db, town, meetingId);
        const section = rows.find((r) => r.parent_item_id === null);
        const children = rows
          .filter((r) => r.parent_item_id === section?.id)
          .sort((a, b) => a.sort_order - b.sort_order);
        expect(children.map((c) => c.title)).toEqual([
          "Approval of Minutes — January 5, 2026",
          "Approval of Minutes — February 9, 2026",
        ]);
        expect(children[0]?.suggested_motion).toBe(
          "to approve the minutes of the Select Board meeting of January 5, 2026 as presented",
        );
        expect(children[1]?.suggested_motion).toBe(
          "to approve the minutes of the Select Board meeting of February 9, 2026 as amended",
        );
        expect(children[0]?.source_minutes_document_id).toBeNull();
        expect(children[1]?.source_minutes_document_id).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no A2 on this board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const templateId = await seedTemplate(db, town, town.boardId, SECTIONS_FIXTURE);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.instantiateFromTemplate({
            boardId: town.boardId,
            meetingId,
            templateId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readItems(db, town, meetingId)).toEqual([]);
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
        const templateId = await seedTemplate(db, town, town.boardId, SECTIONS_FIXTURE);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.instantiateFromTemplate({
            boardId: town.boardId,
            meetingId: theirMeeting,
            templateId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readItems(db, town, theirMeeting)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a templateId in another town, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const meetingId = await seedMeeting(db, mine, mine.boardId);
        const theirTemplate = await seedTemplate(db, theirs, theirs.boardId, SECTIONS_FIXTURE);
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaItem.instantiateFromTemplate({
            boardId: mine.boardId,
            meetingId,
            templateId: theirTemplate,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readItems(db, mine, meetingId)).toEqual([]);
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
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaItem.instantiateFromTemplate({
            boardId: town.boardId,
            meetingId,
            templateId: "not-a-uuid",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

/**
 * The two procedures nothing calls yet — wave 5's `live.tsx` is the caller.
 * Tested exactly like the wired writes, so wave 5 inherits a guard that is
 * already proven rather than one that has only ever been read.
 */
describe("agendaItem.setOperatorNotes (unwired — wave 5)", () => {
  it("lets a caller holding A2 record and clear operator notes", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        await caller.agendaItem.setOperatorNotes({
          boardId: town.boardId,
          itemId,
          operatorNotes: "Chair will read the letter",
        });
        expect((await readItems(db, town, meetingId))[0]?.operator_notes).toBe(
          "Chair will read the letter",
        );

        await caller.agendaItem.setOperatorNotes({
          boardId: town.boardId,
          itemId,
          operatorNotes: null,
        });
        expect((await readItems(db, town, meetingId))[0]?.operator_notes).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The wave 5, Task 2 decision, as a test: `operator_notes` is a live-run
   * column, so M1 (`start_run_meeting`) reaches it and A2 is not required.
   * This caller holds M1 on one board and nothing else anywhere — the shape
   * `TEMPLATE_BOARD_SPECIFIC_STAFF` produces — and would have been REFUSED by
   * the `requireBoardPermission("A2", …)` this procedure shipped with.
   */
  it("lets a presiding officer holding M1 and NO A2 record operator notes", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const officer = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { M1: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        await caller.agendaItem.setOperatorNotes({
          boardId: town.boardId,
          itemId,
          operatorNotes: "Chair reads the letter",
        });
        expect((await readItems(db, town, meetingId))[0]?.operator_notes).toBe(
          "Chair reads the letter",
        );

        // ...and that M1 does NOT leak into the agenda's contents: the same
        // caller still cannot edit the item itself.
        const err = await expectTrpcError(() =>
          caller.agendaItem.update({
            boardId: town.boardId,
            itemId,
            title: "Renamed",
            description: null,
            presenter: null,
            estimatedDuration: null,
            staffResource: null,
            background: null,
            recommendation: null,
            suggestedMotion: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with neither A2 nor M1 on this board, and writes nothing", async () => {
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
          caller.agendaItem.setOperatorNotes({
            boardId: town.boardId,
            itemId,
            operatorNotes: "Nope",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readItems(db, town, meetingId))[0]?.operator_notes).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the item's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.setOperatorNotes({
            boardId: town.boardId,
            itemId: theirItem,
            operatorNotes: "Hijacked",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readItems(db, town, theirMeeting))[0]?.operator_notes).toBeNull();
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
          caller.agendaItem.setOperatorNotes({
            boardId: town.boardId,
            itemId: "not-a-uuid",
            operatorNotes: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaItem.markComplete (unwired — wave 5)", () => {
  it("lets a caller holding A2 mark an item complete", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        await caller.agendaItem.markComplete({ boardId: town.boardId, itemId });
        expect((await readItems(db, town, meetingId))[0]?.status).toBe("completed");
      } finally {
        await app.end();
      }
    });
  });

  /** The other half of the wave 5, Task 2 decision — see `setOperatorNotes`. */
  it("lets a presiding officer holding M1 and NO A2 mark an item complete", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const officer = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { M1: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, officer));

        await caller.agendaItem.markComplete({ boardId: town.boardId, itemId });
        expect((await readItems(db, town, meetingId))[0]?.status).toBe("completed");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with neither A2 nor M1 on this board, and leaves the status alone", async () => {
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
          caller.agendaItem.markComplete({ boardId: town.boardId, itemId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readItems(db, town, meetingId))[0]?.status).toBe("pending");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the item's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.agendaItem.markComplete({ boardId: town.boardId, itemId: theirItem }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readItems(db, town, theirMeeting))[0]?.status).toBe("pending");
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
          caller.agendaItem.markComplete({ boardId: town.boardId, itemId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });
});

/**
 * ─── Phase E, wave 5, Task 3 — the two live-run columns, and the publishes ──
 *
 * Two changes this wave made to a router wave 4 finished:
 *
 *   - `byMeeting` now returns `status` and `operator_notes`. The procedure's
 *     own doc comment had listed them as deliberately absent, "wave 5's live
 *     screen does read `status`, and adds it the day it needs it". This is
 *     that day.
 *   - All seven writes call `publishRealtimeEvent`, discharging seven of the
 *     eleven `AWAITING_PUBLISH` entries. `router-wiring.test.ts` checks that
 *     each one publishes AT ALL; what it cannot check is that the topic
 *     matches the table and names the right meeting, which is what the test
 *     below does for a representative write.
 */

import { captureRealtimeEvents } from "./live-fixtures.js";

describe("agendaItem.byMeeting — the live-run columns", () => {
  it("returns status and operator_notes", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId, { title: "Budget" });
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));
        await caller.agendaItem.setOperatorNotes({
          boardId: town.boardId,
          itemId,
          operatorNotes: "chair asked for the Q3 figures",
        });
        await caller.agendaItem.markComplete({ boardId: town.boardId, itemId });

        const rows = await caller.agendaItem.byMeeting({ meetingId });
        expect(rows[0]).toMatchObject({
          status: "completed",
          operator_notes: "chair asked for the Q3 figures",
        });
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaItem writes announce themselves", () => {
  it("publishes the agenda_item topic for this meeting on insert", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { topics, events } = await captureRealtimeEvents(client, 1, () =>
          caller.agendaItem.insert({
            boardId: town.boardId,
            meetingId,
            parentItemId: null,
            sectionType: "action",
            sortOrder: 0,
            ...VALID_ITEM_FIELDS,
          }),
        );
        expect(topics).toEqual(["agenda_item"]);
        expect(events[0]?.meetingId).toBe(meetingId);
      } finally {
        await app.end();
      }
    });
  });

  it("publishes on a delete, keyed to the deleted item's meeting", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        // The meeting id here cannot come from input — `delete` takes only an
        // item id — so this also pins that it comes from the row the guard
        // already read rather than from a second query after the delete.
        const { topics, events } = await captureRealtimeEvents(client, 1, () =>
          caller.agendaItem.delete({ boardId: town.boardId, itemId }),
        );
        expect(topics).toEqual(["agenda_item"]);
        expect(events[0]?.meetingId).toBe(meetingId);
      } finally {
        await app.end();
      }
    });
  });
});
