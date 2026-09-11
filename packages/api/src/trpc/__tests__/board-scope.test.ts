/**
 * Stage 1, Task D1d — the board-scoped rules, and the two things that had to
 * stay true while they changed.
 *
 * Sixteen of the guards in `authorization/rules.ts` gained a REQUIRED board
 * in that task (`grep -cE ": BoardScope" …` answered 16 then and answers 29 at
 * HEAD — quote the grep, not the number; the additions since are wave 4 Task
 * 2's `assertCanPublishAgenda` and wave 5 Task 2's ten).
 * That is a change to how every one of them answers, so it needs more than
 * "the new case works":
 *
 *   1. **Additive.** For an account with no `board_overrides` — which is every
 *      account created from an `all_boards` template, and every account in the
 *      seed — passing a board must change NO answer, on any of the thirty
 *      codes. A tightening that also quietly revoked existing grants would be
 *      a far worse bug than the one being fixed.
 *
 *   2. **Tightening.** An account with a global grant and an override that
 *      REVOKES that action on one board must now be refused on that board and
 *      allowed elsewhere. Before this change it was allowed everywhere,
 *      because the guards resolved globally and never looked at the override.
 *      That is a wrongly-permissive case, not a regression: the town wrote
 *      "not on this board" and the system ignored it.
 *
 * And the reason all of it matters: the two shipped `designated_boards`
 * permission templates put EVERY code they grant inside `board_overrides`,
 * with global all-false. A guard resolving those codes globally answers "no"
 * to every account either template ever created. Those templates have never
 * worked. The end-to-end section below seeds an account exactly as the product
 * writes one — name-keyed, via `buildPermissionsFromTemplate` — and drives it
 * through the tRPC stack.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  TEMPLATE_BOARD_SPECIFIC_STAFF,
  TEMPLATE_RECORDING_SECRETARY,
  ALL_PERMISSION_ACTIONS,
  PERMISSIONS,
  buildPermissionsFromTemplate,
  type PermissionAction,
  type PermissionTemplateDefinition,
} from "@town-meeting/shared";
import { withTestDb } from "../../test/db-harness.js";
import {
  testDb,
  seedTown,
  seedActor,
  seedActorWithRawMatrix,
  seedBoardSeat,
  contextFor,
  expectTrpcError,
  expectRefusal,
  inTown,
} from "./fixtures.js";
import { resolvePermission, PERMISSION_CODES } from "../authorization/permission.js";
import type { PermissionCode } from "../authorization/permission.js";
import {
  router,
  protectedProcedure,
  requireBoardPermission,
  boardIdFrom,
  createCallerFactory,
} from "../trpc.js";
import * as rules from "../authorization/rules.js";

// ═══════════════════════════════════════════════════════════════════════
// 1. Additive
// ═══════════════════════════════════════════════════════════════════════

describe("board scope is additive for an account with no overrides", () => {
  it("answers identically with and without a board, on all 30 codes, for every role", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      // Every role, and both a full global matrix and an empty one — the two
      // ends of what "no board_overrides" can mean.
      const actors = await Promise.all([
        seedActor(db, town, { role: "admin" }),
        seedActor(db, town, { role: "sys_admin", global: [...PERMISSION_CODES] }),
        seedActor(db, town, { role: "staff", global: [...PERMISSION_CODES] }),
        seedActor(db, town, { role: "staff", global: [] }),
        seedActor(db, town, { role: "staff", global: ["A2", "M3", "R1", "R4", "A3", "M2"] }),
        seedActor(db, town, { role: "board_member" }),
      ]);

      for (const { actor } of actors) {
        expect(actor.permissions.board_overrides ?? []).toEqual([]);
        for (const code of PERMISSION_CODES) {
          const global = resolvePermission(actor, code);
          expect(
            resolvePermission(actor, code, town.boardId),
            `${actor.role} ${code}: passing a board must not change the answer`,
          ).toBe(global);
          expect(resolvePermission(actor, code, town.otherBoardId), `${actor.role} ${code}`).toBe(
            global,
          );
        }
      }
    });
  });

  it("still allows a globally-granted clerk on every board, through the guards themselves", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const clerk = await seedActor(db, town, {
        role: "staff",
        global: ["A2", "M2", "M3", "R1", "R4", "A3"],
      });

      for (const boardId of [town.boardId, town.otherBoardId]) {
        const scope = { boardId };
        expect(() => rules.assertCanInsertAgendaItem(clerk.actor, scope)).not.toThrow();
        expect(() => rules.assertCanInsertMotion(clerk.actor, scope)).not.toThrow();
        expect(() => rules.assertCanInsertMeetingAttendance(clerk.actor, scope)).not.toThrow();
        expect(() => rules.assertCanInsertMinutesDocument(clerk.actor, scope)).not.toThrow();
        expect(() => rules.assertCanInsertExhibit(clerk.actor, scope)).not.toThrow();
        expect(rules.canSelectMinutesDocument(clerk.actor, { status: "draft", boardId })).toBe(
          true,
        );
        expect(rules.canSelectExhibit(clerk.actor, { visibility: "admin_only", boardId })).toBe(
          true,
        );
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Tightening
// ═══════════════════════════════════════════════════════════════════════

/**
 * The families, as (code, a guard that consults it) pairs.
 *
 * One per action family rather than one per guard: the guards inside a family
 * differ only in the message, and a table that lists every guard invites the
 * reader to skim it rather than check it.
 */
