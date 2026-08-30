/**
 * `boardMember.memberCount` / `.roster` / `.searchCandidates` /
 * `.personEmailExists` / `.addBoardMember` / `.addStaffMember`.
 *
 * `memberCount`'s two tests are MOVED from `board.test.ts`, unchanged, now
 * that `board-member.ts` exists as their home — see that router's own
 * header.
 *
 * `addBoardMember`/`addStaffMember` carry this task's central hazard tests:
 * both take a client-supplied `personId` that becomes a foreign key on a NEW
 * `user_account` row, and `addBoardMember` ALSO takes a client-supplied
 * `boardId` that becomes a foreign key on a NEW `board_member` row. Postgres
 * FK enforcement bypasses row security, so each is tested directly by
 * attempting the cross-tenant write and confirming it is refused with
 * NOT_FOUND rather than silently succeeding — the same shape
 * `person.test.ts`'s `insertStaffAccount` suite already proved for
 * `personId` alone, reproduced here for both ids.
 *
 * Same connection discipline as `board.test.ts`/`person.test.ts`: every case
 * runs through `connectAsAppRole`, never the owner connection `withTestDb`
 * hands back.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import {
  seedTown,
  seedActor,
  seedBoard,
  seedBoardSeat,
  contextFor,
  testDb,
  inTown,
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import { toRows } from "../../../db/rows.js";

/** A person with no user_account. */
async function seedPerson(
  db: TestDb,
  town: TownFixture,
  name: string,
  email?: string,
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO person (id, town_id, name, email)
      VALUES (${id}, ${town.townId}, ${name}, ${email ?? `${id.slice(0, 8)}@example.test`})
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
  await seedBoardSeat(db, town, personId, boardId, status);
}

interface AccountRow {
  id: string;
  role: string;
  gov_title: string | null;
  permissions: unknown;
  person_id: string;
  archived_at: string | null;
}

async function readAccountByPerson(
  db: TestDb,
  town: TownFixture,
  personId: string,
): Promise<AccountRow | undefined> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT id, role, gov_title, permissions, person_id, archived_at
              FROM user_account WHERE person_id = ${personId}`,
      )
      .then((r) => toRows<AccountRow>(r, (m) => new Error(m))),
  );
  return rows[0];
}

async function countAccountsForPerson(
  db: TestDb,
  town: TownFixture,
  personId: string,
): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT id FROM user_account WHERE person_id = ${personId}`)
      .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
  );
  return rows.length;
}

async function countBoardMembers(
  db: TestDb,
  town: TownFixture,
  personId: string,
  boardId: string,
): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT id FROM board_member WHERE person_id = ${personId} AND board_id = ${boardId}`,
      )
      .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
  );
  return rows.length;
}

async function countInvitationsForPerson(
  db: TestDb,
  town: TownFixture,
  personId: string,
): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT id FROM invitation WHERE person_id = ${personId}`)
      .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
  );
  return rows.length;
}

