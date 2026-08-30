/**
 * `notificationPreference.mine` / `notificationPreference.setMine`.
 *
 * Neither procedure has an `assertCan*` guard (see `notification-preference.ts`'s
 * own doc comment for why) — the scoping this file exists to prove is that
 * `mine`/`setMine` never reach ANOTHER PERSON's row, even though
 * `subscriber_notification_preference_tenant_isolation` is tenancy-only and
 * would happily let that through at the RLS layer. That is a different
 * property than the FORBIDDEN-refusal pins elsewhere in this phase, so this
 * file's central test is "does not leak another person's row", not a role
 * check.
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
import { toRows } from "../../../db/rows.js";

async function seedPreference(
  db: TestDb,
  town: TownFixture,
  personId: string,
  opts: { eventType: string; channel: "email" | "sms"; enabled: boolean },
): Promise<void> {
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO subscriber_notification_preference (person_id, town_id, channel, event_type, enabled)
      VALUES (${personId}, ${town.townId}, ${opts.channel}::notification_channel,
              ${opts.eventType}, ${opts.enabled})
    `);
  });
}

async function readPreferences(
  db: TestDb,
  town: TownFixture,
  personId: string,
): Promise<{ event_type: string; channel: string; enabled: boolean }[]> {
  return inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT event_type, channel, enabled FROM subscriber_notification_preference
            WHERE person_id = ${personId}`,
      )
      .then((r) =>
        toRows<{ event_type: string; channel: string; enabled: boolean }>(r, (m) => new Error(m)),
      ),
  );
}

describe("notificationPreference.mine", () => {
  it("returns only the caller's own preferences, not another person's in the same town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const me = await seedActor(db, town, { role: "staff", global: [] });
        const someoneElse = await seedActor(db, town, { role: "staff", global: [] });

        await seedPreference(db, town, me.personId, {
          eventType: "meeting_scheduled",
          channel: "email",
          enabled: false,
        });
        await seedPreference(db, town, someoneElse.personId, {
          eventType: "meeting_scheduled",
          channel: "email",
          enabled: false,
        });
        await seedPreference(db, town, someoneElse.personId, {
          eventType: "minutes_approved",
          channel: "email",
          enabled: true,
        });

        const caller = appRouter.createCaller(contextFor(db, town, me));
        const rows = await caller.notificationPreference.mine();

        expect(rows).toEqual([
          { event_type: "meeting_scheduled", channel: "email", enabled: false },
        ]);
      } finally {
        await app.end();
      }
    });
  });

  it("returns an empty list for a caller with no preferences set", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const me = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, me));
        const rows = await caller.notificationPreference.mine();

        expect(rows).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("notificationPreference.setMine", () => {
  it("creates a preference row scoped to the caller's own person, regardless of role", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        // No admin gate on this action at all — any signed-in member of the
        // town manages their own preferences, board_member included.
        const me = await seedActor(db, town, { role: "board_member", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, me));

        const result = await caller.notificationPreference.setMine({
          event_type: "agenda_published",
          channel: "email",
          enabled: false,
        });
        expect(result).toEqual({
          event_type: "agenda_published",
          channel: "email",
          enabled: false,
        });

        const rows = await readPreferences(db, town, me.personId);
        expect(rows).toEqual([
          { event_type: "agenda_published", channel: "email", enabled: false },
        ]);
      } finally {
        await app.end();
      }
    });
  });

  it("upserts — a second call for the same event/channel changes the existing row, not a new one", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const me = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, me));

        await caller.notificationPreference.setMine({
          event_type: "agenda_published",
          channel: "email",
          enabled: false,
        });
        await caller.notificationPreference.setMine({
          event_type: "agenda_published",
          channel: "email",
          enabled: true,
        });

        const rows = await readPreferences(db, town, me.personId);
        expect(rows).toEqual([{ event_type: "agenda_published", channel: "email", enabled: true }]);
      } finally {
        await app.end();
      }
    });
  });

  it("cannot be made to write another person's row — there is no personId input to substitute", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const me = await seedActor(db, town, { role: "staff", global: [] });
        const someoneElse = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, me));

        await caller.notificationPreference.setMine({
          event_type: "minutes_approved",
          channel: "email",
          enabled: false,
        });

        expect(await readPreferences(db, town, someoneElse.personId)).toEqual([]);
        expect(await readPreferences(db, town, me.personId)).toEqual([
          { event_type: "minutes_approved", channel: "email", enabled: false },
        ]);
      } finally {
        await app.end();
      }
    });
  });
});