const FAMILIES: ReadonlyArray<{
  code: PermissionCode;
  label: string;
  allowed: (actor: rules.ActorArg, boardId: string) => boolean;
}> = [
  {
    code: "A2",
    label: "agenda_item writes",
    allowed: (actor, boardId) => !throws(() => rules.assertCanInsertAgendaItem(actor, { boardId })),
  },
  {
    code: "M3",
    label: "motion writes",
    allowed: (actor, boardId) => !throws(() => rules.assertCanInsertMotion(actor, { boardId })),
  },
  {
    code: "M2",
    label: "attendance writes",
    allowed: (actor, boardId) =>
      !throws(() => rules.assertCanInsertMeetingAttendance(actor, { boardId })),
  },
  {
    code: "R1",
    label: "minutes writes",
    allowed: (actor, boardId) =>
      !throws(() => rules.assertCanInsertMinutesDocument(actor, { boardId })),
  },
  {
    code: "R4",
    label: "draft minutes reads",
    allowed: (actor, boardId) =>
      rules.canSelectMinutesDocument(actor, { status: "draft", boardId }),
  },
  {
    code: "A3",
    label: "exhibit reads",
    allowed: (actor, boardId) =>
      rules.canSelectExhibit(actor, { visibility: "admin_only", boardId }),
  },
  {
    // Listed separately from the read above even though both turn on A3. The
    // insert guard has a SECOND branch — `isBoardMember(actor)` — and a
    // mutation that dropped the board from it survived every other test here,
    // because the read guard's own test covered the same code by a different
    // route. Two branches, two tests.
    code: "A3",
    label: "exhibit uploads",
    allowed: (actor, boardId) => !throws(() => rules.assertCanInsertExhibit(actor, { boardId })),
  },
  {
    // Phase E wave 4, Task 2. A5 (`publish_agenda`) is in
    // `BOARD_SCOPED_CODES` and in `TEMPLATE_BOARD_SPECIFIC_STAFF`, but had no
    // guard in this codebase at all until that task — so this table, which
    // exists to prove every board-scoped family is actually board-scoped,
    // silently skipped one of the families the templates grant.
    code: "A5",
    label: "agenda publication",
    allowed: (actor, boardId) => !throws(() => rules.assertCanPublishAgenda(actor, { boardId })),
  },
  // Phase E wave 5, Task 2. M6, M7 and M1 are all in `BOARD_SCOPED_CODES` and
  // in `TEMPLATE_BOARD_SPECIFIC_STAFF`, and before that task the strings "M6"
  // and "M7" did not occur in `packages/api` at all — not even as a fixture,
  // which is how A5 above at least showed up. M1 occurred only inside
  // `assertCanUpdateMeeting`'s third branch, where this table could not reach
  // it: that rule's FIRST branch is A1, so a `global: ["M1"]` actor and a
  // `global: []` actor answer identically through it and the revoking-override
  // case below would have proved nothing about M1 specifically.
  {
    code: "M6",
    label: "executive session writes",
    allowed: (actor, boardId) =>
      !throws(() => rules.assertCanInsertExecutiveSession(actor, { boardId })),
  },
  {
    code: "M7",
    label: "speaker queue writes",
    allowed: (actor, boardId) =>
      !throws(() => rules.assertCanInsertGuestSpeaker(actor, { boardId })),
  },
  {
    code: "M1",
    label: "agenda item transitions",
    allowed: (actor, boardId) =>
      !throws(() => rules.assertCanInsertAgendaItemTransition(actor, { boardId })),
  },
  {
    // Listed separately from the transition above even though both turn on M1,
    // for the reason the two A3 entries are listed separately: they are
    // different tables with different resolvers ahead of them, and a mutation
    // that dropped the board from one would be covered by the other's test.
    code: "M1",
    label: "future item queue writes",
    allowed: (actor, boardId) => !throws(() => rules.assertCanInsertFutureItem(actor, { boardId })),
  },
  {
    code: "M3",
    label: "vote record clearing",
    allowed: (actor, boardId) => !throws(() => rules.assertCanDeleteVoteRecord(actor, { boardId })),
  },
];

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

