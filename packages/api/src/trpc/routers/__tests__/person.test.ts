/**
 * `person.list` / `person.insert` / `person.update` /
 * `person.insertStaffAccount` / `person.updateGovTitle`.
 *
 * Same connection discipline as `board.test.ts`/`town.test.ts`: every case
 * runs through `connectAsAppRole`, never the owner connection `withTestDb`
 * hands back — the owner is a superuser and RLS does not bind it, so an
 * assertion written on that handle would pass even with tenancy broken
 * outright.
 *
 * `person.updateGovTitle`'s suite carries this task's central hazard test:
 * `gov_title` is one of `ADMIN_ONLY_USER_ACCOUNT_COLUMNS`
 * (`authorization/rules.ts`), so `assertCanUpdateUserAccount`'s "you may
 * change your own account" self-branch must NOT cover it. A caller updating
 * THEIR OWN account and writing `gov_title` must still be refused — getting
 * that wrong is a path to self-granted governance titles, and the brief
 * warns this exact test was circular once before (it iterated the very list
 * it was testing, so dropping `role` from the list left the suite green).
 * The test below does not iterate `ADMIN_ONLY_USER_ACCOUNT_COLUMNS` at all —
 * it calls the real procedure with a real self-owned account id and asserts
 * FORBIDDEN, so it cannot agree with itself the way that circular test did.
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
async function seedPerson(
  db: TestDb,
  town: TownFixture,
  name: string,
  email?: string,
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO person (id, town_id, name, email)
      VALUES (${id}, ${town.townId}, ${name}, ${email ?? `${id.slice(0, 8)}@example.test`})
    `);
  });
  return id;
}

async function readPerson(
  db: TestDb,
  town: TownFixture,
  personId: string,
): Promise<{ name: string; email: string | null; archived_at: string | null } | undefined> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT name, email, archived_at FROM person WHERE id = ${personId}`)
      .then((r) =>
        toRows<{ name: string; email: string | null; archived_at: string | null }>(
          r,
          (m) => new Error(m),
        ),
      ),
  );
  return rows[0];
}

async function readAccount(
  db: TestDb,
  town: TownFixture,
  userAccountId: string,
): Promise<
  | {
      role: string;
      gov_title: string | null;
      permissions: unknown;
      person_id: string;
    }
  | undefined
> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT role, gov_title, permissions, person_id FROM user_account WHERE id = ${userAccountId}`,
      )
      .then((r) =>
        toRows<{ role: string; gov_title: string | null; permissions: unknown; person_id: string }>(
          r,
          (m) => new Error(m),
        ),
      ),
  );
  return rows[0];
}

async function countAccountsForPerson(
  db: TestDb,
  town: TownFixture,
  personId: string,
): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT id FROM user_account WHERE person_id = ${personId}`)
      .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
  );
  return rows.length;
}

describe("person.list", () => {
  it("returns every person in the town, with account role/title where one exists", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");

        const admin = await seedActor(db, town, { role: "admin", global: [] });
        const staff = await seedActor(db, town, { role: "staff", global: [] });
        await inTown(db, town, (tx) =>
          tx.execute(
            sql`UPDATE user_account SET gov_title = 'Town Clerk' WHERE id = ${staff.userAccountId}`,
          ),
        );
        const directoryOnly = await seedPerson(db, town, "No Account Yet");

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const rows = await caller.person.list();

        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get(admin.personId)).toMatchObject({ role: "admin", gov_title: null });
        expect(byId.get(staff.personId)).toMatchObject({
          role: "staff",
          gov_title: "Town Clerk",
        });
        expect(byId.get(directoryOnly)).toMatchObject({ role: null, gov_title: null });
      } finally {
        await app.end();
      }
    });
  });

  it("does not return another town's people", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        await seedPerson(db, theirs, "Someone Else");
        const actor = await seedActor(db, mine, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        const rows = await caller.person.list();

        expect(rows.some((r) => r.name === "Someone Else")).toBe(false);
      } finally {
        await app.end();
      }
    });
  });

  it("excludes an archived person, and hides an archived account without hiding the person", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const admin = await seedActor(db, town, { role: "admin", global: [] });

        const archivedPersonId = await seedPerson(db, town, "Departed Person");
        await inTown(db, town, (tx) =>
          tx.execute(sql`UPDATE person SET archived_at = now() WHERE id = ${archivedPersonId}`),
        );

        const staff = await seedActor(db, town, { role: "staff", global: [] });
        await inTown(db, town, (tx) =>
          tx.execute(
            sql`UPDATE user_account SET archived_at = now() WHERE id = ${staff.userAccountId}`,
          ),
        );

        const caller = appRouter.createCaller(contextFor(db, town, admin));
        const rows = await caller.person.list();
        const byId = new Map(rows.map((r) => [r.id, r]));

        expect(byId.has(archivedPersonId)).toBe(false);
        expect(byId.get(staff.personId)).toMatchObject({ role: null, gov_title: null });
      } finally {
        await app.end();
      }
    });
  });
});

describe("person.insert", () => {
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
            caller.person.insert({ name: "New Person", email: "new-person@example.test" }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const rows = await readPersonsNamed(db, town, "New Person");
        expect(rows).toHaveLength(0);
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

        // `email` fails `.email()` — if the guard were declared after
        // `.input()`, the parser would answer BAD_REQUEST before the guard
        // ever ran. See `town.test.ts`'s identical pin for the full account
        // of why this is the discriminator, not "input that parses".
        const err = await expectTrpcError(() =>
          caller.person.insert({ name: "New Person", email: "not-an-email" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator add a person to the directory", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        // Only `name` gets whitespace to prove trimming: zod's `.email()`
        // validates the RAW string before the resolver ever runs, so a
        // padded email fails at the parser, not the assertion below.
        const result = await caller.person.insert({
          name: "  Jamie Newperson  ",
          email: "Jamie.Newperson@Example.Test",
        });
        expect(result.name).toBe("Jamie Newperson");
        expect(result.email).toBe("jamie.newperson@example.test");

        const row = await readPerson(db, town, result.id);
        expect(row).toMatchObject({
          name: "Jamie Newperson",
          email: "jamie.newperson@example.test",
        });
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for an email already used in the same town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        await seedPerson(db, town, "First Person", "taken@example.test");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.person.insert({ name: "Second Person", email: "taken@example.test" }),
        );
        expect(err.code).toBe("CONFLICT");

        const rows = await readPersonsNamed(db, town, "Second Person");
        expect(rows).toHaveLength(0);
      } finally {
        await app.end();
      }
    });
  });
});

describe("person.update", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const personId = await seedPerson(db, town, "Original Name", "original@example.test");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.person.update({ personId, name: "Renamed", email: "renamed@example.test" }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const row = await readPerson(db, town, personId);
        expect(row?.name).toBe("Original Name");
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
        const personId = await seedPerson(db, town, "Original Name");
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.person.update({ personId, name: "Renamed", email: "not-an-email" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator update the person's name and email", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const personId = await seedPerson(db, town, "Original Name", "original@example.test");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.person.update({
          personId,
          name: "New Name",
          email: "new@example.test",
        });
        expect(result).toMatchObject({ name: "New Name", email: "new@example.test" });

        const row = await readPerson(db, town, personId);
        expect(row).toMatchObject({ name: "New Name", email: "new@example.test" });
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a person in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirPersonId = await seedPerson(db, theirs, "Their Person");
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.person.update({
            personId: theirPersonId,
            name: "Hijacked",
            email: "hijacked@example.test",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");

        const row = await readPerson(db, theirs, theirPersonId);
        expect(row?.name).toBe("Their Person");
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when renaming to an email another person in the same town already uses", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        await seedPerson(db, town, "Taken", "taken@example.test");
        const personId = await seedPerson(db, town, "Renaming", "renaming@example.test");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.person.update({ personId, name: "Renaming", email: "taken@example.test" }),
        );
        expect(err.code).toBe("CONFLICT");

        const row = await readPerson(db, town, personId);
        expect(row?.email).toBe("renaming@example.test");
      } finally {
        await app.end();
      }
    });
  });
});

describe("person.insertStaffAccount", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const personId = await seedPerson(db, town, "Future Staffer");

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.person.insertStaffAccount({
              personId,
              govTitle: null,
              permissions: { global: {}, board_overrides: [] },
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await countAccountsForPerson(db, town, personId)).toBe(0);
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

        // `personId` fails `.uuid()` at parse time, but this middleware never
        // reads it — it authorizes on the actor alone (`requireActor`), so
        // the malformed field only proves the guard, not the extractor.
        const err = await expectTrpcError(() =>
          caller.person.insertStaffAccount({
            personId: "not-a-uuid",
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("creates a staff account with the permissions matrix written exactly as sent", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const personId = await seedPerson(db, town, "Future Staffer");
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        // Deliberately mixed spelling — a CODE and a NAME — the exact shape
        // `normalisePermissionsMatrix` exists to reconcile on READ. This
        // procedure must not "fix" it on write.
        const result = await caller.person.insertStaffAccount({
          personId,
          govTitle: "  Deputy Clerk  ",
          permissions: { global: { A2: true, edit_minutes: true }, board_overrides: [] },
        });
        expect(result.gov_title).toBe("Deputy Clerk");

        const row = await readAccount(db, town, result.id);
        expect(row).toMatchObject({
          role: "staff",
          gov_title: "Deputy Clerk",
          person_id: personId,
        });
        expect(row?.permissions).toEqual({
          global: { A2: true, edit_minutes: true },
          board_overrides: [],
        });
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when the person already has an account, and writes nothing new", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const existing = await seedActor(db, town, { role: "staff", global: [] });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.person.insertStaffAccount({
            personId: existing.personId,
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await countAccountsForPerson(db, town, existing.personId)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a person belonging to another town, and creates no account", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirPersonId = await seedPerson(db, theirs, "Their Person");
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.person.insertStaffAccount({
            personId: theirPersonId,
            govTitle: null,
            permissions: { global: {}, board_overrides: [] },
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countAccountsForPerson(db, theirs, theirPersonId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });
});

describe("person.updateGovTitle", () => {
  it("refuses a non-admin caller trying to change another account, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const otherActor = await seedActor(db, town, { role: "staff", global: [] });
        const target = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, otherActor));

        const err = await expectTrpcError(() =>
          caller.person.updateGovTitle({ userAccountId: target.userAccountId, govTitle: "Chair" }),
        );
        expect(err.code).toBe("FORBIDDEN");

        const row = await readAccount(db, town, target.userAccountId);
        expect(row?.gov_title).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The brief's central hazard, made concrete: `assertCanUpdateUserAccount`'s
   * self-branch authorizes the ROW, not the COLUMNS. A caller changing their
   * OWN account must still be refused here, because `gov_title` is in
   * `ADMIN_ONLY_USER_ACCOUNT_COLUMNS`. This does not iterate that list (see
   * the file header) — it calls the real procedure against a real,
   * self-owned account id.
   */
  it("refuses a non-admin caller changing their OWN account's government title", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const self = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, self));

        const err = await expectTrpcError(() =>
          caller.person.updateGovTitle({
            userAccountId: self.userAccountId,
            govTitle: "Self-Promoted",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");

        const row = await readAccount(db, town, self.userAccountId);
        expect(row?.gov_title).toBeNull();
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
        const self = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, self));

        // `govTitle` exceeds the 100-char max — fails `.input()` parsing.
        // The guard reads `userAccountId` off the RAW body, so it still
        // runs and refuses before the parser gets a chance to.
        const err = await expectTrpcError(() =>
          caller.person.updateGovTitle({
            userAccountId: self.userAccountId,
            govTitle: "x".repeat(200),
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator change another account's government title", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const target = await seedActor(db, town, { role: "staff", global: [] });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.person.updateGovTitle({
          userAccountId: target.userAccountId,
          govTitle: "  Town Clerk  ",
        });
        expect(result.gov_title).toBe("Town Clerk");

        const row = await readAccount(db, town, target.userAccountId);
        expect(row?.gov_title).toBe("Town Clerk");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a user_account belonging to another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirAccount = await seedActor(db, theirs, { role: "staff", global: [] });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.person.updateGovTitle({
            userAccountId: theirAccount.userAccountId,
            govTitle: "Hijacked",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");

        const row = await readAccount(db, theirs, theirAccount.userAccountId);
        expect(row?.gov_title).toBeNull();
      } finally {
        await app.end();
      }
    });
  });
});

