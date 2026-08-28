/**
 * Stage 1, Task D1 — `requirePermission` as procedure middleware.
 *
 * The rules themselves are tested in `permission.test.ts`. This file tests the
 * thing that carries them into a procedure, and in particular the two
 * behaviours the old `requirePermission` got wrong:
 *
 *   1. it passed `boardId: undefined` everywhere, so board overrides were
 *      never consulted — in EITHER direction; and
 *   2. it was keyed on action names while the database stores codes, so it
 *      answered `false` for everything and was, in effect, off.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { withTestDb } from "../../test/db-harness.js";
import { toRows } from "../../db/rows.js";
import { testDb, seedTown, seedActor, type TownFixture, type TestDb } from "./fixtures.js";
import { withTenant } from "../../db/with-tenant.js";
import { loadActor } from "../authorization/actor.js";
import {
  toNameKeyedMatrix,
  resolvePermission,
  PERMISSION_CODES,
} from "../authorization/permission.js";
import {
  router,
  protectedProcedure,
  publicProcedure,
  requirePermission,
  createCallerFactory,
} from "../trpc.js";
import type { TrpcContext } from "../context.js";

/**
 * Build the context a procedure sees, from a real account in a real database.
 *
 * Deliberately assembled the same way `createTrpcContext` assembles it — a
 * bound `withTenant` and a memoised actor loader, and no other database
 * handle — so a procedure that finds a way to the database in a test would
 * have found the same way in production.
 */
function contextFor(
  db: TestDb,
  town: TownFixture,
  seeded: { personId: string; userAccountId: string },
): TrpcContext {
  const tenant = {
    townId: town.townId,
    personId: seeded.personId,
    userAccountId: seeded.userAccountId,
  };
  const bound = <T>(fn: Parameters<typeof withTenant<never, T>>[2]) =>
    withTenant(db, { townId: town.townId }, fn as never) as Promise<T>;

  let cached: ReturnType<typeof loadActor> | undefined;
  return {
    req: {} as never,
    res: {} as never,
    authUser: { id: "auth-user", email: "a@example.test", emailVerified: true },
    tenant,
    withTenant: bound as TrpcContext["withTenant"],
    actor: () => {
      cached ??= bound((tx) => loadActor(tx as never, tenant));
      return cached;
    },
  };
}

/** A router exercising the global and board-scoped shapes of the middleware. */
const testRouter = router({
  // Global: A2 on agenda items.
  editAgenda: protectedProcedure
    .use(requirePermission("A2", { action: "to edit an agenda" }))
    .mutation(() => "edited" as const),

  // Board-scoped: A1 on meeting creation, board read from the input.
  scheduleMeeting: protectedProcedure
    .input(z.object({ boardId: z.string().uuid().optional() }))
    .use(
      requirePermission<{ boardId?: string }>("A1", {
        board: (input) => input.boardId,
        action: "to schedule a meeting",
      }),
    )
    .mutation(() => "scheduled" as const),

  // A procedure that reaches the database, to prove the handle works.
  countBoards: protectedProcedure.query(async ({ ctx }) =>
    ctx.withTenant(async (tx) => {
      const rows = toRows<{ n: number }>(
        await tx.execute(sql`SELECT count(*)::int AS n FROM board`),
        (message) => new Error(message),
      );
      return rows[0]?.n ?? 0;
    }),
  ),

  // Public: no session, no tenant, no database handle.
  ping: publicProcedure.query(() => "pong" as const),
});

const createCaller = createCallerFactory(testRouter);

async function expectForbidden(fn: () => Promise<unknown>): Promise<TRPCError> {
  let thrown: unknown;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }
  if (!(thrown instanceof TRPCError)) {
    throw new Error(`expected a TRPCError, got ${String(thrown)}`);
  }
  return thrown;
}

