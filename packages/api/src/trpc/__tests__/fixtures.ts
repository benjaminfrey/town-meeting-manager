/**
 * Shared fixtures for the authorization tests.
 *
 * Every actor these helpers hand back is built by `loadActor()` reading a real
 * `user_account` row out of a real Postgres database — never by hand. That is
 * deliberate, and it is why tests of what are mostly pure functions still pay
 * for the database harness.
 *
 * The defect this phase exists to fix was a SHAPE mismatch, and the shape is
 * not one shape. `user_account.permissions` holds action keys in TWO spellings,
 * written by different parts of this product:
 *
 *   - `supabase/seed.sql:116` writes CODES — `{"global": {"A2": true}}`
 *   - `StaffAccountFlow.tsx:86,104` builds the matrix with
 *     `buildPermissionsFromTemplate()`, which returns
 *     `Record<PermissionAction, boolean>` — NAMES — and
 *     `AddPersonDialog.tsx:117` / `AddMemberDialog.tsx:423` persist it
 *     verbatim, so every staff account created through the product is
 *     name-keyed.
 *
 * A reader that speaks one spelling denies everyone written in the other,
 * silently. `seedActor` below writes CODES and `seedActorWithRawMatrix` writes
 * whatever you give it, so both halves of the real data are exercised.
 *
 * Hand-constructing an actor in a test lets the author pick whichever shape
 * makes the assertion pass, which is exactly how a suite ends up green against
 * an authorization layer that never fires. Going through the database and
 * through the real loader means the stored JSONB is the input to every
 * assertion in this directory.
 *
 * Everything here runs through `withTenant()` — the same function the request
 * path uses — so the fixtures are also a standing check that the rules work
 * under FORCE ROW LEVEL SECURITY rather than only on an unconstrained owner
 * connection.
 */

import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { withTenant, type TenantTx } from "../../db/with-tenant.js";
import { loadActor, type Actor } from "../authorization/actor.js";
import type { PermissionCode } from "../authorization/permission.js";

export type TestDb = ReturnType<typeof drizzle>;

/** Wrap the harness's raw client in the same Drizzle handle production uses. */
export function testDb(client: postgres.Sql): TestDb {
  return drizzle(client);
}

export interface TownFixture {
  townId: string;
  /** A board the fixture actors may or may not be scoped to. */
  boardId: string;
  /** A second board, so board-scoped rules can be shown to actually be scoped. */
  otherBoardId: string;
}

/** Create a town and two boards inside that town's own tenant context. */
export async function seedTown(db: TestDb, name = "Testville"): Promise<TownFixture> {
  const townId = randomUUID();
  const boardId = randomUUID();
  const otherBoardId = randomUUID();

  await withTenant(db, { townId }, async (tx) => {
    await tx.execute(
      sql`INSERT INTO town (id, name, subdomain) VALUES (${townId}, ${name}, ${name.toLowerCase()})`,
    );
    await tx.execute(
      sql`INSERT INTO board (id, town_id, name) VALUES (${boardId}, ${townId}, 'Select Board')`,
    );
    await tx.execute(
      sql`INSERT INTO board (id, town_id, name) VALUES (${otherBoardId}, ${townId}, 'Planning Board')`,
    );
  });

  return { townId, boardId, otherBoardId };
}

export interface ActorSpec {
  role: "sys_admin" | "admin" | "staff" | "board_member";
  /** Codes granted globally. Written into the JSONB exactly as the app writes it. */
  global?: PermissionCode[];
  /** Per-board overrides, including revocations (`false`). */
  boardOverrides?: Array<{
    boardId: string;
    permissions: Partial<Record<PermissionCode, boolean>>;
  }>;
}

export interface SeededActor {
  actor: Actor;
  personId: string;
  userAccountId: string;
}

/**
 * Insert a person + user_account carrying the given code-keyed matrix, then
 * load the actor back through the production loader.
 */