async function seedInvitation(
  db: TestDb,
  town: TownFixture,
  personId: string,
  userAccountId: string | null,
  createdAt: string,
): Promise<string> {
  const token = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO invitation (person_id, user_account_id, town_id, token, status, created_at)
      VALUES (${personId}, ${userAccountId}, ${town.townId}, ${token}, 'pending', ${createdAt}::timestamptz)
    `);
  });
  return token;
}

describe("boardMember.memberCount", () => {
  it("counts every board_member row in the town, active AND archived", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const p1 = await seedPerson(db, town, "Active One");
        const p2 = await seedPerson(db, town, "Former Member");
        await seedBoardMember(db, town, boardId, p1, "active");
        // Archived, deliberately NOT excluded — see this procedure's own
        // doc comment: unlike `stats.active_members`, this count has no
        // `status = 'active'` filter. A reintroduced `AND status = 'active'`
        // would make this test see 1, not 2.
        await seedBoardMember(db, town, boardId, p2, "archived");
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const count = await caller.boardMember.memberCount();

        expect(count).toBe(2);
        expect(typeof count).toBe("number");
      } finally {
        await app.end();
      }
    });
  });

  it("does not count another town's board_member rows", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirBoard = await seedBoard(db, theirs, { name: "Their Committee" });
        const theirPerson = await seedPerson(db, theirs, "Their Member");
        await seedBoardMember(db, theirs, theirBoard, theirPerson, "active");
        const actor = await seedActor(db, mine, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        expect(await caller.boardMember.memberCount()).toBe(0);
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.roster", () => {
  it("joins person, account and the most recent invitation for each seat", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const personId = await seedPerson(db, town, "Jamie Clerk", "jamie@example.test");
        await seedBoardMember(db, town, boardId, personId, "active");
        const staff = await seedActor(db, town, { role: "staff", global: [] });
        await inTown(db, town, (tx) =>
          tx.execute(
            sql`UPDATE user_account SET person_id = ${personId} WHERE id = ${staff.userAccountId}`,
          ),
        );
        // Older invitation, then a newer one — the newer must win.
        await seedInvitation(db, town, personId, staff.userAccountId, "2026-01-01T00:00:00Z");
        const latestToken = await seedInvitation(
          db,
          town,
          personId,
          staff.userAccountId,
          "2026-06-01T00:00:00Z",
        );
        const actor = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.boardMember.roster({ boardId });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          person_id: personId,
          name: "Jamie Clerk",
          email: "jamie@example.test",
          status: "active",
          user_account_id: staff.userAccountId,
          invitation_token: latestToken,
        });
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
        const theirBoard = await seedBoard(db, theirs, { name: "Their Committee" });
        const actor = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        const err = await expectTrpcError(() => caller.boardMember.roster({ boardId: theirBoard }));
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.searchCandidates", () => {
  it("matches by name or email, and excludes an active member of this board", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const match = await seedPerson(db, town, "Casey Match", "casey@example.test");
        const noMatch = await seedPerson(db, town, "Riley Other", "riley@example.test");
        const alreadyOnBoard = await seedPerson(db, town, "Casey Seated", "seated@example.test");
        await seedBoardMember(db, town, boardId, alreadyOnBoard, "active");
        const actor = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.boardMember.searchCandidates({ boardId, query: "casey" });

        const ids = rows.map((r) => r.id);
        expect(ids).toContain(match);
        expect(ids).not.toContain(noMatch);
        expect(ids).not.toContain(alreadyOnBoard);
      } finally {
        await app.end();
      }
    });
  });

  it("does NOT exclude a person whose membership on this board is archived", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const formerMember = await seedPerson(db, town, "Casey Former", "former@example.test");
        await seedBoardMember(db, town, boardId, formerMember, "archived");
        const actor = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.boardMember.searchCandidates({ boardId, query: "casey" });

        expect(rows.map((r) => r.id)).toContain(formerMember);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Review-round fix: a person whose ONLY account is archived must come back
   * as account-less (`role: null`, `user_account_id: null`), matching what
   * `AddMemberDialog.tsx`'s original Supabase read did
   * (`.is("archived_at", null)` on `user_account`). Without this filter, the
   * client would surface the archived account's role/id, which is the same
   * "silently reuse an archived account" shape the review caught in
   * `addBoardMember` — this is that read's own half of the fix.
   */
  it("does not surface a person's ARCHIVED account — they come back account-less", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const archivedActor = await seedActor(db, town, { role: "board_member", global: [] });
        await inTown(db, town, (tx) =>
          tx.execute(
            sql`UPDATE person SET name = 'Casey Archived' WHERE id = ${archivedActor.personId}`,
          ),
        );
        await inTown(db, town, (tx) =>
          tx.execute(
            sql`UPDATE user_account SET archived_at = now() WHERE id = ${archivedActor.userAccountId}`,
          ),
        );
        const actor = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.boardMember.searchCandidates({ boardId, query: "casey" });

        const row = rows.find((r) => r.id === archivedActor.personId);
        expect(row).toMatchObject({ role: null, user_account_id: null });
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
        const theirBoard = await seedBoard(db, theirs, { name: "Their Committee" });
        const actor = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        const err = await expectTrpcError(() =>
          caller.boardMember.searchCandidates({ boardId: theirBoard, query: "casey" }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.personEmailExists", () => {
  it("answers true for an email already used in the town, case- and whitespace-insensitively", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        await seedPerson(db, town, "Taken", "taken@example.test");
        const actor = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        expect(await caller.boardMember.personEmailExists({ email: "Taken@Example.Test" })).toBe(
          true,
        );
        expect(await caller.boardMember.personEmailExists({ email: "nobody@example.test" })).toBe(
          false,
        );
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.addBoardMember", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const personId = await seedPerson(db, town, "New Seat");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.boardMember.addBoardMember({
              personId,
              boardId,
              seatTitle: null,
              termStart: "2026-01-01",
              termEnd: null,
              govTitle: null,
              isDefaultRecSec: false,
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await countBoardMembers(db, town, personId, boardId)).toBe(0);
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

        // `personId`/`boardId` fail `.uuid()` — this middleware never reads
        // them (`requireActor`), so the malformed fields only prove the
        // guard runs before the parser.
        const err = await expectTrpcError(() =>
          caller.boardMember.addBoardMember({
            personId: "not-a-uuid",
            boardId: "not-a-uuid",
            seatTitle: null,
            termStart: "2026-01-01",
            termEnd: null,
            govTitle: null,
            isDefaultRecSec: false,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Hazard 1, `personId` half: attempt the cross-tenant write directly.
   * Without `assertPersonExists`, `user_account_person_id_fkey` alone would
   * let this succeed — the FK only checks the row EXISTS somewhere, not that
   * it belongs to the caller's town, per Postgres's own docs on FK
   * enforcement bypassing row security.
   */
  it("answers NOT_FOUND for a personId belonging to another town, and creates no account or seat", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const boardId = await seedBoard(db, mine, { name: "Assessors" });
        const theirPersonId = await seedPerson(db, theirs, "Their Person");
        const admin = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addBoardMember({
            personId: theirPersonId,
            boardId,
            seatTitle: null,
            termStart: "2026-01-01",
            termEnd: null,
            govTitle: null,
            isDefaultRecSec: false,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countAccountsForPerson(db, theirs, theirPersonId)).toBe(0);
        expect(await countBoardMembers(db, theirs, theirPersonId, boardId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * Hazard 1, `boardId` half — the same attack against the OTHER
   * client-supplied id this procedure inserts a foreign key from.
   */
  it("answers NOT_FOUND for a boardId belonging to another town, and creates no seat", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const personId = await seedPerson(db, mine, "My Person");
        const theirBoardId = await seedBoard(db, theirs, { name: "Their Committee" });
        const admin = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addBoardMember({
            personId,
            boardId: theirBoardId,
            seatTitle: null,
            termStart: "2026-01-01",
            termEnd: null,
            govTitle: null,
            isDefaultRecSec: false,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countAccountsForPerson(db, mine, personId)).toBe(0);
        expect(await countBoardMembers(db, mine, personId, theirBoardId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("seats a new person: creates a board_member-role account, the seat, and an invitation", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const personId = await seedPerson(db, town, "New Seat");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const result = await caller.boardMember.addBoardMember({
          personId,
          boardId,
          seatTitle: "Chair",
          termStart: "2026-01-01",
          termEnd: null,
          govTitle: "  Selectman  ",
          isDefaultRecSec: false,
        });
        expect(result.name).toBe("New Seat");

        const account = await readAccountByPerson(db, town, personId);
        expect(account).toMatchObject({ role: "board_member", gov_title: "Selectman" });
        expect(account?.permissions).toEqual({ global: {}, board_overrides: [] });

        expect(await countBoardMembers(db, town, personId, boardId)).toBe(1);
        expect(await countInvitationsForPerson(db, town, personId)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  it("unsets a previous default recording secretary on the same board", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const existingPerson = await seedPerson(db, town, "Current Rec Sec");
        await inTown(db, town, (tx) =>
          tx.execute(sql`
            INSERT INTO board_member (person_id, board_id, town_id, term_start, status, is_default_rec_sec)
            VALUES (${existingPerson}, ${boardId}, ${town.townId}, CURRENT_DATE, 'active', true)
          `),
        );
        const newPerson = await seedPerson(db, town, "New Rec Sec");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.boardMember.addBoardMember({
          personId: newPerson,
          boardId,
          seatTitle: null,
          termStart: "2026-01-01",
          termEnd: null,
          govTitle: null,
          isDefaultRecSec: true,
        });

        const rows = await inTown(db, town, (tx) =>
          tx
            .execute(
              sql`SELECT person_id, is_default_rec_sec FROM board_member WHERE board_id = ${boardId}`,
            )
            .then((r) =>
              toRows<{ person_id: string; is_default_rec_sec: boolean }>(r, (m) => new Error(m)),
            ),
        );
        const byPerson = new Map(rows.map((r) => [r.person_id, r.is_default_rec_sec]));
        expect(byPerson.get(existingPerson)).toBe(false);
        expect(byPerson.get(newPerson)).toBe(true);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The mutual-exclusivity refusal — Maine 30-A M.R.S.A. §2605 — checked
   * against the ACTUAL account role in the database, not whatever the
   * client believes. See this router's own header for why this check exists
   * independently of the client-side `checkRoleMutualExclusivity` call.
   */
  it("answers CONFLICT when the person's existing account is staff, and seats no one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const staff = await seedActor(db, town, { role: "staff", global: [] });
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addBoardMember({
            personId: staff.personId,
            boardId,
            seatTitle: null,
            termStart: "2026-01-01",
            termEnd: null,
            govTitle: null,
            isDefaultRecSec: false,
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await countBoardMembers(db, town, staff.personId, boardId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("reuses the existing board_member-role account for a second seat, without creating a duplicate", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const firstBoard = await seedBoard(db, town, { name: "Assessors" });
        const secondBoard = await seedBoard(db, town, { name: "Planning" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, firstBoard, boardMember.personId, "active");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.boardMember.addBoardMember({
          personId: boardMember.personId,
          boardId: secondBoard,
          seatTitle: null,
          termStart: "2026-01-01",
          termEnd: null,
          govTitle: null,
          isDefaultRecSec: false,
        });

        expect(await countAccountsForPerson(db, town, boardMember.personId)).toBe(1);
        expect(await countBoardMembers(db, town, boardMember.personId, secondBoard)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The review-round defect, reproduced directly: seat a person whose ONLY
   * `user_account` row is an ARCHIVED `board_member`-role account (the exact
   * state `MemberArchiveDialog`'s "also archive user account" leaves behind,
   * or a person removed from every board and later re-added). Before the
   * fix, `addBoardMember` reused that row's id without clearing
   * `archived_at` — the person was seated and invited, but
   * `tenant-context.ts` refuses a session for any `archived_at IS NOT NULL`
   * account, so they could accept the invitation and never get a session,
   * with no error anywhere. Asserts the account is un-archived, not just
   * that the seat and invitation exist — that is the exact distinction the
   * defect hid behind.
   */
  it("reactivates an archived board_member-role account when reusing it for a new seat", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await inTown(db, town, (tx) =>
          tx.execute(
            sql`UPDATE user_account SET archived_at = now() WHERE id = ${boardMember.userAccountId}`,
          ),
        );
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.boardMember.addBoardMember({
          personId: boardMember.personId,
          boardId,
          seatTitle: null,
          termStart: "2026-01-01",
          termEnd: null,
          govTitle: null,
          isDefaultRecSec: false,
        });

        const account = await readAccountByPerson(db, town, boardMember.personId);
        expect(account?.id).toBe(boardMember.userAccountId);
        expect(account?.archived_at).toBeNull();
        expect(await countBoardMembers(db, town, boardMember.personId, boardId)).toBe(1);
        expect(await countInvitationsForPerson(db, town, boardMember.personId)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.addStaffMember", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const personId = await seedPerson(db, town, "Future Staffer");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.boardMember.addStaffMember({
              personId,
              govTitle: null,
              permissions: { global: {}, board_overrides: [] },
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await countAccountsForPerson(db, town, personId)).toBe(0);
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
          caller.boardMember.addStaffMember({
            personId: "not-a-uuid",
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a personId belonging to another town, and creates no account", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirPersonId = await seedPerson(db, theirs, "Their Person");
        const admin = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addStaffMember({
            personId: theirPersonId,
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countAccountsForPerson(db, theirs, theirPersonId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("creates a staff account with the permissions matrix written exactly as sent, plus an invitation", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const personId = await seedPerson(db, town, "Future Staffer");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        // Deliberately mixed spelling — a CODE and a NAME — the exact shape
        // `normalisePermissionsMatrix` exists to reconcile on READ. This
        // procedure must not "fix" it on write.
        const result = await caller.boardMember.addStaffMember({
          personId,
          govTitle: "  Deputy Clerk  ",
          permissions: { global: { A2: true, edit_minutes: true }, board_overrides: [] },
        });
        expect(result.name).toBe("Future Staffer");

        const account = await readAccountByPerson(db, town, personId);
        expect(account).toMatchObject({ role: "staff", gov_title: "Deputy Clerk" });
        expect(account?.permissions).toEqual({
          global: { A2: true, edit_minutes: true },
          board_overrides: [],
        });
        expect(await countInvitationsForPerson(db, town, personId)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when the person already has an account, and creates no new invitation", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const existing = await seedActor(db, town, { role: "board_member", global: [] });
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addStaffMember({
            personId: existing.personId,
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await countAccountsForPerson(db, town, existing.personId)).toBe(1);
        expect(await countInvitationsForPerson(db, town, existing.personId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });
});

/** `board_member.status` for one row, for asserting the archive actually landed. */
async function readSeatStatus(
  db: TestDb,
  town: TownFixture,
  boardMemberId: string,
): Promise<string | undefined> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT status FROM board_member WHERE id = ${boardMemberId}`)
      .then((r) => toRows<{ status: string }>(r, (m) => new Error(m))),
  );
  return rows[0]?.status;
}