describe("requirePermission", () => {
  it("allows a caller holding the code and refuses one who does not, with a message that names it", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const granted = await seedActor(db, town, { role: "staff", global: ["A2"] });
      const denied = await seedActor(db, town, { role: "staff", global: ["A3"] });

      await expect(createCaller(contextFor(db, town, granted)).editAgenda()).resolves.toBe(
        "edited",
      );

      const err = await expectForbidden(() =>
        createCaller(contextFor(db, town, denied)).editAgenda(),
      );
      expect(err.code).toBe("FORBIDDEN");
      // The refusal has to be actionable: a clerk needs to know which
      // permission to ask for, and support needs to know which one to grant.
      expect(err.message).toContain("A2");
      expect(err.message).toContain("edit_agenda");
    });
  });

  it("consults a board override that GRANTS, and one that REVOKES", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      // Holds nothing globally; granted A1 on one board only.
      const boardOnly = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { A1: true } }],
      });
      // Holds A1 globally; REVOKED on one board. `boardId: undefined` would
      // have allowed this caller on the board they are barred from — the
      // reason "it just passes undefined" is not a fail-closed shortcut.
      const revoked = await seedActor(db, town, {
        role: "staff",
        global: ["A1"],
        boardOverrides: [{ boardId: town.boardId, permissions: { A1: false } }],
      });

      const grantCaller = createCaller(contextFor(db, town, boardOnly));
      await expect(grantCaller.scheduleMeeting({ boardId: town.boardId })).resolves.toBe(
        "scheduled",
      );
      expect(
        (await expectForbidden(() => grantCaller.scheduleMeeting({ boardId: town.otherBoardId })))
          .code,
      ).toBe("FORBIDDEN");

      const revokeCaller = createCaller(contextFor(db, town, revoked));
      expect(
        (await expectForbidden(() => revokeCaller.scheduleMeeting({ boardId: town.boardId }))).code,
      ).toBe("FORBIDDEN");
      await expect(revokeCaller.scheduleMeeting({ boardId: town.otherBoardId })).resolves.toBe(
        "scheduled",
      );
    });
  });

  it("REFUSES a board-scoped check with no board rather than widening to the global grant", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      // Globally permitted — so a fallback to the global check would ALLOW.
      const globalA1 = await seedActor(db, town, { role: "staff", global: ["A1"] });

      const err = await expectForbidden(() =>
        createCaller(contextFor(db, town, globalA1)).scheduleMeeting({}),
      );
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toContain("scoped to a board");
    });
  });

  it("refuses when the context carries no tenant, instead of resolving an empty actor", async () => {
    const ctx: TrpcContext = { req: {} as never, res: {} as never };
    const err = await expectForbidden(() => createCaller(ctx).editAgenda());
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("gives a protected procedure a working tenant-scoped database handle and nothing else", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const staff = await seedActor(db, town, { role: "staff", global: [] });
      const ctx = contextFor(db, town, staff);

      // seedTown creates two boards.
      await expect(createCaller(ctx).countBoards()).resolves.toBe(2);

      // The only database-shaped thing on the context is `withTenant`.
      expect(Object.keys(ctx).filter((k) => /db|sql|client|supabase/i.test(k))).toEqual([]);
    });
  });

  it("serves a public procedure with no context at all", async () => {
    await expect(createCaller({ req: {} as never, res: {} as never }).ping()).resolves.toBe("pong");
  });
});

describe("the code/name translation", () => {
  it("maps every action CODE the database stores onto the NAME the shared resolver takes", async () => {
    // This is the mismatch that made authorization inert: `seed.sql` writes
    // `{"global":{"A2":true}}` and `hasPermission()` looks for `edit_agenda`.
    const matrix = toNameKeyedMatrix({
      global: Object.fromEntries(PERMISSION_CODES.map((c) => [c, true])),
      board_overrides: [{ board_id: "b", permissions: { A1: false } }],
    });
    expect(matrix.global.edit_agenda).toBe(true);
    expect(matrix.global.capture_motions_votes).toBe(true);
    expect(Object.keys(matrix.global)).toHaveLength(PERMISSION_CODES.length);
    expect(matrix.board_overrides[0]!.permissions.create_meeting).toBe(false);
  });

  it("drops a key that is neither a known code nor a grant, rather than passing it through", async () => {
    const matrix = toNameKeyedMatrix({
      global: { A2: true, edit_agenda: true, NOPE: true } as never,
    });
    // `edit_agenda` arrived as a NAME in a code-keyed field. Accepting it
    // would mean two spellings of one permission, and the wrong one winning
    // depends on object key order.
    expect(Object.keys(matrix.global)).toEqual(["edit_agenda"]);
    expect(matrix.global.edit_agenda).toBe(true);
  });

  it("resolves sys_admin to no permission at all, on every one of the 30 codes", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      // Deliberately given a full matrix. `has_permission()` denied sys_admin
      // before reading the matrix, and so must this.
      const sysAdmin = await seedActor(db, town, {
        role: "sys_admin",
        global: [...PERMISSION_CODES],
      });
      for (const code of PERMISSION_CODES) {
        expect(resolvePermission(sysAdmin.actor, code), `sys_admin must not hold ${code}`).toBe(
          false,
        );
      }
    });
  });

  it("gives an admin every code, including the four that cannot be delegated", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const admin = await seedActor(db, town, { role: "admin" });
      const clerk = await seedActor(db, town, {
        role: "staff",
        global: [...PERMISSION_CODES],
      });

      for (const code of PERMISSION_CODES) {
        expect(resolvePermission(admin.actor, code), `admin must hold ${code}`).toBe(true);
      }
      // T1–T4 are non-delegable: granting them to a staff account in the
      // JSONB must not work, however the JSONB got that way.
      for (const code of ["T1", "T2", "T3", "T4"] as const) {
        expect(resolvePermission(clerk.actor, code), `${code} must not be delegable`).toBe(false);
      }
    });
  });

  it("gives a board member exactly A4, A7 and M8 — and no staff permission smuggled into their matrix", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const member = await seedActor(db, town, {
        role: "board_member",
        global: ["R1", "A2", "M3"],
      });
      for (const code of PERMISSION_CODES) {
        expect(resolvePermission(member.actor, code), code).toBe(
          (["A4", "A7", "M8"] as string[]).includes(code),
        );
      }
    });
  });
});
