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
 * always `ctx.tenant.townId`, so there is no id for a CALLER to guess or
 * substitute — the id-guessing class of attack `board.detail`'s `NOT_FOUND`
 * closes (conventions item 3) does not exist for this procedure. What CAN
 * still be wrong is the tenant bridge itself: if `ctx.withTenant`/RLS
 * scoping broke, a caller could get back another town's row without ever
 * asking for it (`does not return another town's profile` below), OR the
 * bridge could hand this procedure a `townId` that names no real town at
 * all — the exact failure mode the commit immediately preceding this phase
 * ("Bridge a Better Auth session to app.town_id, and refuse when it cannot")
 * exists to guard against upstream. `answers NOT_FOUND when the tenant
 * bridge names a town that does not exist` below proves this procedure's own
 * half of that: `contextFor()` only builds a `TrpcContext` shape, it does
 * not require its `town`/`seeded` arguments to correspond to real rows, and
 * `town.detail` never calls `ctx.actor()` — so a hand-built context carrying
 * a never-seeded `townId`, with no `seedTown`/`seedActor` at all, reaches
 * the procedure exactly as a corrupted bridge would.
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

  it("answers NOT_FOUND when the tenant bridge names a town that does not exist", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        // Deliberately no `seedTown`/`seedActor`: this simulates a corrupted
        // or stale tenant bridge, not an attacker-supplied id (there is none
        // to supply — see the file header). `contextFor()` only needs its
        // `town`/`seeded` arguments to have the right SHAPE, and
        // `town.detail` never calls `ctx.actor()`, so nothing here forces a
        // real row to exist first.
        const ghostTown: TownFixture = {
          townId: randomUUID(),
          boardId: randomUUID(),
          otherBoardId: randomUUID(),
        };
        const caller = appRouter.createCaller(
          contextFor(db, ghostTown, { personId: randomUUID(), userAccountId: randomUUID() }),
        );

        await expect(caller.town.detail()).rejects.toThrow(/NOT_FOUND/);
      } finally {
        await app.end();
      }
    });
  });
});

/**
 * `town.updateProfile` / `updateMeetingDefaults` / `updateMeetingRoles` /
 * `acknowledgeRetentionPolicy` — the four writes `settings.town.tsx`'s child
 * editors make, and the first mutations conventions item 2's write-side rules
 * have ever run against (`town.setPortalAddress` was the only prior one).
 * All four share one gate, `assertCanUpdateTown` — the SAME admin-only rule
 * `setPortalAddress` already uses — so each gets the same two-test shape:
 *
 *   - a non-admin (staff, board_member) is refused, and NOTHING was written;
 *   - an admin succeeds, and the row reads back changed.
 *
 * Every refusal here was verified by mutation per conventions item 13:
 * deleting the procedure's `assertCanUpdateTown(await ctx.actor())` line and
 * re-running the file turned the matching "refuses a caller who is not an
 * administrator" test red (an admin was expected to be needed but the
 * mutation succeeded for staff/board_member too), with every other test in
 * the file unaffected. Restored byte-identical afterward; see the task
 * report for the exact diffs and output.
 */
async function readTown(
  db: TestDb,
  town: TownFixture,
): Promise<{
  name: string;
  state: string;
  municipality_type: string;
  population_range: string | null;
  contact_name: string | null;
  contact_role: string | null;
  meeting_formality: string;
  minutes_style: string;
  presiding_officer_default: string | null;
  minutes_recorder_default: string | null;
  retention_policy_acknowledged_at: string | null;
}> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`
          SELECT name, state, municipality_type, population_range, contact_name,
            contact_role, meeting_formality, minutes_style, presiding_officer_default,
            minutes_recorder_default, retention_policy_acknowledged_at
          FROM town WHERE id = ${town.townId}
        `,
      )
      .then((r) =>
        toRows<{
          name: string;
          state: string;
          municipality_type: string;
          population_range: string | null;
          contact_name: string | null;
          contact_role: string | null;
          meeting_formality: string;
          minutes_style: string;
          presiding_officer_default: string | null;
          minutes_recorder_default: string | null;
          retention_policy_acknowledged_at: string | null;
        }>(r, (m) => new Error(m)),
      ),
  );
  return rows[0]!;
}

