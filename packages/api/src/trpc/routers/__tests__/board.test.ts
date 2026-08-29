/**
 * `board.detail` — read-only, tenancy-only.
 *
 * Both cases run through `connectAsAppRole`, wrapped with `testDb()` into the
 * same Drizzle handle `seedTown`/`seedActor`/`contextFor` expect. The owner
 * connection `withTestDb` hands back is a superuser in every supported setup,
 * so RLS does not bind it — a cross-tenant assertion written on that handle
 * would pass with RLS switched off entirely and prove nothing. Step 6 of the
 * task brief (see the report) proves this test can actually go red.
 */

import { describe, it, expect } from "vitest";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import { seedTown, seedActor, contextFor, seedBoard, testDb } from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";

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
});
