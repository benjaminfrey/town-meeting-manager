/**
 * In-memory SQLite database for integration tests.
 *
 * Uses better-sqlite3 to create a real SQLite database in memory,
 * with tables matching the PowerSync schema. This lets integration
 * tests verify actual SQL queries without WASM or PowerSync runtime.
 *
 * Usage:
 *   const db = createTestDatabase();
 *   const townId = seedTown(db);
 *   const boardId = seedBoard(db, townId, { name: "Planning Board" });
 *   const rows = db.prepare("SELECT * FROM boards WHERE town_id = ?").all(townId);
 *   cleanupTestDatabase(db);
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";
export type { DatabaseType };
import { AppSchema } from "@town-meeting/shared";

// ─── Schema conversion ─────────────────────────────────────────────

/**
 * Convert PowerSync AppSchema to CREATE TABLE SQL statements.
 * PowerSync auto-provides an `id` primary key, which we replicate here.
 */
function schemaToSQL(): string[] {
  return AppSchema.tables.map((table) => {
    const columnDefs = table.columns.map((col) => {
      const sqlType = col.type ?? "TEXT";
      return `${col.name} ${sqlType}`;
    });
    // Use viewName (e.g. "towns") rather than schema key (e.g. "town")
    const tableName = (table as any).viewName ?? table.name;
    return `CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, ${columnDefs.join(", ")})`;
  });
}

// ─── Database factory ───────────────────────────────────────────────

/**
 * Create a fresh in-memory SQLite database with all PowerSync tables.
 */
export function createTestDatabase(): DatabaseType {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF"); // PowerSync doesn't enforce FKs

  const statements = schemaToSQL();
  for (const sql of statements) {
    db.exec(sql);
  }

  return db;
}

/**
 * Close the database connection and release resources.
 */
export function cleanupTestDatabase(db: DatabaseType): void {
  db.close();
}

// ─── Seed helpers ───────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Insert a town record with sensible defaults.
 */
export function seedTown(
  db: DatabaseType,
  overrides: Record<string, unknown> = {},
): string {
  const id = (overrides.id as string) ?? uuid();
  const defaults: Record<string, unknown> = {
    id,
    name: "Test Town",
    state: "ME",
    municipality_type: "town",
    population_range: "1001_5000",
    contact_name: "Test Admin",
    contact_role: "Town Clerk",
    meeting_formality: "informal",
    minutes_style: "summary",
    presiding_officer_default: "chair",
    minutes_recorder_default: "recording_secretary",
    staff_roles_present: "[]",
    subdomain: "test-town",
    seal_url: null,
    retention_policy_acknowledged_at: null,
    created_at: now(),
    updated_at: now(),
  };

  const merged = { ...defaults, ...overrides };
  const columns = Object.keys(merged);
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((k) => merged[k]);

  db.prepare(
    `INSERT INTO towns (${columns.join(", ")}) VALUES (${placeholders})`,
  ).run(...values);

  return id;
}

/**
 * Insert a board record.
 */
export function seedBoard(
  db: DatabaseType,
  townId: string,
  overrides: Record<string, unknown> = {},
): string {
  const id = (overrides.id as string) ?? uuid();
  const defaults: Record<string, unknown> = {
    id,
    town_id: townId,
    name: "Test Board",
    board_type: null,
    elected_or_appointed: "elected",
    member_count: 5,
    election_method: "at_large",
    officer_election_method: "vote_of_board",
    district_based: 0,
    staggered_terms: 0,
    is_governing_board: 0,
    meeting_formality_override: null,
    minutes_style_override: null,
    quorum_type: "simple_majority",
    quorum_value: null,
    motion_display_format: "inline_narrative",
    created_at: now(),
    archived_at: null,
  };

  const merged = { ...defaults, ...overrides };
  const columns = Object.keys(merged);
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((k) => merged[k]);

  db.prepare(
    `INSERT INTO boards (${columns.join(", ")}) VALUES (${placeholders})`,
  ).run(...values);

  return id;
}

/**
 * Insert a person and optionally a user_account. Returns both IDs.
 */
export function seedPerson(
  db: DatabaseType,
  townId: string,
  overrides: {
    person?: Record<string, unknown>;
    account?: Record<string, unknown> | false;
  } = {},
): { personId: string; userAccountId: string | null } {
  const personId = (overrides.person?.id as string) ?? uuid();

  const personDefaults: Record<string, unknown> = {
    id: personId,
    town_id: townId,
    name: "Test Person",
    email: "test@example.com",
    created_at: now(),
    archived_at: null,
  };

  const personMerged = { ...personDefaults, ...overrides.person };
  const personCols = Object.keys(personMerged);
  const personPlaceholders = personCols.map(() => "?").join(", ");
  const personValues = personCols.map((k) => personMerged[k]);

  db.prepare(
    `INSERT INTO persons (${personCols.join(", ")}) VALUES (${personPlaceholders})`,
  ).run(...personValues);

  // Skip user_account if explicitly false
  if (overrides.account === false) {
    return { personId, userAccountId: null };
  }

  const userAccountId = (overrides.account?.id as string) ?? uuid();
  const accountDefaults: Record<string, unknown> = {
    id: userAccountId,
    person_id: personId,
    town_id: townId,
    role: "admin",
    gov_title: null,
    permissions: "{}",
    auth_user_id: null,
    created_at: now(),
    archived_at: null,
  };

  const accountMerged = { ...accountDefaults, ...overrides.account };
  const accountCols = Object.keys(accountMerged);
  const accountPlaceholders = accountCols.map(() => "?").join(", ");
  const accountValues = accountCols.map((k) => accountMerged[k]);

  db.prepare(
    `INSERT INTO user_accounts (${accountCols.join(", ")}) VALUES (${accountPlaceholders})`,
  ).run(...accountValues);

  return { personId, userAccountId };
}

/**
 * Insert a board_members record.
 */
export function seedBoardMember(
  db: DatabaseType,
  personId: string,
  boardId: string,
  overrides: Record<string, unknown> = {},
): string {
  const id = (overrides.id as string) ?? uuid();
  const defaults: Record<string, unknown> = {
    id,
    person_id: personId,
    board_id: boardId,
    town_id: (overrides.town_id as string) ?? uuid(),
    seat_title: null,
    term_start: new Date().toISOString().split("T")[0],
    term_end: null,
    status: "active",
    is_default_rec_sec: 0,
    created_at: now(),
  };

  const merged = { ...defaults, ...overrides };
  const columns = Object.keys(merged);
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((k) => merged[k]);

  db.prepare(
    `INSERT INTO board_members (${columns.join(", ")}) VALUES (${placeholders})`,
  ).run(...values);

  return id;
}
