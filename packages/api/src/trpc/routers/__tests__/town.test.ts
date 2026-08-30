/**
 * `town.detail` — read-only, tenancy-only, no input.
 *
 * Same connection discipline as `board.test.ts`: every case here runs through
 * `connectAsAppRole`, not the owner connection `withTestDb` hands back. The
 * owner is a superuser in every supported setup, so RLS does not bind it —
 * an assertion written on that handle would pass even if the tenant scoping
 * were broken outright.
 *
 * `town.detail` differs from `board.detail` in one way that matters for what
 * gets tested here: it takes no `townId` input. The row it resolves is
 * always `ctx.tenant.townId`, so there is no id for a caller to guess or
 * substitute, and no `NOT_FOUND`-for-a-foreign-row case to prove — that
 * whole class of attack does not exist for this procedure. What CAN still be
 * wrong is the tenant bridge itself: if `ctx.withTenant`/RLS scoping broke,
 * a caller could get back another town's row without ever asking for it.
 * `does not return another town's profile` below is the shape that would
 * catch that.
 */

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import {
  seedTown,
  seedActor,
  contextFor,
  testDb,
  inTown,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";

/** Fill in every column `town.detail` selects, so the round trip is exercised. */
async function configureTown(db: TestDb, town: TownFixture): Promise<void> {
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      UPDATE town SET
        state = 'ME',
        municipality_type = 'town',
        population_range = '1000_to_2500',
        contact_name = 'Jamie Clerk',
        contact_role = 'Town Clerk',
        meeting_formality = 'semi_formal',
        minutes_style = 'summary',
        presiding_officer_default = 'chair_of_board',
        minutes_recorder_default = 'town_clerk',
        staff_roles_present = '["town_clerk", "deputy_clerk"]'::jsonb,
        seal_url = 'https://example.test/seal.png',
        retention_policy_acknowledged_at = '2026-01-15T12:00:00Z',
        minutes_workflow_configured_at = '2026-02-01T09:30:00Z'
      WHERE id = ${town.townId}
    `);
  });
}

describe("town.detail", () => {
  it("returns every configured field of the caller's own town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        await configureTown(db, town);
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const result = await caller.town.detail();

        // The two timestamptz columns come back rendered in the session's
        // own offset (not necessarily UTC/"Z"), so they are compared as
        // instants below rather than as exact strings.
        expect(result).toMatchObject({
          id: town.townId,
          name: "Newcastle",
          state: "ME",
          municipality_type: "town",
          population_range: "1000_to_2500",
          contact_name: "Jamie Clerk",
          contact_role: "Town Clerk",
          meeting_formality: "semi_formal",
          minutes_style: "summary",
          presiding_officer_default: "chair_of_board",
          minutes_recorder_default: "town_clerk",
          staff_roles_present: ["town_clerk", "deputy_clerk"],
          subdomain: "newcastle",
          seal_url: "https://example.test/seal.png",
        });
        expect(new Date(result.retention_policy_acknowledged_at!).toISOString()).toBe(
          "2026-01-15T12:00:00.000Z",
        );
        expect(new Date(result.minutes_workflow_configured_at!).toISOString()).toBe(
          "2026-02-01T09:30:00.000Z",
        );
      } finally {
        await app.end();
      }
    });
  });

  it("does not return another town's profile", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        await configureTown(db, theirs);
        const actor = await seedActor(db, mine, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        const result = await caller.town.detail();

        expect(result.name).toBe("Newcastle");
        expect(result.id).toBe(mine.townId);
        expect(result.id).not.toBe(theirs.townId);
        // `theirs` was configured with non-default values above; if the
        // tenant bridge leaked, this row would show them instead of the
        // untouched defaults `seedTown` leaves on `mine`.
        expect(result.contact_name).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers for a board_member and an admin identically, since the read is tenancy-only", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Whoville");

        const boardMember = await seedActor(db, town, { role: "board_member", global: [] });
        const admin = await seedActor(db, town, { role: "admin", global: [] });

        const asBoardMember = appRouter.createCaller(contextFor(db, town, boardMember));
        const asAdmin = appRouter.createCaller(contextFor(db, town, admin));

        const [fromBoardMember, fromAdmin] = await Promise.all([
          asBoardMember.town.detail(),
          asAdmin.town.detail(),
        ]);

        expect(fromBoardMember).toEqual(fromAdmin);
      } finally {
        await app.end();
      }
    });
  });
});
