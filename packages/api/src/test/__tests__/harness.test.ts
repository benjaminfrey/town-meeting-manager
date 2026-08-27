import { describe, it, expect } from "vitest";
import { withTestDb } from "../db-harness.js";

describe("db harness", () => {
  it("provisions an isolated database with the schema applied", async () => {
    await withTestDb(async (sql) => {
      const rows =
        await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
      expect(rows[0]!.n).toBeGreaterThanOrEqual(26);
    });
  });

  it("gives each test a database that cannot see another test's writes", async () => {
    await withTestDb(async (a) => {
      await a`INSERT INTO town (id, name) VALUES (gen_random_uuid(), 'Isolation A')`;

      const dbRowsA = await a`SELECT current_database()`;
      const dbA = dbRowsA[0]!.current_database;

      await withTestDb(async (b) => {
        const dbRowsB = await b`SELECT current_database()`;
        const dbB = dbRowsB[0]!.current_database;

        // The two databases must genuinely be different databases, not the
        // same connection handed back twice — otherwise this test could
        // pass trivially without proving isolation at all.
        expect(dbB).not.toBe(dbA);

        const rows = await b`SELECT count(*)::int AS n FROM town WHERE name = 'Isolation A'`;
        expect(rows[0]!.n).toBe(0);
      });
    });
  });
});
