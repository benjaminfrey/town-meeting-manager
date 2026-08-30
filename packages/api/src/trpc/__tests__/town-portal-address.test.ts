/**
 * Stage 1, Task D1b — setting the town's portal address.
 *
 * `town.subdomain` had no writer anywhere in this repository outside test
 * fixtures, which made every portal feature — including all of D1b's tenant
 * work, which is keyed on it — unreachable in a real deployment. These tests
 * are what say the writer exists and behaves.
 *
 * Three failures are asserted specifically, because each one is a 500 waiting
 * to happen and a 500 is what a clerk cannot act on:
 *
 *   - a malformed or reserved name          → BAD_REQUEST with a reason
 *   - a name another town already holds     → CONFLICT, from the unique
 *     constraint rather than from a check-then-write race
 *   - a caller who is not an administrator  → FORBIDDEN, from the shared gate
 */

import { describe, it, expect } from "vitest";
import { withTestDb } from "../../test/db-harness.js";
import { sql } from "drizzle-orm";
import { toRows } from "../../db/rows.js";
import { testDb, seedTown, seedActor, contextFor, expectTrpcError } from "./fixtures.js";
import { createCallerFactory } from "../trpc.js";
import { townRouter } from "../routers/town.js";

const callerFor = createCallerFactory(townRouter);

describe("town.setPortalAddress", () => {
  it("saves a valid address and reads it back", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db, "Newcastle");
      const admin = await seedActor(db, town, { role: "admin" });
      const caller = callerFor(contextFor(db, town, admin));

      expect(await caller.setPortalAddress({ subdomain: "  NewCastle-ME " })).toEqual({
        subdomain: "newcastle-me",
      });
      expect(await caller.portalAddress()).toEqual({ subdomain: "newcastle-me" });

      // And the value is actually in the row the portal resolver reads, not
      // only in the procedure's return value.
      const stored = await contextFor(db, town, admin).withTenant!((tx) =>
        tx
          .execute(sql`SELECT subdomain FROM town WHERE id = ${town.townId}`)
          .then((r) => toRows<{ subdomain: string }>(r, (m) => new Error(m))),
      );
      expect(stored[0]!.subdomain).toBe("newcastle-me");
    });
  });

  it("refuses a name that is not a usable DNS label", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db, "Newcastle");
      const admin = await seedActor(db, town, { role: "admin" });
      const caller = callerFor(contextFor(db, town, admin));

      for (const bad of [
        "New Castle",
        "newcastle.maine",
        "-newcastle",
        "newcastle-",
        "new_castle",
        "",
        "a".repeat(64),
      ]) {
        const err = await expectTrpcError(() => caller.setPortalAddress({ subdomain: bad }));
        expect([bad, err.code]).toEqual([bad, "BAD_REQUEST"]);
      }
    });
  });

  it("refuses the hostnames this deployment already uses", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db, "Newcastle");
      const admin = await seedActor(db, town, { role: "admin" });
      const caller = callerFor(contextFor(db, town, admin));

      for (const reserved of ["app", "api", "www", "supabase", "mail"]) {
        const err = await expectTrpcError(() => caller.setPortalAddress({ subdomain: reserved }));
        expect([reserved, err.code]).toEqual([reserved, "BAD_REQUEST"]);
        expect(err.message).toContain("reserved");
      }
    });
  });

  it("reports a taken address as a CONFLICT, not a 500", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const a = await seedTown(db, "Alpha");
      const b = await seedTown(db, "Beta");
      const adminA = await seedActor(db, a, { role: "admin" });
      const adminB = await seedActor(db, b, { role: "admin" });

      await callerFor(contextFor(db, a, adminA)).setPortalAddress({ subdomain: "harbortown" });

      const err = await expectTrpcError(() =>
        callerFor(contextFor(db, b, adminB)).setPortalAddress({ subdomain: "harbortown" }),
      );
      // `town_subdomain_key` fires across tenants — the constraint is not
      // scoped by town, and it cannot be: two towns cannot share a hostname.
      // The interesting part is that RLS hides B's collision partner from B,
      // so nothing but the constraint could have found this.
      expect(err.code).toBe("CONFLICT");
      expect(err.message).toContain("already in use");
    });
  });

  it("refuses a caller who is not an administrator", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db, "Newcastle");

      for (const role of ["staff", "board_member"] as const) {
        const actor = await seedActor(db, town, { role });
        const err = await expectTrpcError(() =>
          callerFor(contextFor(db, town, actor)).setPortalAddress({ subdomain: "newcastle" }),
        );
        expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
      }

      // …and nothing was written by the refused attempts.
      const admin = await seedActor(db, town, { role: "admin" });
      expect(await callerFor(contextFor(db, town, admin)).portalAddress()).toEqual({
        // `seedTown` writes a subdomain of its own; the point is that it is
        // still the fixture's, not one a staff account managed to set.
        subdomain: "newcastle",
      });
    });
  });

  /**
   * The reorder pin (conventions item 2/13), added when Task 5 of wave 1
   * converted this procedure from resolver form to
   * `.use(requireActor(...)).input(...)`. The test above proves the guard
   * exists — but only with input (`"newcastle"`) that parses either way, so
   * it cannot tell a correctly-ordered guard from one declared after
   * `.input()`: with valid input the parser succeeds regardless of order,
   * and the guard is what answers FORBIDDEN either way. This test sends a
   * refused caller AND input that fails the schema's own `min(1)` — with
   * `.use()` correctly declared first, the guard throws FORBIDDEN before the
   * parser ever runs (probe 1, conventions item 2); if `.use()` were moved
   * after `.input()`, the parser would run first and answer BAD_REQUEST
   * before the guard got a chance, which is the exact defect
   * `town.updateProfile`'s own reorder pin
   * (`routers/__tests__/town.test.ts`) exists to catch on that procedure.
   * Verified the same way that one was: moved this procedure's `.use(...)`
   * to after `.input(...)` and re-ran this file — this test went red with
   * `BAD_REQUEST`, restored byte-identical. See the task report for output.
   */
  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db, "Newcastle");
      const actor = await seedActor(db, town, { role: "staff" });

      const err = await expectTrpcError(() =>
        callerFor(contextFor(db, town, actor)).setPortalAddress({ subdomain: "" }),
      );
      expect(err.code).toBe("FORBIDDEN");
    });
  });
});
