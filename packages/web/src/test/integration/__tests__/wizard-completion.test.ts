import { describe, it, expect, afterEach } from "vitest";
import {
  createTestDatabase,
  cleanupTestDatabase,
  seedTown,
  seedBoard,
  seedPerson,
  type DatabaseType,
} from "../powersync-memory";

/**
 * Integration tests for wizard completion data flow.
 *
 * Since completeWizard() uses Supabase PostgREST (not PowerSync),
 * we test the data transformations by inserting records using the
 * same field mappings and verifying the results in in-memory SQLite.
 */

describe("wizard completion data flow", () => {
  let db: DatabaseType;

  afterEach(() => {
    if (db) cleanupTestDatabase(db);
  });

  it("creates town with Stage 1 + Stage 5 fields", () => {
    db = createTestDatabase();

    // Simulate what completeWizard does: insert town from stage1 + stage5 data
    const townId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO towns (id, name, state, municipality_type, population_range, meeting_formality, minutes_style, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(townId, "Newcastle", "ME", "town", "under_1000", "informal", "summary", new Date().toISOString());

    const town = db.prepare("SELECT * FROM towns WHERE id = ?").get(townId) as Record<string, unknown>;
    expect(town.name).toBe("Newcastle");
    expect(town.state).toBe("ME");
    expect(town.municipality_type).toBe("town");
    expect(town.population_range).toBe("under_1000");
    expect(town.meeting_formality).toBe("informal");
    expect(town.minutes_style).toBe("summary");
  });

  it("creates governing board from Stage 2 data", () => {
    db = createTestDatabase();
    const townId = seedTown(db, { name: "Newcastle" });

    const boardId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO boards (id, town_id, name, member_count, election_method, is_governing_board, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(boardId, townId, "Select Board", 5, "at_large", 1, new Date().toISOString());

    const board = db.prepare("SELECT * FROM boards WHERE id = ?").get(boardId) as Record<string, unknown>;
    expect(board.name).toBe("Select Board");
    expect(board.member_count).toBe(5);
    expect(board.election_method).toBe("at_large");
    expect(board.is_governing_board).toBe(1); // SQLite boolean
    expect(board.town_id).toBe(townId);
  });

  it("creates additional boards from Stage 4 checked entries", () => {
    db = createTestDatabase();
    const townId = seedTown(db, { name: "Newcastle" });

    // Simulate Stage 4: two checked boards
    const checkedBoards = [
      { name: "Planning Board", memberCount: 5, electedOrAppointed: "elected" },
      { name: "Conservation Commission", memberCount: 5, electedOrAppointed: "appointed" },
    ];

    for (const b of checkedBoards) {
      db.prepare(`
        INSERT INTO boards (id, town_id, name, member_count, elected_or_appointed, is_governing_board, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), townId, b.name, b.memberCount, b.electedOrAppointed, 0, new Date().toISOString());
    }

    const boards = db.prepare("SELECT * FROM boards WHERE town_id = ? AND is_governing_board = 0").all(townId);
    expect(boards).toHaveLength(2);
    expect((boards[0] as Record<string, unknown>).name).toBe("Planning Board");
    expect((boards[1] as Record<string, unknown>).name).toBe("Conservation Commission");
  });

  it("creates person and user_account records", () => {
    db = createTestDatabase();
    const townId = seedTown(db, { name: "Newcastle" });

    const userId = crypto.randomUUID();
    // Simulate person + account creation
    db.prepare(`
      INSERT INTO persons (id, town_id, name, email, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, townId, "Jane Smith", "jane@test.com", new Date().toISOString());

    db.prepare(`
      INSERT INTO user_accounts (id, person_id, town_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, userId, townId, "admin", new Date().toISOString());

    const person = db.prepare("SELECT * FROM persons WHERE id = ?").get(userId) as Record<string, unknown>;
    const account = db.prepare("SELECT * FROM user_accounts WHERE id = ?").get(userId) as Record<string, unknown>;

    expect(person.name).toBe("Jane Smith");
    expect(person.town_id).toBe(townId);
    expect(account.role).toBe("admin");
    expect(account.town_id).toBe(townId);
    expect(account.person_id).toBe(userId);
  });

  it("all records share the same town_id", () => {
    db = createTestDatabase();
    const townId = seedTown(db, { name: "Newcastle" });
    const boardId = seedBoard(db, townId, { name: "Select Board" });
    const { personId } = seedPerson(db, townId, {
      person: { name: "Jane Smith" },
      account: { role: "admin" },
    });

    // Verify everything is linked
    const town = db.prepare("SELECT id FROM towns WHERE id = ?").get(townId);
    const board = db.prepare("SELECT town_id FROM boards WHERE id = ?").get(boardId) as Record<string, unknown>;
    const person = db.prepare("SELECT town_id FROM persons WHERE id = ?").get(personId) as Record<string, unknown>;

    expect(town).toBeTruthy();
    expect(board.town_id).toBe(townId);
    expect(person.town_id).toBe(townId);
  });
});
