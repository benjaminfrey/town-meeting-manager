import { describe, expect, it, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createTestDatabase,
  cleanupTestDatabase,
  seedTown,
  seedBoard,
  seedPerson,
  seedBoardMember,
} from "../powersync-memory";

describe("in-memory SQLite integration", () => {
  let db: DatabaseType;

  afterEach(() => {
    if (db) {
      cleanupTestDatabase(db);
    }
  });

  it("creates a database with all PowerSync tables", () => {
    db = createTestDatabase();

    // Check that key tables exist by querying sqlite_master
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("towns");
    expect(tableNames).toContain("boards");
    expect(tableNames).toContain("persons");
    expect(tableNames).toContain("user_accounts");
    expect(tableNames).toContain("board_members");
    expect(tableNames).toContain("meetings");
    expect(tableNames).toContain("motions");
    expect(tableNames).toContain("invitations");
  });

  it("seeds and queries a town", () => {
    db = createTestDatabase();
    const townId = seedTown(db, { name: "Newcastle" });

    const town = db
      .prepare("SELECT * FROM towns WHERE id = ?")
      .get(townId) as Record<string, unknown>;

    expect(town).toBeDefined();
    expect(town.name).toBe("Newcastle");
    expect(town.state).toBe("ME");
    expect(town.municipality_type).toBe("town");
  });

  it("seeds and queries a board for a town", () => {
    db = createTestDatabase();
    const townId = seedTown(db);
    const boardId = seedBoard(db, townId, {
      name: "Planning Board",
      member_count: 7,
      is_governing_board: 0,
    });

    const boards = db
      .prepare("SELECT * FROM boards WHERE town_id = ?")
      .all(townId) as Record<string, unknown>[];

    expect(boards).toHaveLength(1);
    expect(boards[0]!.name).toBe("Planning Board");
    expect(boards[0]!.member_count).toBe(7);
    expect(boards[0]!.id).toBe(boardId);
  });

  it("seeds a person with user account", () => {
    db = createTestDatabase();
    const townId = seedTown(db);
    const { personId, userAccountId } = seedPerson(db, townId, {
      person: { name: "Jane Smith", email: "jane@test.com" },
      account: { role: "admin", gov_title: "Town Clerk" },
    });

    const person = db
      .prepare("SELECT * FROM persons WHERE id = ?")
      .get(personId) as Record<string, unknown>;
    const account = db
      .prepare("SELECT * FROM user_accounts WHERE id = ?")
      .get(userAccountId!) as Record<string, unknown>;

    expect(person.name).toBe("Jane Smith");
    expect(person.email).toBe("jane@test.com");
    expect(account.role).toBe("admin");
    expect(account.gov_title).toBe("Town Clerk");
    expect(account.person_id).toBe(personId);
  });

  it("seeds a person without user account", () => {
    db = createTestDatabase();
    const townId = seedTown(db);
    const { personId, userAccountId } = seedPerson(db, townId, {
      person: { name: "No Account" },
      account: false,
    });

    expect(personId).toBeTruthy();
    expect(userAccountId).toBeNull();

    const accounts = db
      .prepare("SELECT * FROM user_accounts WHERE person_id = ?")
      .all(personId);
    expect(accounts).toHaveLength(0);
  });

  it("seeds board members and queries by board", () => {
    db = createTestDatabase();
    const townId = seedTown(db);
    const boardId = seedBoard(db, townId, { name: "Select Board" });
    const { personId: p1 } = seedPerson(db, townId, {
      person: { name: "Alice", email: "alice@test.com" },
    });
    const { personId: p2 } = seedPerson(db, townId, {
      person: { name: "Bob", email: "bob@test.com" },
    });

    seedBoardMember(db, p1, boardId, {
      town_id: townId,
      seat_title: "Chair",
      is_default_rec_sec: 0,
    });
    seedBoardMember(db, p2, boardId, {
      town_id: townId,
      seat_title: null,
      is_default_rec_sec: 1,
    });

    const members = db
      .prepare(
        "SELECT bm.*, p.name FROM board_members bm, persons p WHERE bm.board_id = ? AND bm.person_id = p.id",
      )
      .all(boardId) as Record<string, unknown>[];

    expect(members).toHaveLength(2);
    expect(members.map((m) => m.name)).toContain("Alice");
    expect(members.map((m) => m.name)).toContain("Bob");
  });

  it("supports real SQL queries matching app patterns", () => {
    db = createTestDatabase();
    const townId = seedTown(db);
    const boardId = seedBoard(db, townId);
    const { personId } = seedPerson(db, townId);
    seedBoardMember(db, personId, boardId, {
      town_id: townId,
      status: "active",
    });

    // This is the exact query used in BoardDetailPage
    const result = db
      .prepare(
        "SELECT COUNT(*) as count FROM board_members WHERE board_id = ? AND status = 'active'",
      )
      .get(boardId) as { count: number };

    expect(result.count).toBe(1);
  });
});
