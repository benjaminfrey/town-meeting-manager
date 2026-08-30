/**
 * `townNotificationConfig.select` / `.insert` / `.update`.
 *
 * This is the wave's named hazard: `town_notification_config` holds the
 * town's SMTP/Twilio credentials, and the RLS policy behind it is
 * tenancy-only — any signed-in member of the town, staff with zero
 * permissions included, can otherwise read it. `select`'s refusal test below
 * is the one that matters most in this file; see `town-notification-config.ts`'s
 * own header for why this router exists with no UI caller yet.
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
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import { toRows } from "../../../db/rows.js";

const SAMPLE = {
  postmark_server_token_encrypted: "ptok_abc123",
  postmark_sender_email: "notices@newcastle.example.test",
  postmark_sender_name: "Town of Newcastle",
  twilio_messaging_service_sid: "MGabc123",
  twilio_phone_number: "+12075550100",
  sms_quiet_hours_start: "21:00:00",
  sms_quiet_hours_end: "08:00:00",
  sms_opt_in_message: "Reply STOP to opt out.",
};

async function readConfig(
  db: TestDb,
  town: TownFixture,
): Promise<{ postmark_server_token_encrypted: string | null } | undefined> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT postmark_server_token_encrypted FROM town_notification_config
            WHERE town_id = ${town.townId}`,
      )
      .then((r) =>
        toRows<{ postmark_server_token_encrypted: string | null }>(r, (m) => new Error(m)),
      ),
  );
  return rows[0];
}

describe("townNotificationConfig.select", () => {
  it("refuses a caller who is not an administrator — the credential guard", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);

        // `C2` ("manage notification settings") is deliberately included on
        // the staff actor — see `admin-gates.test.ts`'s own version of this
        // point: an operational notification permission is emphatically not
        // the same authority as reading the mail server password.
        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, {
            role,
            global: role === "staff" ? ["C2", "C5"] : [],
          });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() => caller.townNotificationConfig.select());
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }
      } finally {
        await app.end();
      }
    });
  });

  it("answers null for a town with no config row yet", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        expect(await caller.townNotificationConfig.select()).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator read the row, credentials included", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.townNotificationConfig.insert(SAMPLE);
        const result = await caller.townNotificationConfig.select();

        expect(result).toMatchObject(SAMPLE);
      } finally {
        await app.end();
      }
    });
  });

  it("does not return another town's configuration", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirAdmin = await seedActor(db, theirs, { role: "admin" });
        const theirCaller = appRouter.createCaller(contextFor(db, theirs, theirAdmin));
        await theirCaller.townNotificationConfig.insert(SAMPLE);

        const myAdmin = await seedActor(db, mine, { role: "admin" });
        const myCaller = appRouter.createCaller(contextFor(db, mine, myAdmin));

        expect(await myCaller.townNotificationConfig.select()).toBeNull();
      } finally {
        await app.end();
      }
    });
  });
});

describe("townNotificationConfig.insert", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() => caller.townNotificationConfig.insert(SAMPLE));
        expect(err.code).toBe("FORBIDDEN");
        expect(await readConfig(db, town)).toBeUndefined();
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        // `postmark_sender_email` fails `.email()` — see `town.test.ts`'s
        // identical pin for why this is the discriminator, not "input that
        // parses".
        const err = await expectTrpcError(() =>
          caller.townNotificationConfig.insert({
            ...SAMPLE,
            postmark_sender_email: "not-an-email",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator create the town's configuration", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.townNotificationConfig.insert(SAMPLE);

        const row = await readConfig(db, town);
        expect(row?.postmark_server_token_encrypted).toBe(SAMPLE.postmark_server_token_encrypted);
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when the town already has a configuration, and does not overwrite it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.townNotificationConfig.insert(SAMPLE);
        const err = await expectTrpcError(() =>
          caller.townNotificationConfig.insert({
            ...SAMPLE,
            postmark_server_token_encrypted: "different-token",
          }),
        );
        expect(err.code).toBe("CONFLICT");

        const row = await readConfig(db, town);
        expect(row?.postmark_server_token_encrypted).toBe(SAMPLE.postmark_server_token_encrypted);
      } finally {
        await app.end();
      }
    });
  });
});

describe("townNotificationConfig.update", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const adminCaller = appRouter.createCaller(contextFor(db, town, admin));
        await adminCaller.townNotificationConfig.insert(SAMPLE);

        const staff = await seedActor(db, town, { role: "staff", global: [] });
        const staffCaller = appRouter.createCaller(contextFor(db, town, staff));
        const err = await expectTrpcError(() =>
          staffCaller.townNotificationConfig.update({
            ...SAMPLE,
            postmark_sender_name: "Hijacked",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");

        const row = await readConfig(db, town);
        expect(row?.postmark_server_token_encrypted).toBe(SAMPLE.postmark_server_token_encrypted);
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.townNotificationConfig.update({
            ...SAMPLE,
            postmark_sender_email: "not-an-email",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator change the configuration", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));
        await caller.townNotificationConfig.insert(SAMPLE);

        await caller.townNotificationConfig.update({
          ...SAMPLE,
          postmark_server_token_encrypted: "rotated-token",
        });

        const row = await readConfig(db, town);
        expect(row?.postmark_server_token_encrypted).toBe("rotated-token");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the town has no configuration yet, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() => caller.townNotificationConfig.update(SAMPLE));
        expect(err.code).toBe("NOT_FOUND");
        expect(await readConfig(db, town)).toBeUndefined();
      } finally {
        await app.end();
      }
    });
  });

  it("does not update another town's configuration", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirAdmin = await seedActor(db, theirs, { role: "admin" });
        const theirCaller = appRouter.createCaller(contextFor(db, theirs, theirAdmin));
        await theirCaller.townNotificationConfig.insert(SAMPLE);

        const myAdmin = await seedActor(db, mine, { role: "admin" });
        const myCaller = appRouter.createCaller(contextFor(db, mine, myAdmin));

        const err = await expectTrpcError(() =>
          myCaller.townNotificationConfig.update({
            ...SAMPLE,
            postmark_server_token_encrypted: "hijacked-token",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");

        const row = await readConfig(db, theirs);
        expect(row?.postmark_server_token_encrypted).toBe(SAMPLE.postmark_server_token_encrypted);
      } finally {
        await app.end();
      }
    });
  });
});