describe("town.updateProfile", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.town.updateProfile({
              name: "Newcastle Renamed",
              state: "NH",
              municipality_type: "city",
              population_range: "over_10000",
              contact_name: "Someone Else",
              contact_role: "Impostor",
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const row = await readTown(db, town);
        expect(row.name).toBe("Newcastle");
        expect(row.state).toBe("ME");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The regression pin for the fix round that moved authorization ahead of
   * input parsing (conventions item 2, rewritten). The FIRST version of this
   * test asserted the opposite — `expect(err.code).toBe("BAD_REQUEST")` —
   * because in the old resolver-form code `assertCanUpdateTown` ran inside
   * the resolver, which tRPC calls only after `.input()` had already parsed
   * (or rejected) the body, so a non-admin who ALSO sent invalid data got
   * the parser's answer, never the guard's. `updateProfile` is now
   * `.use(requireActor(assertCanUpdateTown)).input(...)` — the guard
   * declared BEFORE the parser.
   *
   * The enforceable rule (corrected in review — see item 2 and item 13): a
   * refusal test must assert FORBIDDEN, full stop. "On input that parses"
   * was the first draft of this rule and it is too strong: it would forbid
   * the NEXT test below, which is deliberately built on input that does
   * NOT parse, because that is the only way to catch a reordered guard (see
   * that test's own comment). What actually distinguishes a real pin from a
   * vacuous one is not the input — it is the ASSERTED CODE: a test that
   * asserts `BAD_REQUEST` can stay green with the guard fully deleted (the
   * parser alone still produces `BAD_REQUEST` for bad input, guard or no
   * guard), which is exactly how the first version of THIS test failed to
   * catch its own deletion. A test that asserts `FORBIDDEN` cannot.
   *
   * This one uses valid input, so it is a clean pin for "the guard exists
   * and ran" — nothing about the parser can produce FORBIDDEN, so if this
   * passes, the guard is what answered. It does NOT, by itself, prove the
   * guard is positioned before `.input()` — see the next test for that.
   */
  it("answers FORBIDDEN on valid input from a refused caller (proves the guard ran)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.town.updateProfile({
            name: "Newcastle Renamed Again",
            state: "NH",
            municipality_type: "city",
            population_range: "over_10000",
            contact_name: "Someone Else",
            contact_role: "Impostor",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The ordering pin, on the REAL procedure — not only on the synthetic
   * router in `require-permission.test.ts`. Review finding: nothing in this
   * file caught `updateProfile`'s `.use()` being moved back after
   * `.input()` — the reviewer did exactly that, reproducing the shipped
   * defect on live code, and ran the whole package: 565 tests, all green.
   * The test above couldn't have caught it (valid input never reaches the
   * parser's failure path either way), and neither could a plain
   * "refuses a non-admin" test with any other valid payload.
   *
   * This test sends a non-admin caller AND input that fails validation (the
   * `name` regex). With the guard correctly declared before `.input()`, the
   * guard throws FORBIDDEN and the parser never runs at all — probe 1 in the
   * fix brief showed this directly: `.use(guard).input(schema)` never
   * reaches the parser when the guard refuses. If `.use()` is moved after
   * `.input()`, the parser runs FIRST and answers BAD_REQUEST before the
   * guard ever gets a chance — which is the exact regression this test
   * exists to catch. Verified directly (fix round, not a permanent
   * artifact): moved `updateProfile`'s `.use(...)` to after `.input(...)`
   * and re-ran this file — this test went red with `BAD_REQUEST`, restored
   * byte-identical. See the task report for the command and full output.
   */
  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.town.updateProfile({
            name: "Newcastle (Invalid)",
            state: "NH",
            municipality_type: "city",
            population_range: "over_10000",
            contact_name: "Someone Else",
            contact_role: "Impostor",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator update the town's profile", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.town.updateProfile({
          name: "New Castle",
          state: "NH",
          municipality_type: "city",
          population_range: "5000_to_10000",
          contact_name: "Jamie Clerk",
          contact_role: "Town Clerk",
        });
        expect(result.name).toBe("New Castle");

        const row = await readTown(db, town);
        expect(row).toMatchObject({
          name: "New Castle",
          state: "NH",
          municipality_type: "city",
          population_range: "5000_to_10000",
          contact_name: "Jamie Clerk",
          contact_role: "Town Clerk",
        });
      } finally {
        await app.end();
      }
    });
  });
});

describe("town.updateMeetingDefaults", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.town.updateMeetingDefaults({
              meeting_formality: "formal",
              minutes_style: "narrative",
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const row = await readTown(db, town);
        // `seedTown` leaves the column defaults untouched by any refused call.
        expect(row.meeting_formality).toBe("semi_formal");
        expect(row.minutes_style).toBe("action");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator update the meeting formality and minutes style defaults", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.town.updateMeetingDefaults({
          meeting_formality: "formal",
          minutes_style: "narrative",
        });

        const row = await readTown(db, town);
        expect(row.meeting_formality).toBe("formal");
        expect(row.minutes_style).toBe("narrative");
      } finally {
        await app.end();
      }
    });
  });
});

describe("town.updateMeetingRoles", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.town.updateMeetingRoles({
              presiding_officer_default: "moderator",
              minutes_recorder_default: "other_staff",
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const row = await readTown(db, town);
        expect(row.presiding_officer_default).toBeNull();
        expect(row.minutes_recorder_default).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator update the presiding officer and minutes recorder defaults", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.town.updateMeetingRoles({
          presiding_officer_default: "moderator",
          minutes_recorder_default: "other_staff",
        });

        const row = await readTown(db, town);
        expect(row.presiding_officer_default).toBe("moderator");
        expect(row.minutes_recorder_default).toBe("other_staff");
      } finally {
        await app.end();
      }
    });
  });
});

describe("town.acknowledgeRetentionPolicy", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() => caller.town.acknowledgeRetentionPolicy());
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const row = await readTown(db, town);
        expect(row.retention_policy_acknowledged_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator acknowledge the retention policy", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const before = Date.now();
        const result = await caller.town.acknowledgeRetentionPolicy();
        expect(result.retention_policy_acknowledged_at).not.toBeNull();
        expect(new Date(result.retention_policy_acknowledged_at).getTime()).toBeGreaterThanOrEqual(
          before,
        );

        const row = await readTown(db, town);
        expect(row.retention_policy_acknowledged_at).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });
});
