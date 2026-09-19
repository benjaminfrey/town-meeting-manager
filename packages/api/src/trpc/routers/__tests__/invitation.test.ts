/**
 * `invitation.insert` — `AddPersonDialog.tsx`'s staff-account write, wired in
 * Phase E wave 4, Task 0. See `routers/invitation.ts`'s own header for why
 * this router exists (no `invitation` router/rule existed before this task)
 * and why `assertCanInsertUserAccount` is reused rather than a new rule.
 *
 * Both FK hazards get their own direct test, the way conventions item 3 asks
 * ("attempt the cross-tenant write and confirm it is refused"): `personId`
 * naming another town's person, and `userAccountId` naming a real account
 * that does NOT belong to the named person (a different privilege-escalation
 * shape than a plain missing-row FK, closed by `assertAccountBelongsToPerson`
 * doing both jobs in one query — see this router's own comment).
 *
 * Same connection discipline as `board.test.ts`/`person.test.ts`/
 * `board-member.test.ts`: every case runs through `connectAsAppRole`, never
 * the owner connection `withTestDb` hands back.
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

/** A person with no user_account. */
async function seedPerson(db: TestDb, town: TownFixture, name: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO person (id, town_id, name, email)
      VALUES (${id}, ${town.townId}, ${name}, ${`${id.slice(0, 8)}@example.test`})
    `);
  });
  return id;
}

interface InvitationRow {
  id: string;
  person_id: string;
  user_account_id: string | null;
  town_id: string;
  token_sha256: Buffer | null;
  status: string;
  expires_at: string | null;
}

async function readInvitation(
  db: TestDb,
  town: TownFixture,
  invitationId: string,
): Promise<InvitationRow | undefined> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT id, person_id, user_account_id, town_id, token_sha256, status, expires_at
              FROM invitation WHERE id = ${invitationId}`,
      )
      .then((r) => toRows<InvitationRow>(r, (m) => new Error(m))),
  );
  return rows[0];
}

async function countInvitationsForPerson(
  db: TestDb,
  town: TownFixture,
  personId: string,
): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT id FROM invitation WHERE person_id = ${personId}`)
      .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
  );
  return rows.length;
}

describe("invitation.insert", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const { personId, userAccountId } = await seedActor(db, town, {
          role: "staff",
          global: [],
        });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.invitation.insert({ personId, userAccountId }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await countInvitationsForPerson(db, town, personId)).toBe(0);
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
        const town = await seedTown(db, "Newcastle");
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        // Both ids fail `.uuid()` at parse time, but this middleware never
        // reads them — it authorizes on the actor alone (`requireActor`), so
        // the malformed input only proves the guard, not the extractor.
        const err = await expectTrpcError(() =>
          caller.invitation.insert({ personId: "not-a-uuid", userAccountId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator invite a person, and issues no token until it is sent", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const { personId, userAccountId } = await seedActor(db, town, {
          role: "staff",
          global: [],
        });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.invitation.insert({ personId, userAccountId });

        const row = await readInvitation(db, town, result.id);
        expect(row).toMatchObject({
          person_id: personId,
          user_account_id: userAccountId,
          town_id: town.townId,
          status: "pending",
        });
        expect(row?.expires_at).not.toBeNull();
        // No token exists yet. The table stores only `sha256(token)`, so a
        // token has to be minted where it can be emailed — `/send` — and an
        // invitation that has never been sent carries no credential at all
        // (`drizzle/0004_hash_invitation_tokens.sql`). Nor does it have a
        // hint row, so there is nothing to resolve.
        expect(row?.token_sha256).toBeNull();
        const hints = await inTown(db, town, (tx) =>
          tx.execute(sql`SELECT count(*)::int AS n FROM better_auth.invitation_tenant`),
        );
        expect(toRows<{ n: number }>(hints, (m) => new Error(m))[0]?.n).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a personId belonging to another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const { personId: theirPersonId, userAccountId: theirAccountId } = await seedActor(
          db,
          theirs,
          { role: "staff", global: [] },
        );
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.invitation.insert({ personId: theirPersonId, userAccountId: theirAccountId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countInvitationsForPerson(db, theirs, theirPersonId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when userAccountId belongs to a DIFFERENT person, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        // A real person with no account of their own...
        const targetPerson = await seedPerson(db, town, "Directory Person");
        // ...and a real account that belongs to someone else entirely. A
        // bare existence check on `userAccountId` alone would pass this —
        // the row exists, just not for this person — which is exactly the
        // privilege-escalation shape `assertAccountBelongsToPerson` exists
        // to close.
        const { userAccountId: someoneElsesAccountId } = await seedActor(db, town, {
          role: "staff",
          global: [],
        });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.invitation.insert({
            personId: targetPerson,
            userAccountId: someoneElsesAccountId,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countInvitationsForPerson(db, town, targetPerson)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a personId whose only match is a cross-tenant-corrupted user_account (the case only assertPersonExists, not assertAccountBelongsToPerson, catches)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirPersonId = await seedPerson(db, theirs, "Their Person");

        // A `user_account` seeded directly (not through
        // `person.insertStaffAccount`, which would have refused this with its
        // own `assertPersonExists`) inside MINE's tenant, but whose
        // `person_id` FK points at a person who lives in THEIRS — the
        // FK-bypasses-RLS hazard this router's own header and conventions
        // item 3 name: `user_account_person_id_fkey` references `person(id)`
        // with no town check at all, so nothing at the database layer stops
        // this row from existing (a real bug elsewhere, or stale data from
        // before a person was reassigned, could produce it).
        const corruptedAccountId = randomUUID();
        const permissions = JSON.stringify({ global: {}, board_overrides: [] });
        await inTown(db, mine, (tx) =>
          tx.execute(sql`
            INSERT INTO user_account (id, person_id, town_id, role, permissions)
            VALUES (${corruptedAccountId}, ${theirPersonId}, ${mine.townId},
                    'staff'::user_role, ${permissions}::jsonb)
          `),
        );

        // `assertAccountBelongsToPerson` alone PASSES here: the account is
        // visible in mine's tenant (`town_id = mine`), and its `person_id`
        // really does equal `theirPersonId` — the two columns match exactly,
        // by construction. Only `assertPersonExists`, checking `theirPersonId`
        // against MINE's own tenant-scoped `person` table, catches that the
        // person named in the input is not actually in this tenant at all.
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.invitation.insert({ personId: theirPersonId, userAccountId: corruptedAccountId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countInvitationsForPerson(db, theirs, theirPersonId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a userAccountId belonging to another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const myPerson = await seedPerson(db, mine, "My Person");
        const { userAccountId: theirAccountId } = await seedActor(db, theirs, {
          role: "staff",
          global: [],
        });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.invitation.insert({ personId: myPerson, userAccountId: theirAccountId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countInvitationsForPerson(db, mine, myPerson)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });
});