/** Read every person in `town` with the given `name`, for "writes nothing" assertions. */
async function readPersonsNamed(
  db: TestDb,
  town: TownFixture,
  name: string,
): Promise<{ id: string }[]> {
  return inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT id FROM person WHERE town_id = ${town.townId} AND name = ${name}`)
      .then((r) => toRows<{ id: string }>(r, (m) => new Error(m))),
  );
}

/** `user_account.archived_at` for one row — `archiveUserAccount`'s own suite needs this column, `readAccount` above does not select it. */
async function readArchivedAt(
  db: TestDb,
  town: TownFixture,
  userAccountId: string,
): Promise<string | null | undefined> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT archived_at FROM user_account WHERE id = ${userAccountId}`)
      .then((r) => toRows<{ archived_at: string | null }>(r, (m) => new Error(m))),
  );
  return rows[0]?.archived_at;
}

/**
 * `person.archiveUserAccount` — `RoleConflictDialog.tsx`'s write (Phase E,
 * wave 2, Task 4). Same guard shape as `updateGovTitle` above
 * (`requireOwnAccountColumns`), so its refusal suite mirrors that one's
 * exactly: `archived_at` is also `ADMIN_ONLY_USER_ACCOUNT_COLUMNS`, so the
 * self-branch must not cover it either — a non-admin archiving their OWN
 * account is refused the same as archiving someone else's.
 */
