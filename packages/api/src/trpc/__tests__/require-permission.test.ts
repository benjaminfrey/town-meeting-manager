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
import { sql } from "drizzle-orm";
import { withTestDb } from "../../test/db-harness.js";
import { toRows } from "../../db/rows.js";
import {
  testDb,
  seedTown,
  seedActor,
  seedActorWithRawMatrix,
  contextFor,
  expectTrpcError,
} from "./fixtures.js";
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
  requireBoardPermission,
  boardIdFrom,
  createCallerFactory,
  BOARD_SCOPED_CODES,
} from "../trpc.js";
import { DEFAULT_PERMISSION_TEMPLATES, PERMISSIONS } from "@town-meeting/shared";
import type { TrpcContext } from "../context.js";

/** A router exercising the global and board-scoped shapes of the middleware. */
const testRouter = router({
  // Board-scoped: A2 on agenda items. A2 used to be checked globally here,
  // which is the shape `TEMPLATE_BOARD_SPECIFIC_STAFF` breaks on — it grants
  // A2 per board and nothing globally.
  editAgenda: protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }))
    .use(requireBoardPermission("A2", boardIdFrom(), { action: "to edit an agenda" }))
    .mutation(() => "edited" as const),

  // A code that is NOT board-scoped: C2, the notification settings. No
  // designated_boards template grants it and the tables have no board column,
  // so a global check is the right check and must stay buildable.
  readNotificationLog: protectedProcedure
    .use(requirePermission("C2", { action: "to read the notification log" }))
    .query(() => "read" as const),

  // Board-scoped: A1 on meeting creation, board read from the input.
  scheduleMeeting: protectedProcedure
    .input(z.object({ boardId: z.string().uuid().optional() }))
    .use(requireBoardPermission("A1", boardIdFrom(), { action: "to schedule a meeting" }))
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

const expectForbidden = expectTrpcError;

describe("requirePermission", () => {
  it("allows a caller holding the code and refuses one who does not, with a message that names it", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const granted = await seedActor(db, town, { role: "staff", global: ["A2"] });
      const denied = await seedActor(db, town, { role: "staff", global: ["A3"] });

      await expect(
        createCaller(contextFor(db, town, granted)).editAgenda({ boardId: town.boardId }),
      ).resolves.toBe("edited");

      const err = await expectForbidden(() =>
        createCaller(contextFor(db, town, denied)).editAgenda({ boardId: town.boardId }),
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
    const err = await expectForbidden(() =>
      createCaller(ctx).editAgenda({ boardId: "00000000-0000-4000-8000-000000000001" }),
    );
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

  it("still performs a GLOBAL check for a code that is not board-scoped", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const granted = await seedActor(db, town, { role: "staff", global: ["C2"] });
      const denied = await seedActor(db, town, { role: "staff", global: [] });

      // C2 takes no board and must not start demanding one: notification
      // events belong to a town, and no designated_boards template grants it.
      await expect(createCaller(contextFor(db, town, granted)).readNotificationLog()).resolves.toBe(
        "read",
      );
      expect(
        (
          await expectForbidden(() =>
            createCaller(contextFor(db, town, denied)).readNotificationLog(),
          )
        ).code,
      ).toBe("FORBIDDEN");
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

  it("accepts a NAME-keyed matrix — which is what the product itself writes", async () => {
    // `StaffAccountFlow.tsx` builds the matrix with
    // `buildPermissionsFromTemplate()`, which returns
    // `Record<PermissionAction, boolean>` — NAMES — and the dialogs persist it
    // verbatim. An earlier version of this test asserted the name key was
    // DROPPED, which locked in a layer that denied every staff account the
    // product creates. Fail-closed, so never a disclosure; a total silent
    // outage of staff functionality all the same.
    const matrix = toNameKeyedMatrix({
      global: { edit_agenda: true, capture_motions_votes: false } as never,
    });
    expect(matrix.global.edit_agenda).toBe(true);
    expect(matrix.global.capture_motions_votes).toBe(false);
  });

  it("resolves a real name-keyed staff account through the whole stack", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const clerk = await seedActorWithRawMatrix(db, town, "staff", {
        global: { edit_agenda: true, create_meeting: true },
        board_overrides: [{ board_id: town.boardId, permissions: { create_meeting: false } }],
      });

      await expect(
        createCaller(contextFor(db, town, clerk)).editAgenda({ boardId: town.boardId }),
      ).resolves.toBe("edited");

      // The board override is honoured in the name spelling too: revoked on
      // one board, still granted on the other.
      const caller = createCaller(contextFor(db, town, clerk));
      expect(
        (await expectForbidden(() => caller.scheduleMeeting({ boardId: town.boardId }))).code,
      ).toBe("FORBIDDEN");
      await expect(caller.scheduleMeeting({ boardId: town.otherBoardId })).resolves.toBe(
        "scheduled",
      );
    });
  });

  it("drops a key that is neither spelling, rather than passing it through", async () => {
    const matrix = toNameKeyedMatrix({ global: { NOPE: true } as never });
    expect(Object.keys(matrix.global)).toEqual([]);
  });

  it("refuses to BUILD a board-scoped check with no board", async () => {
    // Thrown at module load, not per request — so `requirePermission("A1")`
    // cannot be committed, let alone reach production doing a global check.
    for (const code of BOARD_SCOPED_CODES) {
      expect(() => requirePermission(code), `${code} must demand a board`).toThrow(/board-scoped/);
    }
    // Codes that are not board-scoped are unaffected.
    for (const code of ["T1", "T2", "T3", "T4", "A4", "A7", "M8", "C1", "C2", "C5"] as const) {
      expect(() => requirePermission(code), `${code} must not demand a board`).not.toThrow();
    }
  });

  it("derives the board-scoped set from the designated_boards templates themselves", async () => {
    // The set used to be the hand-written `["A1", "M1"]` — the two codes whose
    // deleted SQL policies said `has_board_permission` out loud. But both
    // shipped `designated_boards` templates put EVERY code they grant in
    // `board_overrides` with global all-false, so a global check on any of
    // them answers "no" to every account those templates create.
    expect([...BOARD_SCOPED_CODES]).toEqual([
      "A1",
      "A2",
      "A3",
      "A5",
      "A6",
      "M1",
      "M2",
      "M3",
      "M4",
      "M5",
      "M6",
      "M7",
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
    ]);

    // Every code either designated_boards template grants is in the set. This
    // is the property that matters; the literal above is only its value today.
    for (const template of DEFAULT_PERMISSION_TEMPLATES) {
      if (template.scope !== "designated_boards") continue;
      for (const action of template.permissions) {
        const code = PERMISSION_CODES.find((c) => PERMISSIONS[c] === action)!;
        expect(BOARD_SCOPED_CODES, `${template.name} grants ${action} (${code})`).toContain(code);
      }
    }
  });

  it("boardIdFrom narrows at runtime instead of casting", async () => {
    const read = boardIdFrom();
    expect(read({ boardId: "b1" })).toBe("b1");
    for (const junk of [null, undefined, 42, "b1", { boardId: 42 }, { boardId: "" }, {}]) {
      expect(read(junk)).toBeUndefined();
    }
    expect(boardIdFrom("board")({ board: "b2" })).toBe("b2");
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