export async function seedActor(
  db: TestDb,
  town: TownFixture,
  spec: ActorSpec,
): Promise<SeededActor> {
  const personId = randomUUID();
  const userAccountId = randomUUID();

  const global: Record<string, boolean> = {};
  for (const code of spec.global ?? []) global[code] = true;

  const permissions = JSON.stringify({
    global,
    board_overrides: (spec.boardOverrides ?? []).map((o) => ({
      board_id: o.boardId,
      permissions: o.permissions,
    })),
  });

  const actor = await withTenant(db, { townId: town.townId }, async (tx) => {
    await tx.execute(sql`
      INSERT INTO person (id, town_id, name, email)
      VALUES (${personId}, ${town.townId}, ${`${spec.role}-${personId.slice(0, 8)}`},
              ${`${personId.slice(0, 8)}@example.test`})
    `);
    await tx.execute(sql`
      INSERT INTO user_account (id, person_id, town_id, role, permissions)
      VALUES (${userAccountId}, ${personId}, ${town.townId},
              ${spec.role}::user_role, ${permissions}::jsonb)
    `);
    return loadActor(tx, {
      townId: town.townId,
      personId,
      userAccountId,
    });
  });

  return { actor, personId, userAccountId };
}

/**
 * Insert an account with a matrix written EXACTLY as given — no code
 * translation, no shape help.
 *
 * For tests that need the name-keyed spelling the product actually writes, or
 * a deliberately malformed matrix. `seedActor` is the convenience form and
 * writes codes; this is the honest form and writes bytes.
 */
export async function seedActorWithRawMatrix(
  db: TestDb,
  town: TownFixture,
  role: ActorSpec["role"],
  matrix: unknown,
): Promise<SeededActor> {
  const personId = randomUUID();
  const userAccountId = randomUUID();
  const permissions = JSON.stringify(matrix);

  const actor = await withTenant(db, { townId: town.townId }, async (tx) => {
    await tx.execute(sql`
      INSERT INTO person (id, town_id, name, email)
      VALUES (${personId}, ${town.townId}, ${`raw-${personId.slice(0, 8)}`},
              ${`${personId.slice(0, 8)}@example.test`})
    `);
    await tx.execute(sql`
      INSERT INTO user_account (id, person_id, town_id, role, permissions)
      VALUES (${userAccountId}, ${personId}, ${town.townId},
              ${role}::user_role, ${permissions}::jsonb)
    `);
    return loadActor(tx, { townId: town.townId, personId, userAccountId });
  });

  return { actor, personId, userAccountId };
}

/** Give a person a seat on a board and return the `board_member.id`. */
export async function seedBoardSeat(
  db: TestDb,
  town: TownFixture,
  personId: string,
  boardId: string,
  status: "active" | "archived" = "active",
): Promise<string> {
  const id = randomUUID();
  await withTenant(db, { townId: town.townId }, async (tx) => {
    await tx.execute(sql`
      INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status)
      VALUES (${id}, ${personId}, ${boardId}, ${town.townId}, CURRENT_DATE,
              ${status}::board_member_status)
    `);
  });
  return id;
}

/** Run `fn` inside the fixture town's tenant context. */
export function inTown<T>(
  db: TestDb,
  town: TownFixture,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withTenant(db, { townId: town.townId }, fn);
}

/**
 * Assert that `fn` refuses with an `AuthorizationError` naming `code`.
 *
 * Written as a helper because the failure it guards against is subtle: a
 * guard that throws the WRONG error (a driver error, a TypeError from a
 * missing field) still "throws", and `expect(...).rejects.toThrow()` would be
 * satisfied by it while the rule itself had stopped working.
 */
export async function expectRefusal(
  fn: () => unknown | Promise<unknown>,
  expected: { code?: string } = {},
): Promise<Error> {
  let thrown: unknown;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }
  if (thrown === undefined) {
    throw new Error("expected the guard to refuse, but it allowed the action");
  }
  const err = thrown as Error & { permissionCode?: string; name?: string };
  if (err.name !== "AuthorizationError") {
    throw new Error(
      `expected an AuthorizationError, got ${err.name}: ${err.message}. ` +
        "A guard that fails for an unrelated reason is not a guard.",
    );
  }
  if (expected.code !== undefined && err.permissionCode !== expected.code) {
    throw new Error(
      `expected the refusal to name permission ${expected.code}, got ${String(err.permissionCode)}`,
    );
  }
  return err;
}