describe("board scope honours an override that REVOKES", () => {
  it("denies on the barred board and allows everywhere else, for every action family", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      for (const family of FAMILIES) {
        // Global grant, revoked on one board. Before D1d every one of these
        // resolved globally and this caller was ALLOWED on the barred board.
        const revoked = await seedActor(db, town, {
          role: "staff",
          global: [family.code],
          boardOverrides: [{ boardId: town.boardId, permissions: { [family.code]: false } }],
        });
        expect(family.allowed(revoked.actor, town.boardId), `${family.label}: barred board`).toBe(
          false,
        );
        expect(
          family.allowed(revoked.actor, town.otherBoardId),
          `${family.label}: other board`,
        ).toBe(true);

        // And the mirror: nothing globally, granted on one board only. This is
        // the case the designated_boards templates create, and a global check
        // refuses it everywhere.
        const boardOnly = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { [family.code]: true } }],
        });
        expect(
          family.allowed(boardOnly.actor, town.boardId),
          `${family.label}: granted board`,
        ).toBe(true);
        expect(
          family.allowed(boardOnly.actor, town.otherBoardId),
          `${family.label}: ungranted board`,
        ).toBe(false);
      }
    });
  });

  it("scopes the M3 branch of vote_record INSERT too, without touching the self-vote branch", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      const clerk = await seedActor(db, town, {
        role: "staff",
        global: ["M3"],
        boardOverrides: [{ boardId: town.boardId, permissions: { M3: false } }],
      });
      const member = await seedActor(db, town, { role: "board_member" });
      const seat = await seedBoardSeat(db, town, member.personId, town.boardId);

      await inTown(db, town, async (tx) => {
        // Barred on this board — even though M3 is held globally.
        await expectRefusal(() =>
          rules.assertCanInsertVoteRecord(clerk.actor, tx, {
            boardMemberId: seat,
            boardId: town.boardId,
          }),
        );
        // Allowed on the other one.
        await expect(
          rules.assertCanInsertVoteRecord(clerk.actor, tx, {
            boardMemberId: seat,
            boardId: town.otherBoardId,
          }),
        ).resolves.toBeUndefined();

        // The self-vote branch is a database question about the SEAT and does
        // not consult M3 at all, so board scope must not have changed it.
        await expect(
          rules.assertCanInsertVoteRecord(member.actor, tx, {
            boardMemberId: seat,
            boardId: town.boardId,
          }),
        ).resolves.toBeUndefined();
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. The list rules decide PER ROW
// ═══════════════════════════════════════════════════════════════════════

describe("the list-filtering rules take the board from the ROW", () => {
  it("shows a board-designated secretary their own board's drafts and not another board's", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      const secretary = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { R4: true } }],
      });

      // One list, two boards. A single `scope` argument would have to pick
      // one of them and answer that for both rows — which is the whole reason
      // the board arrives on the row instead.
      const rows = [
        { id: "mine-draft", status: "draft" as const, boardId: town.boardId },
        { id: "theirs-draft", status: "draft" as const, boardId: town.otherBoardId },
        { id: "theirs-published", status: "published" as const, boardId: town.otherBoardId },
      ];

      expect(rules.visibleMinutesDocuments(secretary.actor, rows).map((r) => r.id)).toEqual([
        "mine-draft",
        // Not `theirs-draft`: R4 is granted on one board only.
        "theirs-published",
      ]);
    });
  });

  it("filters exhibits per row as well", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const uploader = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { A3: true } }],
      });

      const rows = [
        { id: "mine-admin", visibility: "admin_only" as const, boardId: town.boardId },
        { id: "theirs-admin", visibility: "admin_only" as const, boardId: town.otherBoardId },
        { id: "theirs-public", visibility: "public" as const, boardId: town.otherBoardId },
      ];

      expect(rules.visibleExhibits(uploader.actor, rows).map((r) => r.id)).toEqual([
        "mine-admin",
        "theirs-public",
      ]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. The two designated_boards templates, end to end
// ═══════════════════════════════════════════════════════════════════════

/**
 * The matrix `StaffAccountFlow.tsx` produces for a `designated_boards`
 * template, reproduced here rather than imported.
 *
 * Reproduced because the point is the SHAPE that reaches the database, and
 * importing a helper the component also uses would test the two against each
 * other instead of against the storage format. Note what it is: global
 * all-false, everything in `board_overrides`, keyed by action NAME (the
 * component builds it with `buildPermissionsFromTemplate`, which returns
 * `Record<PermissionAction, boolean>`, and the dialogs persist it verbatim).
 */
function matrixAsTheProductWritesIt(template: PermissionTemplateDefinition, boardIds: string[]) {
  const global: Record<string, boolean> = {};
  for (const action of ALL_PERMISSION_ACTIONS) global[action] = false;

  const granted = buildPermissionsFromTemplate(template);
  return {
    global,
    board_overrides: boardIds.map((board_id) => ({
      board_id,
      permissions: Object.fromEntries(
        Object.entries(granted)
          .filter(([, v]) => v)
          .map(([k]) => [k, true]),
      ),
    })),
  };
}

const codeFor = (action: PermissionAction): PermissionCode =>
  PERMISSION_CODES.find((c) => PERMISSIONS[c] === action)!;

/** A router covering the codes the two templates grant that have a guard. */
const templateRouter = router({
  // `.use(...)` declared BEFORE `.input(...)` on all four — the position
  // conventions item 2 requires (Task 2's fix round: `.input().use(guard)`
  // is the preemptable order this test suite must not model, since item 2
  // points readers at real files, not only prose, for the correct shape).
  editAgenda: protectedProcedure
    .use(requireBoardPermission("A2", boardIdFrom()))
    .input(z.object({ boardId: z.string().uuid() }))
    .mutation(() => "ok" as const),
  recordAttendance: protectedProcedure
    .use(requireBoardPermission("M2", boardIdFrom()))
    .input(z.object({ boardId: z.string().uuid() }))
    .mutation(() => "ok" as const),
  recordMotion: protectedProcedure
    .use(requireBoardPermission("M3", boardIdFrom()))
    .input(z.object({ boardId: z.string().uuid() }))
    .mutation(() => "ok" as const),
  editMinutes: protectedProcedure
    .use(requireBoardPermission("R1", boardIdFrom()))
    .input(z.object({ boardId: z.string().uuid() }))
    .mutation(() => "ok" as const),

  /**
   * A row rule rather than a middleware one — R4 cannot be decided before the
   * rows are read. The rows deliberately span two boards.
   */
  listDraftMinutes: protectedProcedure
    .input(z.object({ boards: z.array(z.string().uuid()) }))
    .query(async ({ ctx, input }) => {
      const actor = await ctx.actor();
      const rows = input.boards.map((boardId) => ({
        id: boardId,
        status: "draft" as const,
        boardId,
      }));
      return rules.visibleMinutesDocuments(actor, rows).map((r) => r.id);
    }),
});

const callTemplateRouter = createCallerFactory(templateRouter);

describe("the designated_boards permission templates, seeded as the product writes them", () => {
  for (const template of [TEMPLATE_BOARD_SPECIFIC_STAFF, TEMPLATE_RECORDING_SECRETARY]) {
    it(`${template.name}: every granted code resolves on the designated board and nowhere else`, async () => {
      await withTestDb(async (client) => {
        const db = testDb(client);
        const town = await seedTown(db);
        const account = await seedActorWithRawMatrix(
          db,
          town,
          "staff",
          matrixAsTheProductWritesIt(template, [town.boardId]),
        );

        for (const action of template.permissions) {
          const code = codeFor(action);
          // The bug, stated as an assertion: resolved globally, EVERY one of
          // these is false, because the template grants nothing globally.
          expect(resolvePermission(account.actor, code), `${code} has no global grant`).toBe(false);
          expect(
            resolvePermission(account.actor, code, town.boardId),
            `${code} must resolve on the designated board`,
          ).toBe(true);
          expect(
            resolvePermission(account.actor, code, town.otherBoardId),
            `${code} must not reach an undesignated board`,
          ).toBe(false);
        }

        // And the codes the template does NOT grant stay refused on the
        // designated board — the override is a grant list, not a blank cheque.
        const grantedCodes = new Set(template.permissions.map(codeFor));
        for (const code of PERMISSION_CODES) {
          if (grantedCodes.has(code)) continue;
          expect(
            resolvePermission(account.actor, code, town.boardId),
            `${code} is not in ${template.name}`,
          ).toBe(false);
        }
      });
    });

    it(`${template.name}: works through the tRPC stack on its board, and is refused off it`, async () => {
      await withTestDb(async (client) => {
        const db = testDb(client);
        const town = await seedTown(db);
        const account = await seedActorWithRawMatrix(
          db,
          town,
          "staff",
          matrixAsTheProductWritesIt(template, [town.boardId]),
        );
        const caller = callTemplateRouter(contextFor(db, town, account));

        const granted = new Set(template.permissions);
        const procedures = [
          ["A2", () => caller.editAgenda({ boardId: town.boardId })],
          ["M2", () => caller.recordAttendance({ boardId: town.boardId })],
          ["M3", () => caller.recordMotion({ boardId: town.boardId })],
          ["R1", () => caller.editMinutes({ boardId: town.boardId })],
        ] as const;
        const offBoard = [
          ["A2", () => caller.editAgenda({ boardId: town.otherBoardId })],
          ["M2", () => caller.recordAttendance({ boardId: town.otherBoardId })],
          ["M3", () => caller.recordMotion({ boardId: town.otherBoardId })],
          ["R1", () => caller.editMinutes({ boardId: town.otherBoardId })],
        ] as const;

        for (const [code, call] of procedures) {
          if (!granted.has(PERMISSIONS[code])) continue;
          await expect(call(), `${template.name} grants ${code}`).resolves.toBe("ok");
        }
        for (const [code, call] of offBoard) {
          if (!granted.has(PERMISSIONS[code])) continue;
          expect(
            (await expectTrpcError(call)).code,
            `${template.name} must not carry ${code} to another board`,
          ).toBe("FORBIDDEN");
        }

        // R4 through the row rule: the designated board's draft only.
        await expect(
          caller.listDraftMinutes({ boards: [town.boardId, town.otherBoardId] }),
        ).resolves.toEqual([town.boardId]);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 5. The rules Phase E wave 5, Task 2 added — one named test each
//
// The FAMILIES table above proves a family is board-SCOPED. It does not prove
// a rule consults the RIGHT code: a guard that resolved M7 where the product
// means M6 would pass every assertion in it, because both codes are granted
// and revoked together by the actors that table seeds.
//
// So each rule below gets its own named test, and each test seeds an actor
// holding EVERY code except the one under test. That shape fails two ways at
// once, which is what makes it a mutation pin rather than a restatement:
//
//   - delete the `assertPermission` call and the function is a no-op, so the
//     "refuses" half goes red;
//   - change the code (M6 → M7, M1 → A2, M3 → M8) and the actor holding all
//     twenty-nine other codes is ALLOWED, so the "refuses" half goes red too.
//
// Verified by mutation, one rule at a time, in this task's own fix pass — see
// the task report for the recorded output of each.
// ═══════════════════════════════════════════════════════════════════════

const WAVE_5_RULES: ReadonlyArray<{
  rule: string;
  code: PermissionCode;
  call: (actor: rules.ActorArg, boardId: string) => void;
}> = [
  {
    rule: "assertCanInsertExecutiveSession",
    code: "M6",
    call: (actor, boardId) => rules.assertCanInsertExecutiveSession(actor, { boardId }),
  },
  {
    rule: "assertCanUpdateExecutiveSession",
    code: "M6",
    call: (actor, boardId) => rules.assertCanUpdateExecutiveSession(actor, { boardId }),
  },
  {
    rule: "assertCanDeleteExecutiveSession",
    code: "M6",
    call: (actor, boardId) => rules.assertCanDeleteExecutiveSession(actor, { boardId }),
  },
  {
    rule: "assertCanInsertGuestSpeaker",
    code: "M7",
    call: (actor, boardId) => rules.assertCanInsertGuestSpeaker(actor, { boardId }),
  },
  {
    rule: "assertCanDeleteGuestSpeaker",
    code: "M7",
    call: (actor, boardId) => rules.assertCanDeleteGuestSpeaker(actor, { boardId }),
  },
  {
    rule: "assertCanInsertAgendaItemTransition",
    code: "M1",
    call: (actor, boardId) => rules.assertCanInsertAgendaItemTransition(actor, { boardId }),
  },
  {
    rule: "assertCanUpdateAgendaItemTransition",
    code: "M1",
    call: (actor, boardId) => rules.assertCanUpdateAgendaItemTransition(actor, { boardId }),
  },
  {
    rule: "assertCanInsertFutureItem",
    code: "M1",
    call: (actor, boardId) => rules.assertCanInsertFutureItem(actor, { boardId }),
  },
  {
    rule: "assertCanDeleteVoteRecord",
    code: "M3",
    call: (actor, boardId) => rules.assertCanDeleteVoteRecord(actor, { boardId }),
  },
];

describe("the live-meeting rules wave 5 added resolve their OWN code", () => {
  for (const { rule, code, call } of WAVE_5_RULES) {
    it(`${rule} requires ${code} on the board, and nothing else substitutes for it`, async () => {
      await withTestDb(async (client) => {
        const db = testDb(client);
        const town = await seedTown(db);

        // Granted exactly this code, on one board only — the shape the two
        // `designated_boards` templates actually produce.
        const held = await seedActor(db, town, {
          role: "staff",
          global: [],
          boardOverrides: [{ boardId: town.boardId, permissions: { [code]: true } }],
        });
        expect(() => call(held.actor, town.boardId), `${rule}: granted board`).not.toThrow();
        await expectRefusal(() => call(held.actor, town.otherBoardId), { code });

        // Every OTHER code, globally, and not this one. A rule keyed to the
        // wrong code would allow this caller.
        const everythingElse = await seedActor(db, town, {
          role: "staff",
          global: PERMISSION_CODES.filter((c) => c !== code),
        });
        await expectRefusal(() => call(everythingElse.actor, town.boardId), { code });

        // And an administrator is still allowed — `resolvePermission`
        // short-circuits the role, and no rule here re-states that.
        const admin = await seedActor(db, town, { role: "admin" });
        expect(() => call(admin.actor, town.boardId), `${rule}: admin`).not.toThrow();
      });
    });
  }
});

describe("assertCanDeleteVoteRecord does NOT carry rule 5's self-vote branch", () => {
  it("refuses a board member clearing the votes on a motion of their own board", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const member = await seedActor(db, town, { role: "board_member" });
      await seedBoardSeat(db, town, member.personId, town.boardId);

      // The same actor `assertCanInsertVoteRecord` ALLOWS on this seat (M8,
      // `BOARD_MEMBER_ALWAYS_ACTIONS`). The delete the product performs is
      // `.eq("motion_id", motionId)` — every member's vote on that motion, not
      // one seat's — so the self-vote branch must not reach it.
      await expectRefusal(
        () => rules.assertCanDeleteVoteRecord(member.actor, { boardId: town.boardId }),
        {
          code: "M3",
        },
      );
    });
  });
});

describe("assertCanUpdateAgendaItemProgress takes M1 OR A2 — both branches, per board", () => {
  it("allows a presiding officer holding M1 and NO A2, on their own board only", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const officer = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { M1: true } }],
      });

      // The whole point of the rule: this caller is refused by every OTHER
      // agenda_item rule, which is A2-only.
      expect(() =>
        rules.assertCanUpdateAgendaItemProgress(officer.actor, { boardId: town.boardId }),
      ).not.toThrow();
      await expectRefusal(
        () => rules.assertCanUpdateAgendaItem(officer.actor, { boardId: town.boardId }),
        { code: "A2" },
      );
      await expectRefusal(
        () =>
          rules.assertCanUpdateAgendaItemProgress(officer.actor, { boardId: town.otherBoardId }),
        { code: "M1" },
      );
    });
  });

  it("allows a clerk holding A2 and NO M1, so the rule only widens", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const clerk = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { A2: true } }],
      });

      expect(() =>
        rules.assertCanUpdateAgendaItemProgress(clerk.actor, { boardId: town.boardId }),
      ).not.toThrow();
      await expectRefusal(
        () => rules.assertCanUpdateAgendaItemProgress(clerk.actor, { boardId: town.otherBoardId }),
        { code: "M1" },
      );
    });
  });

  it("refuses a caller holding every code except A2 and M1", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const other = await seedActor(db, town, {
        role: "staff",
        global: PERMISSION_CODES.filter((c) => c !== "A2" && c !== "M1"),
      });

      await expectRefusal(
        () => rules.assertCanUpdateAgendaItemProgress(other.actor, { boardId: town.boardId }),
        { code: "M1" },
      );
    });
  });

  it("honours a REVOKING override on BOTH branches, not just the first one checked", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      // Holds both codes globally; the town barred this board from both. A
      // rule that resolved either code globally would allow this caller.
      const barred = await seedActor(db, town, {
        role: "staff",
        global: ["A2", "M1"],
        boardOverrides: [{ boardId: town.boardId, permissions: { A2: false, M1: false } }],
      });

      await expectRefusal(
        () => rules.assertCanUpdateAgendaItemProgress(barred.actor, { boardId: town.boardId }),
        { code: "M1" },
      );
      expect(() =>
        rules.assertCanUpdateAgendaItemProgress(barred.actor, { boardId: town.otherBoardId }),
      ).not.toThrow();

      // Revoking only ONE of the two must still leave the other working —
      // otherwise "A2 OR M1" would silently be "A2 AND M1".
      const a2Only = await seedActor(db, town, {
        role: "staff",
        global: ["A2", "M1"],
        boardOverrides: [{ boardId: town.boardId, permissions: { M1: false } }],
      });
      expect(() =>
        rules.assertCanUpdateAgendaItemProgress(a2Only.actor, { boardId: town.boardId }),
      ).not.toThrow();
    });
  });
});
