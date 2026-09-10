/**
 * The `exhibit` router — Phase E wave 4, Task 2.
 *
 * ─── What this file has to prove that no previous router's tests did ──────
 *
 * 1. **The board is TWO joins away.** `agenda_item` has no `board_id` (wave
 *    4, Task 1) and neither does `exhibit`; `link` derives the board through
 *    `agenda_item → meeting` and refuses a claimed board that does not match.
 *    Task 1's tests proved that for one join.
 * 2. **`requireBoardActor`'s second real call site, on a rule with a ROLE
 *    branch.** `assertCanInsertExhibit` is `A3@board OR isBoardMember(actor)`
 *    — not one `PermissionCode`, so `requireBoardPermission` cannot express
 *    it. Both branches are exercised, and the role branch is exercised for
 *    what it actually is: a TOWN-level fact, which is why the
 *    "a board member of one board may link on ANOTHER board" test below
 *    asserts a SUCCESS. That test is not describing a defect this task
 *    introduced — the D1e upload endpoint reaches the same rule with the same
 *    derived board and answers identically — it is pinning the rule's real
 *    reach so that narrowing it later is a deliberate, visible change rather
 *    than a silent one.
 * 3. **Rule 14 on a list read.** `byMeeting` filters with `visibleExhibits`;
 *    the raw Supabase query it replaces returned every tier to everyone.
 * 4. **The FK existence check (conventions item 3).** `agendaItemId` is a
 *    foreign key from client input and FK enforcement bypasses RLS, so a
 *    cross-tenant id must answer NOT_FOUND rather than silently inserting a
 *    row into this town that hangs off another town's agenda item.
 *
 * ─── Mutations run, and what each actually turned red ────────────────────
 *
 * Measured, not predicted — each mutation applied, the file re-run, then the
 * file restored byte-identical. The exact counts are here because the tidy
 * sentence and the true one differ in every case:
 *
 * 1. **`link`'s `.use(requireBoardActor(assertCanInsertExhibit))` deleted →
 *    10 of the 13 `link` tests red.** Deleting it does NOT leave
 *    `assertAgendaItemOnAuthorizedBoard` working as an independent re-check:
 *    `ctx.authorizedBoardId` goes unset for every call and
 *    `assertMatchesAuthorizedBoard` answers a plain wiring-bug `Error`, so
 *    the SUCCESS cases go red too — the shape `agenda-item.test.ts`'s and
 *    `meeting.test.ts`'s headers record for their own guards. **THREE
 *    survive, not the two a reader would guess:** both NOT_FOUND cases (the
 *    existence check runs before the mismatch check) AND the `javascript:`
 *    URL case, whose refusal comes from the input schema and never reaches a
 *    guard at all.
 * 2. **`.use()` moved after `.input()` → exactly one red**, the reorder pin,
 *    as `expected 'BAD_REQUEST' to be 'FORBIDDEN'`. Nothing else moves,
 *    which is what makes it a pin on ORDER rather than on existence.
 * 3. **`assertAgendaItemOnAuthorizedBoard`'s `if (!row) throw NOT_FOUND`
 *    replaced with `if (!row) return` → the cross-tenant insert SUCCEEDS**,
 *    reported as `expected a TRPCError, got undefined`. Not an error, not a
 *    refusal — a committed `exhibit` row in Newcastle hanging off Bristol's
 *    agenda item, which Bristol can neither see nor delete. That is
 *    conventions item 3's "FK enforcement bypasses row security" reproduced
 *    on this table, and it is the reason the existence check is not
 *    redundant with the FK. (The "never existed" case fails differently, as
 *    `INTERNAL_SERVER_ERROR` — there the FK genuinely has no row to point
 *    at, so Postgres raises. Only the CROSS-TENANT id is silent.)
 * 4. **`visibleExhibits` dropped from `byMeeting` → 2 red**, the `admin_only`
 *    and `board_only` tier tests, with the excluded titles present in the
 *    answer.
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

async function seedMeeting(db: TestDb, town: TownFixture, boardId: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status,
                           meeting_type, agenda_status)
      VALUES (${id}, ${boardId}, ${town.townId}, 'Regular Meeting', '2026-11-03'::date,
              'draft'::meeting_status, 'regular', 'draft')
    `);
  });
  return id;
}

async function seedAgendaItem(db: TestDb, town: TownFixture, meetingId: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO agenda_item (id, meeting_id, town_id, section_type, title, sort_order)
      VALUES (${id}, ${meetingId}, ${town.townId}, 'new_business', 'Discuss the budget', 0)
    `);
  });
  return id;
}

async function seedExhibit(
  db: TestDb,
  town: TownFixture,
  agendaItemId: string,
  opts: { title?: string; visibility?: string; sortOrder?: number; fileType?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO exhibit (id, agenda_item_id, town_id, title, file_storage_path, file_type,
                           visibility, sort_order)
      VALUES (${id}, ${agendaItemId}, ${town.townId}, ${opts.title ?? "Budget PDF"},
              'exhibits/budget.pdf', ${opts.fileType ?? "application/pdf"},
              ${opts.visibility ?? "public"}::exhibit_visibility, ${opts.sortOrder ?? 0})
    `);
  });
  return id;
}

interface ExhibitRecord {
  id: string;
  agenda_item_id: string;
  title: string;
  file_storage_path: string;
  file_type: string;
  file_name: string | null;
  file_size: string | null;
  exhibit_type: string | null;
  visibility: string;
  sort_order: number;
  town_id: string;
  uploaded_by: string | null;
}

/** Every exhibit on an agenda item, straight from the table, unfiltered. */
async function readExhibits(
  db: TestDb,
  town: TownFixture,
  agendaItemId: string,
): Promise<ExhibitRecord[]> {
  return inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT id, agenda_item_id, title, file_storage_path, file_type, file_name,
                   file_size, exhibit_type, visibility::text AS visibility, sort_order,
                   town_id, uploaded_by
            FROM exhibit WHERE agenda_item_id = ${agendaItemId}
            ORDER BY sort_order, id`,
      )
      .then((r) => toRows<ExhibitRecord>(r, (m) => new Error(m))),
  );
}

const VALID_LINK_FIELDS = {
  title: "Assessor's map",
  url: "https://example.gov/maps/parcel-12.pdf",
  exhibitType: "supporting_document",
};

// ═══════════════════════════════════════════════════════════════════════
// exhibit.byMeeting
// ═══════════════════════════════════════════════════════════════════════

describe("exhibit.byMeeting", () => {
  it("returns the meeting's exhibits ordered by sort_order, with the columns the agenda screen reads", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        await seedExhibit(db, town, itemId, { title: "Second", sortOrder: 1 });
        await seedExhibit(db, town, itemId, { title: "First", sortOrder: 0 });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.exhibit.byMeeting({ meetingId });
        expect(rows.map((r) => r.title)).toEqual(["First", "Second"]);
        expect(rows[0]?.agenda_item_id).toBe(itemId);
        expect(rows[0]?.file_type).toBe("application/pdf");
        expect(rows[0]?.visibility).toBe("public");
        // The scope the rule needed is not part of the answer — see the
        // router's own comment on the `visibleExhibits` call.
        expect(rows[0]).not.toHaveProperty("board_id");
        expect(rows[0]).not.toHaveProperty("boardId");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The raw query this replaces read every exhibit in the TOWN
   * (`.eq("town_id", townId)`) and filtered to the meeting in the browser.
   * Scoping it in SQL is one of the two behaviour changes the router header
   * states; this is the test that shows it.
   */
  it("returns only THIS meeting's exhibits, not the town's", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const mine = await seedMeeting(db, town, town.boardId);
        const mineItem = await seedAgendaItem(db, town, mine);
        await seedExhibit(db, town, mineItem, { title: "Mine" });
        const other = await seedMeeting(db, town, town.otherBoardId);
        const otherItem = await seedAgendaItem(db, town, other);
        await seedExhibit(db, town, otherItem, { title: "Another Meeting's" });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.exhibit.byMeeting({ meetingId: mine });
        expect(rows.map((r) => r.title)).toEqual(["Mine"]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Rule 14, the tightening the router header names as observable. A staff
   * clerk holding A2 (edit_agenda) but not A3 sees the `public` exhibit and
   * not the `admin_only` one — which is what rule 14 says and what
   * `resolveExhibitForDownload` has enforced on the BYTES since D1e. Before
   * this procedure the same clerk read every title in the town.
   */
  it("hides an admin_only exhibit from a clerk holding A2 but not A3, and keeps the public one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        await seedExhibit(db, town, itemId, { title: "Public Map", sortOrder: 0 });
        await seedExhibit(db, town, itemId, {
          title: "Personnel Memo",
          visibility: "admin_only",
          sortOrder: 1,
        });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A2"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const rows = await caller.exhibit.byMeeting({ meetingId });
        expect(rows.map((r) => r.title)).toEqual(["Public Map"]);

        // Same rows, an actor rule 14 admits: the filter is about the ACTOR,
        // not about the data. Without this half the test above would also
        // pass against a procedure that dropped `admin_only` unconditionally.
        const withA3 = await seedActor(db, town, { role: "staff", global: ["A3"] });
        const a3Caller = appRouter.createCaller(contextFor(db, town, withA3));
        const all = await a3Caller.exhibit.byMeeting({ meetingId });
        expect(all.map((r) => r.title)).toEqual(["Public Map", "Personnel Memo"]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The `board_only` tier's own branch, which the `admin_only` test above
   * cannot reach: a board member sees `board_only` and is refused
   * `admin_only`. That difference is rule 14's entire reason for having two
   * restricted tiers rather than one.
   */
  it("shows a board_only exhibit to a board member and still hides the admin_only one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        await seedExhibit(db, town, itemId, { title: "Draft Warrant", visibility: "board_only" });
        await seedExhibit(db, town, itemId, {
          title: "Personnel Memo",
          visibility: "admin_only",
          sortOrder: 1,
        });
        const member = await seedActor(db, town, { role: "board_member", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, member));

        const rows = await caller.exhibit.byMeeting({ meetingId });
        expect(rows.map((r) => r.title)).toEqual(["Draft Warrant"]);
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
        const theirItem = await seedAgendaItem(db, theirs, theirMeeting);
        await seedExhibit(db, theirs, theirItem, { title: "Not Mine" });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.exhibit.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meeting id that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.exhibit.byMeeting({ meetingId: randomUUID() }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });

  it("answers [] for a meeting whose agenda has no attachments", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        await seedAgendaItem(db, town, meetingId);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.exhibit.byMeeting({ meetingId })).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// exhibit.link
// ═══════════════════════════════════════════════════════════════════════

describe("exhibit.link", () => {
  it("lets a caller holding A3 link a URL, with town_id and uploaded_by from the session", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A3"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.exhibit.link({
          boardId: town.boardId,
          agendaItemId: itemId,
          ...VALID_LINK_FIELDS,
        });

        const rows = await readExhibits(db, town, itemId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(result.id);
        expect(rows[0]?.title).toBe("Assessor's map");
        expect(rows[0]?.file_storage_path).toBe(VALID_LINK_FIELDS.url);
        // The sentinel every reader of this table switches on.
        expect(rows[0]?.file_type).toBe("url");
        // A link has no bytes: NULL, not the raw insert's 0, which was a claim.
        expect(rows[0]?.file_size).toBeNull();
        expect(rows[0]?.file_name).toBeNull();
        expect(rows[0]?.exhibit_type).toBe("supporting_document");
        expect(rows[0]?.town_id).toBe(town.townId);
        // The raw Supabase insert left this NULL; the procedure attributes it.
        expect(rows[0]?.uploaded_by).toBe(clerk.userAccountId);
        expect(rows[0]?.sort_order).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with neither A3 nor a board seat, and creates nothing", async () => {
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
          caller.exhibit.link({
            boardId: town.boardId,
            agendaItemId: itemId,
            ...VALID_LINK_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("A3");
        expect(await readExhibits(db, town, itemId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Rule 15's SECOND branch — the one that makes this rule multi-code and
   * therefore `requireBoardActor`'s rather than `requireBoardPermission`'s.
   * A board member with an empty permission matrix may attach their own
   * material.
   */
  it("lets a board member with an empty permission matrix link, through rule 15's role branch", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const member = await seedActor(db, town, { role: "board_member", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, member));

        await caller.exhibit.link({
          boardId: town.boardId,
          agendaItemId: itemId,
          ...VALID_LINK_FIELDS,
        });
        expect(await readExhibits(db, town, itemId)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * **The reach of rule 15's role branch, pinned as a SUCCESS on purpose.**
   *
   * `isBoardMember(actor)` is `actor.role === "board_member"` — a TOWN-level
   * fact with no board in it. So the `BoardScope` this guard derives and
   * re-checks is inert for that branch: a member seated on the Planning Board
   * may link on the Select Board's agenda item, and the mismatch defence does
   * not stop them because the board they claim IS the item's real board.
   *
   * This is not new and not this task's to change: `createExhibitFromUpload`
   * (the D1e file path) reaches the identical rule with the identical derived
   * board and answers the same way, and `board-scope.test.ts` already records
   * that the insert guard's two branches need two tests. Narrowing the rule
   * to "a member of THIS board" is a real design question — it needs a
   * `board_member` lookup, which makes the rule `async` and therefore
   * resolver-side (`assertCanInsertVoteRecord`'s shape, not this one) — and
   * deciding it inside a migration is the "design decision smuggled into a
   * migration" conventions item 1 forbids. Pinned here so that whoever DOES
   * decide it finds a failing test rather than silence.
   */
  it("does NOT scope the board-member branch to the member's own board — pinned so narrowing it is deliberate", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const otherBoardMeeting = await seedMeeting(db, town, town.otherBoardId);
        const otherBoardItem = await seedAgendaItem(db, town, otherBoardMeeting);
        const member = await seedActor(db, town, { role: "board_member", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, member));

        await caller.exhibit.link({
          boardId: town.otherBoardId,
          agendaItemId: otherBoardItem,
          ...VALID_LINK_FIELDS,
        });
        expect(await readExhibits(db, town, otherBoardItem)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("honours a REVOKING board override for A3: refused on the barred board, allowed on another", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const barredMeeting = await seedMeeting(db, town, town.boardId);
        const barredItem = await seedAgendaItem(db, town, barredMeeting);
        const otherMeeting = await seedMeeting(db, town, town.otherBoardId);
        const otherItem = await seedAgendaItem(db, town, otherMeeting);
        const clerk = await seedActor(db, town, {
          role: "staff",
          global: ["A3"],
          boardOverrides: [{ boardId: town.boardId, permissions: { A3: false } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.exhibit.link({
            boardId: town.boardId,
            agendaItemId: barredItem,
            ...VALID_LINK_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readExhibits(db, town, barredItem)).toEqual([]);

        await caller.exhibit.link({
          boardId: town.otherBoardId,
          agendaItemId: otherItem,
          ...VALID_LINK_FIELDS,
        });
        expect(await readExhibits(db, town, otherItem)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The mismatch defence, TWO joins deep — the case this router exists to
   * get right. The clerk holds A3 on their own board only and names it, but
   * the agenda item they name belongs to a meeting of the OTHER board. The
   * guard authorized the claimed board honestly; the resolver re-derives the
   * real one and refuses.
   */
  it("refuses when the claimed boardId does not match the agenda item's meeting's board", async () => {
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
          boardOverrides: [{ boardId: town.boardId, permissions: { A3: true } }],
        });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.exhibit.link({
            boardId: town.boardId,
            agendaItemId: theirItem,
            ...VALID_LINK_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readExhibits(db, town, theirItem)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Conventions item 3: `agendaItemId` is an FK from client input and FK
   * enforcement bypasses row security, so without the existence check inside
   * `assertAgendaItemOnAuthorizedBoard` this insert would succeed — writing
   * `exhibit{town_id: Newcastle, agenda_item_id: <Bristol's item>}`, a row
   * Bristol can neither see nor delete. Reproduced during this task by
   * neutering the check; restored. This test is what stays red without it.
   */
  it("answers NOT_FOUND for an agenda item in another town, and writes nothing", async () => {
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
          caller.exhibit.link({
            boardId: mine.boardId,
            agendaItemId: theirItem,
            ...VALID_LINK_FIELDS,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readExhibits(db, theirs, theirItem)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an agenda item id that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.exhibit.link({
            boardId: town.boardId,
            agendaItemId: randomUUID(),
            ...VALID_LINK_FIELDS,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
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
          caller.exhibit.link({
            boardId: town.boardId,
            agendaItemId: "not-a-uuid",
            ...VALID_LINK_FIELDS,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The owner decision "`board_only` exhibits stay out of the portal" needs a
   * link path that can EXPRESS `board_only` at all — the raw insert this
   * replaces hardcoded `public`. Both halves here: the field is honoured when
   * given, and defaults to `public` when omitted (which is what the existing
   * client sends, so its behaviour is unchanged). The portal's own filter
   * (`portalVisibleExhibits`, `routes/portal.ts`) is what keeps the
   * `board_only` row off the public site, and it reads exactly this column.
   */
  it("stores the visibility it was given, and defaults to public when omitted", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const restricted = await seedAgendaItem(db, town, meetingId);
        const defaulted = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A3"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        await caller.exhibit.link({
          boardId: town.boardId,
          agendaItemId: restricted,
          ...VALID_LINK_FIELDS,
          visibility: "board_only",
        });
        await caller.exhibit.link({
          boardId: town.boardId,
          agendaItemId: defaulted,
          ...VALID_LINK_FIELDS,
        });

        expect((await readExhibits(db, town, restricted))[0]?.visibility).toBe("board_only");
        expect((await readExhibits(db, town, defaulted))[0]?.visibility).toBe("public");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * `sort_order` is computed as MAX + 1 over the item's existing exhibits,
   * server-side, matching `createExhibitFromUpload` — not the raw insert's
   * `exhibits.length` off a client-side array, which duplicates the moment
   * that array is stale.
   */
  it("appends after the item's existing exhibits, computing sort_order server-side", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        await seedExhibit(db, town, itemId, { title: "Already there", sortOrder: 4 });
        const clerk = await seedActor(db, town, { role: "staff", global: ["A3"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.exhibit.link({
          boardId: town.boardId,
          agendaItemId: itemId,
          ...VALID_LINK_FIELDS,
        });

        const rows = await readExhibits(db, town, itemId);
        expect(rows.find((r) => r.id === result.id)?.sort_order).toBe(5);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * `ExhibitRow.tsx` renders `file_storage_path` straight into an `href`, so
   * a `javascript:` or `data:` URL stored here is a stored XSS in the agenda
   * builder. `z.string().url()` accepts both; the schema requires an
   * `http`/`https` prefix instead. BAD_REQUEST, not FORBIDDEN — this caller
   * IS authorized, the value is not acceptable.
   */
  it("refuses a javascript: URL with BAD_REQUEST, from an otherwise-authorized caller", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A3"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.exhibit.link({
            boardId: town.boardId,
            agendaItemId: itemId,
            ...VALID_LINK_FIELDS,
            url: "javascript:alert(1)",
          }),
        );
        expect(err.code).toBe("BAD_REQUEST");
        expect(await readExhibits(db, town, itemId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The linked row is readable through this router's own read, and carries
   * the shape `ExhibitRow.tsx` branches on — the two procedures agreeing is
   * what Task 3 wires against.
   */
  it("is visible through byMeeting immediately, as a url-type exhibit", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const clerk = await seedActor(db, town, { role: "staff", global: ["A3"] });
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { id } = await caller.exhibit.link({
          boardId: town.boardId,
          agendaItemId: itemId,
          ...VALID_LINK_FIELDS,
        });

        const rows = await caller.exhibit.byMeeting({ meetingId });
        expect(rows.map((r) => r.id)).toEqual([id]);
        expect(rows[0]?.file_type).toBe("url");
        expect(rows[0]?.file_storage_path).toBe(VALID_LINK_FIELDS.url);
      } finally {
        await app.end();
      }
    });
  });
});