describe("boardMember.otherActiveCount", () => {
  it("counts active seats on OTHER boards, excluding the named board and archived seats", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardA = await seedBoard(db, town, { name: "Assessors" });
        const boardB = await seedBoard(db, town, { name: "Planning" });
        const boardC = await seedBoard(db, town, { name: "Library" });
        const personId = await seedPerson(db, town, "Multi Seat");
        await seedBoardMember(db, town, boardA, personId, "active");
        await seedBoardMember(db, town, boardB, personId, "active");
        await seedBoardMember(db, town, boardC, personId, "archived");
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const count = await caller.boardMember.otherActiveCount({
          personId,
          excludeBoardId: boardA,
        });

        expect(count).toBe(1);
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.archiveMembership", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const personId = await seedPerson(db, town, "Seated");
        await seedBoardMember(db, town, boardId, personId, "active");
        // `seedBoardMember` (this file's local wrapper) does not return the
        // id; fetch it back directly.
        const [row] = await inTown(db, town, (tx) =>
          tx
            .execute(sql`SELECT id FROM board_member WHERE person_id = ${personId}`)
            .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
        );
        const boardMemberId = row!.id;

        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const err = await expectTrpcError(() =>
          caller.boardMember.archiveMembership({ boardMemberId, archiveAccount: false }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readSeatStatus(db, town, boardMemberId)).toBe("active");
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
          caller.boardMember.archiveMembership({
            boardMemberId: "not-a-uuid",
            archiveAccount: false,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a boardMemberId in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirBoard = await seedBoard(db, theirs, { name: "Their Committee" });
        const theirPerson = await seedPerson(db, theirs, "Their Member");
        await seedBoardMember(db, theirs, theirBoard, theirPerson, "active");
        const [theirRow] = await inTown(db, theirs, (tx) =>
          tx
            .execute(sql`SELECT id FROM board_member WHERE person_id = ${theirPerson}`)
            .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
        );
        const admin = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.archiveMembership({
            boardMemberId: theirRow!.id,
            archiveAccount: false,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readSeatStatus(db, theirs, theirRow!.id)).toBe("active");
      } finally {
        await app.end();
      }
    });
  });

  it("archives the seat and sets term_end to today, leaving the account untouched by default", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, boardId, boardMember.personId, "active");
        const [row] = await inTown(db, town, (tx) =>
          tx
            .execute(
              sql`SELECT id FROM board_member WHERE person_id = ${boardMember.personId} AND board_id = ${boardId}`,
            )
            .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
        );
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const result = await caller.boardMember.archiveMembership({
          boardMemberId: row!.id,
          archiveAccount: false,
        });

        expect(result.archivedAccount).toBe(false);
        expect(await readSeatStatus(db, town, row!.id)).toBe("archived");
        const account = await readAccountByPerson(db, town, boardMember.personId);
        expect(account?.archived_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("also archives the account when requested and no other active membership exists", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, boardId, boardMember.personId, "active");
        const [row] = await inTown(db, town, (tx) =>
          tx
            .execute(
              sql`SELECT id FROM board_member WHERE person_id = ${boardMember.personId} AND board_id = ${boardId}`,
            )
            .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
        );
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const result = await caller.boardMember.archiveMembership({
          boardMemberId: row!.id,
          archiveAccount: true,
        });

        expect(result.archivedAccount).toBe(true);
        const account = await readAccountByPerson(db, town, boardMember.personId);
        expect(account?.archived_at).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The recompute-not-trust half: even if a caller sends `archiveAccount:
   * true`, a second ACTIVE seat on another board must stop the account from
   * being archived — the exact gate the client's own UI enforces by
   * disabling the toggle, reproduced here against the real database rather
   * than assumed from the client sending the "right" value.
   */
  it("does NOT archive the account when another active membership exists, even if archiveAccount is sent true", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardA = await seedBoard(db, town, { name: "Assessors" });
        const boardB = await seedBoard(db, town, { name: "Planning" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, boardA, boardMember.personId, "active");
        await seedBoardMember(db, town, boardB, boardMember.personId, "active");
        const [row] = await inTown(db, town, (tx) =>
          tx
            .execute(
              sql`SELECT id FROM board_member WHERE person_id = ${boardMember.personId} AND board_id = ${boardA}`,
            )
            .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
        );
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const result = await caller.boardMember.archiveMembership({
          boardMemberId: row!.id,
          archiveAccount: true,
        });

        expect(result.archivedAccount).toBe(false);
        const account = await readAccountByPerson(db, town, boardMember.personId);
        expect(account?.archived_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.addToBoard", () => {
  it("refuses a caller who is not an administrator, and seats no one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Planning" });
        const personId = await seedPerson(db, town, "Existing Member");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.boardMember.addToBoard({ personId, boardId }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await countBoardMembers(db, town, personId, boardId)).toBe(0);
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
          caller.boardMember.addToBoard({ personId: "not-a-uuid", boardId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a personId belonging to another town, and seats no one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const boardId = await seedBoard(db, mine, { name: "Planning" });
        const theirPersonId = await seedPerson(db, theirs, "Their Person");
        const admin = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addToBoard({ personId: theirPersonId, boardId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countBoardMembers(db, theirs, theirPersonId, boardId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a boardId belonging to another town, and seats no one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const personId = await seedPerson(db, mine, "My Person");
        const theirBoardId = await seedBoard(db, theirs, { name: "Their Committee" });
        const admin = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addToBoard({ personId, boardId: theirBoardId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countBoardMembers(db, mine, personId, theirBoardId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("adds an active seat for an existing person, without touching their account", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const firstBoard = await seedBoard(db, town, { name: "Assessors" });
        const secondBoard = await seedBoard(db, town, { name: "Planning" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, firstBoard, boardMember.personId, "active");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.boardMember.addToBoard({
          personId: boardMember.personId,
          boardId: secondBoard,
        });

        expect(await countBoardMembers(db, town, boardMember.personId, secondBoard)).toBe(1);
        expect(await countAccountsForPerson(db, town, boardMember.personId)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when the person already has an active seat on this board", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, boardId, boardMember.personId, "active");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.addToBoard({ personId: boardMember.personId, boardId }),
        );
        expect(err.code).toBe("CONFLICT");
      } finally {
        await app.end();
      }
    });
  });
});

describe("boardMember.convertToStaff", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, boardId, boardMember.personId, "active");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.boardMember.convertToStaff({
              personId: boardMember.personId,
              govTitle: null,
              permissions: { global: {}, board_overrides: [] },
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const account = await readAccountByPerson(db, town, boardMember.personId);
        expect(account?.role).toBe("board_member");
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
          caller.boardMember.convertToStaff({
            personId: "not-a-uuid",
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a personId belonging to another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirPersonId = await seedPerson(db, theirs, "Their Person");
        const admin = await seedActor(db, mine, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, mine, admin));
        const err = await expectTrpcError(() =>
          caller.boardMember.convertToStaff({
            personId: theirPersonId,
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countAccountsForPerson(db, theirs, theirPersonId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("archives every active board seat and UPDATES the existing account in place — not archive-then-insert", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        await seedBoardMember(db, town, boardId, boardMember.personId, "active");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.boardMember.convertToStaff({
          personId: boardMember.personId,
          govTitle: "  Deputy Clerk  ",
          permissions: { global: { A2: true }, board_overrides: [] },
        });

        const [seat] = await inTown(db, town, (tx) =>
          tx
            .execute(sql`SELECT status FROM board_member WHERE person_id = ${boardMember.personId}`)
            .then((r) => toRows<{ status: string }>(r, (m) => new Error(m))),
        );
        expect(seat?.status).toBe("archived");

        // Same account id — proves UPDATE in place, not archive-then-insert.
        const account = await readAccountByPerson(db, town, boardMember.personId);
        expect(account?.id).toBe(boardMember.userAccountId);
        expect(account).toMatchObject({ role: "staff", gov_title: "Deputy Clerk" });
        expect(account?.archived_at).toBeNull();
        expect(account?.permissions).toEqual({ global: { A2: true }, board_overrides: [] });
        expect(await countAccountsForPerson(db, town, boardMember.personId)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  it("creates a fresh staff account for a person with none, and archives no seat (they had none)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const personId = await seedPerson(db, town, "Accountless");
        const admin = await seedActor(db, town, { role: "admin" });

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.boardMember.convertToStaff({
          personId,
          govTitle: null,
          permissions: { global: {}, board_overrides: [] },
        });

        const account = await readAccountByPerson(db, town, personId);
        expect(account).toMatchObject({ role: "staff" });
      } finally {
        await app.end();
      }
    });
  });
});