describe("person.archiveUserAccount", () => {
  it("refuses a non-admin caller trying to archive another account, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const otherActor = await seedActor(db, town, { role: "staff", global: [] });
        const target = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, otherActor));

        const err = await expectTrpcError(() =>
          caller.person.archiveUserAccount({ userAccountId: target.userAccountId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readArchivedAt(db, town, target.userAccountId)).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a non-admin caller archiving their OWN account", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const self = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, self));

        const err = await expectTrpcError(() =>
          caller.person.archiveUserAccount({ userAccountId: self.userAccountId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readArchivedAt(db, town, self.userAccountId)).toBeNull();
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
        const self = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, self));

        // `userAccountId` fails `.uuid()` — the guard reads it off the RAW
        // body, so it still runs and refuses before the parser gets a
        // chance to.
        const err = await expectTrpcError(() =>
          caller.person.archiveUserAccount({ userAccountId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a user_account belonging to another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirAccount = await seedActor(db, theirs, { role: "staff", global: [] });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.person.archiveUserAccount({ userAccountId: theirAccount.userAccountId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readArchivedAt(db, theirs, theirAccount.userAccountId)).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("archives the account as an administrator", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db, "Newcastle");
        const target = await seedActor(db, town, { role: "staff", global: [] });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.person.archiveUserAccount({
          userAccountId: target.userAccountId,
        });
        expect(result.user_account_id).toBe(target.userAccountId);
        expect(await readArchivedAt(db, town, target.userAccountId)).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });
});
