/**
 * Stage 1, Task D1b — the portal's subdomain → town resolver.
 *
 * Run as `tmm_app` (`connectAsAppRole`), never as the owner. The owner is a
 * superuser in every supported setup and bypasses row level security outright,
 * so a test of "what can a sessionless caller read" run on the owner
 * connection would pass with RLS switched off entirely — which is the exact
 * failure this file exists to rule out. See `test/db-harness.ts`.
 */

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant } from "../../db/with-tenant.js";
import { toRows } from "../../db/rows.js";
import { resolvePortalTenant } from "../portal-tenant.js";

type Db = ReturnType<typeof drizzle>;

async function seedTown(db: Db, name: string, subdomain: string | null): Promise<string> {
  const townId = randomUUID();
  await withTenant(db, { townId }, async (tx) => {
    await tx.execute(
      sql`INSERT INTO town (id, name, subdomain) VALUES (${townId}, ${name}, ${subdomain})`,
    );
  });
  return townId;
}

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  await withTestDb(async (owner) => {
    const app = await connectAsAppRole(owner);
    try {
      await fn(drizzle(app));
    } finally {
      await app.end();
    }
  });
}

describe("resolvePortalTenant", () => {
  it("resolves a claimed subdomain to exactly its town", async () => {
    await withDb(async (db) => {
      const a = await seedTown(db, "Newcastle", "newcastle");
      const b = await seedTown(db, "Bristol", "bristol");

      expect(await resolvePortalTenant(db, "newcastle")).toEqual({
        townId: a,
        subdomain: "newcastle",
      });
      expect(await resolvePortalTenant(db, "bristol")).toEqual({
        townId: b,
        subdomain: "bristol",
      });
    });
  });

  it("normalises case and surrounding whitespace, because DNS does", async () => {
    await withDb(async (db) => {
      const townId = await seedTown(db, "Newcastle", "newcastle");
      expect(await resolvePortalTenant(db, "  NewCastle ")).toEqual({
        townId,
        subdomain: "newcastle",
      });
    });
  });

  it("answers null — never a throw, never a town — for every kind of miss", async () => {
    await withDb(async (db) => {
      await seedTown(db, "Newcastle", "newcastle");
      // No town has claimed it.
      expect(await resolvePortalTenant(db, "whoville")).toBeNull();
      // Absent header.
      expect(await resolvePortalTenant(db, undefined)).toBeNull();
      expect(await resolvePortalTenant(db, "")).toBeNull();
      // Not a header at all — Fastify hands back an array for a repeated one.
      expect(await resolvePortalTenant(db, ["newcastle"])).toBeNull();
      // Shapes that could never have been saved. None of these reaches SQL.
      expect(await resolvePortalTenant(db, "new castle")).toBeNull();
      expect(await resolvePortalTenant(db, "newcastle.example.com")).toBeNull();
      expect(await resolvePortalTenant(db, "-newcastle")).toBeNull();
      expect(await resolvePortalTenant(db, "newcastle'; DROP TABLE town; --")).toBeNull();
      // Reserved for the application itself.
      expect(await resolvePortalTenant(db, "app")).toBeNull();
      expect(await resolvePortalTenant(db, "api")).toBeNull();
      expect(await resolvePortalTenant(db, "www")).toBeNull();
      expect(await resolvePortalTenant(db, "supabase")).toBeNull();
    });
  });

  it("cannot reach a town that has not published a subdomain", async () => {
    await withDb(async (db) => {
      await seedTown(db, "Unlisted", null);
      // `NULL = anything` is NULL, so the door-opener policy matches nothing.
      // Asserted because the alternative — an empty-string setting matching an
      // empty-string subdomain — is one migration away.
      expect(await resolvePortalTenant(db, "unlisted")).toBeNull();
      expect(await resolvePortalTenant(db, "")).toBeNull();
    });
  });

  it("leaves nothing readable once the lookup transaction ends", async () => {
    await withDb(async (db) => {
      await seedTown(db, "Newcastle", "newcastle");
      expect(await resolvePortalTenant(db, "newcastle")).not.toBeNull();

      // `app.portal_subdomain` is set with SET LOCAL semantics, so it must not
      // survive onto the next unit of work on the same pooled connection. If
      // it did, an authenticated request that happened to reuse the backend
      // could read one extra town row — silently, with no error anywhere.
      const leaked = toRows<{ n: string }>(
        await db.execute(sql`SELECT count(*)::text AS n FROM town`),
        (m) => new Error(m),
      );
      expect(leaked[0]!.n).toBe("0");

      const setting = toRows<{ v: string }>(
        await db.execute(
          sql`SELECT coalesce(current_setting('app.portal_subdomain', true), '') AS v`,
        ),
        (m) => new Error(m),
      );
      expect(setting[0]!.v).toBe("");
    });
  });

  it("does not widen what a normal tenant transaction can see", async () => {
    await withDb(async (db) => {
      const a = await seedTown(db, "Newcastle", "newcastle");
      await seedTown(db, "Bristol", "bristol");

      // Inside town A's context the door-opener policy is inert, because
      // `app.portal_subdomain` is unset. Only A's own row is visible.
      const rows = await withTenant(db, { townId: a }, async (tx) =>
        toRows<{ subdomain: string }>(
          await tx.execute(sql`SELECT subdomain FROM town ORDER BY subdomain`),
          (m) => new Error(m),
        ),
      );
      expect(rows.map((r) => r.subdomain)).toEqual(["newcastle"]);
    });
  });
});
