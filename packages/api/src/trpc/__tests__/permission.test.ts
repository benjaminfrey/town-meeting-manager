/**
 * Stage 1, Task D1, Step 1 — the 21 authorization rules.
 *
 * Phase B removed every authorization predicate from RLS on purpose: a policy
 * reading `town_id = get_current_town_id() AND has_permission('R4')` denies
 * every row when the permission half fails for an unrelated reason, which is
 * indistinguishable from a working tenancy check and would have let the
 * tenancy gate pass for the wrong reason. The intended design is a split —
 * tenancy in RLS, permissions in tested TypeScript. This file is the tested
 * half, and until it existed the permission half did not exist at all.
 *
 * The rules are transcribed from the policies Phase B deleted, which are still
 * in the repository as history:
 *   supabase/migrations/20260308000033_rls_agenda_motion_vote.sql
 *   supabase/migrations/20260308000034_rls_minutes_exhibit.sql
 *   supabase/migrations/20260308000035_rls_notification.sql
 *   supabase/migrations/20260308000036_rls_meeting.sql
 * and their helper semantics from
 *   supabase/migrations/20260308000027_create_rls_helper_functions.sql
 *
 * Each rule gets at least one caller that succeeds and one that is refused,
 * and each one has been mutation-verified: the check was deleted, the test was
 * run, and the failure recorded in the task report. A rule whose test still
 * passes with the check removed is not protecting anything.
 */

import { describe, it, expect } from "vitest";
import { withTestDb } from "../../test/db-harness.js";
import {
  testDb,
  seedTown,
  seedActor,
  seedBoardSeat,
  expectRefusal,
  inTown,
  type TestDb,
  type TownFixture,
} from "./fixtures.js";
import { anonymousActor } from "../authorization/actor.js";
import * as rules from "../authorization/rules.js";

/**
 * Set up the cast used by most rules: an admin, a staff member with the
 * permission under test, a staff member without it, a sys_admin and a board
 * member.
 */
async function cast(
  db: TestDb,
  town: TownFixture,
  code: Parameters<typeof seedActor>[2]["global"],
) {
  const [admin, granted, denied, sysAdmin, boardMember] = await Promise.all([
    seedActor(db, town, { role: "admin" }),
    seedActor(db, town, { role: "staff", global: code }),
    seedActor(db, town, { role: "staff", global: [] }),
    seedActor(db, town, { role: "sys_admin" }),
    seedActor(db, town, { role: "board_member" }),
  ]);
  return { admin, granted, denied, sysAdmin, boardMember };
}

describe("the 21 authorization rules", () => {
  // ─── Rules 1–2: agenda_item, A2 ──────────────────────────────────────
  it("1/2: agenda_item INSERT and UPDATE require A2", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { admin, granted, denied, sysAdmin } = await cast(db, town, ["A2"]);

      expect(() => rules.assertCanInsertAgendaItem(granted.actor)).not.toThrow();
      expect(() => rules.assertCanInsertAgendaItem(admin.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanInsertAgendaItem(denied.actor), { code: "A2" });
      await expectRefusal(() => rules.assertCanInsertAgendaItem(sysAdmin.actor), { code: "A2" });
      await expectRefusal(() => rules.assertCanInsertAgendaItem(anonymousActor(town.townId)), {
        code: "A2",
      });

      expect(() => rules.assertCanUpdateAgendaItem(granted.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanUpdateAgendaItem(denied.actor), { code: "A2" });
    });
  });

  // ─── Rules 3–4: motion, M3 ───────────────────────────────────────────
  it("3/4: motion INSERT and UPDATE require M3", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { admin, granted, denied, boardMember } = await cast(db, town, ["M3"]);

      expect(() => rules.assertCanInsertMotion(granted.actor)).not.toThrow();
      expect(() => rules.assertCanInsertMotion(admin.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanInsertMotion(denied.actor), { code: "M3" });
      // A board member may vote; recording the motion itself is staff work.
      await expectRefusal(() => rules.assertCanInsertMotion(boardMember.actor), { code: "M3" });

      expect(() => rules.assertCanUpdateMotion(granted.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanUpdateMotion(denied.actor), { code: "M3" });
    });
  });

  // ─── Rule 5: vote_record INSERT — M3 OR own seat ─────────────────────
  it("5: vote_record INSERT accepts M3, or a board member casting their OWN vote", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { granted, denied, boardMember } = await cast(db, town, ["M3"]);
      const other = await seedActor(db, town, { role: "board_member" });

      const ownSeat = await seedBoardSeat(db, town, boardMember.personId, town.boardId);
      const othersSeat = await seedBoardSeat(db, town, other.personId, town.boardId);
      const archivedSeat = await seedBoardSeat(
        db,
        town,
        boardMember.personId,
        town.otherBoardId,
        "archived",
      );

      await inTown(db, town, async (tx) => {
        // Clerk with M3 records anybody's vote.
        await expect(
          rules.assertCanInsertVoteRecord(granted.actor, tx, { boardMemberId: othersSeat }),
        ).resolves.toBeUndefined();

        // Board member casting their own vote — no M3 needed.
        await expect(
          rules.assertCanInsertVoteRecord(boardMember.actor, tx, { boardMemberId: ownSeat }),
        ).resolves.toBeUndefined();

        // Board member casting SOMEONE ELSE'S vote — refused.
        await expectRefusal(() =>
          rules.assertCanInsertVoteRecord(boardMember.actor, tx, { boardMemberId: othersSeat }),
        );

        // An archived seat is not a seat. Casting through it is refused.
        await expectRefusal(() =>
          rules.assertCanInsertVoteRecord(boardMember.actor, tx, { boardMemberId: archivedSeat }),
        );

        // Staff with no M3 is refused even for a seat that is not theirs.
        await expectRefusal(() =>
          rules.assertCanInsertVoteRecord(denied.actor, tx, { boardMemberId: othersSeat }),
        );
      });
    });
  });

  // ─── Rule 6: vote_record UPDATE — M3 only ────────────────────────────
  it("6: vote_record UPDATE requires M3 — a board member cannot correct their own vote", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { granted, denied, boardMember } = await cast(db, town, ["M3"]);

      expect(() => rules.assertCanUpdateVoteRecord(granted.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanUpdateVoteRecord(denied.actor), { code: "M3" });
      // Deliberately narrower than INSERT: correcting a recorded vote is a
      // records action, not a voting action. The removed policy said so.
      await expectRefusal(() => rules.assertCanUpdateVoteRecord(boardMember.actor), { code: "M3" });
    });
  });

  // ─── Rules 7–8: meeting_attendance, M2 ───────────────────────────────
  it("7/8: meeting_attendance INSERT and UPDATE require M2", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { admin, granted, denied } = await cast(db, town, ["M2"]);

      expect(() => rules.assertCanInsertMeetingAttendance(granted.actor)).not.toThrow();
      expect(() => rules.assertCanInsertMeetingAttendance(admin.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanInsertMeetingAttendance(denied.actor), {
        code: "M2",
      });

      expect(() => rules.assertCanUpdateMeetingAttendance(granted.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanUpdateMeetingAttendance(denied.actor), {
        code: "M2",
      });
    });
  });

  // ─── Rule 9: minutes_document SELECT — R4 OR approved/published ──────
  it("9: minutes_document SELECT needs R4 for draft/review; approved/published are open", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { granted, denied } = await cast(db, town, ["R4"]);

      for (const status of ["draft", "review"] as const) {
        expect(rules.canSelectMinutesDocument(granted.actor, { status })).toBe(true);
        expect(rules.canSelectMinutesDocument(denied.actor, { status })).toBe(false);
        await expectRefusal(() => rules.assertCanSelectMinutesDocument(denied.actor, { status }), {
          code: "R4",
        });
      }

      for (const status of ["approved", "published"] as const) {
        expect(rules.canSelectMinutesDocument(denied.actor, { status })).toBe(true);
        expect(() => rules.assertCanSelectMinutesDocument(denied.actor, { status })).not.toThrow();
      }

      // The list form must filter, not throw — a clerk without R4 listing a
      // meeting's minutes should see the adopted ones, not an error.
      const rows = [
        { id: "d", status: "draft" as const },
        { id: "r", status: "review" as const },
        { id: "a", status: "approved" as const },
        { id: "p", status: "published" as const },
      ];
      expect(rules.visibleMinutesDocuments(denied.actor, rows).map((r) => r.id)).toEqual([
        "a",
        "p",
      ]);
      expect(rules.visibleMinutesDocuments(granted.actor, rows).map((r) => r.id)).toEqual([
        "d",
        "r",
        "a",
        "p",
      ]);
    });
  });

  // ─── Rules 10–13: minutes_document / minutes_section writes, R1 ──────
  it("10/11/12/13: minutes_document and minutes_section writes require R1", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { admin, granted, denied } = await cast(db, town, ["R1"]);

      for (const assert of [
        rules.assertCanInsertMinutesDocument,
        rules.assertCanUpdateMinutesDocument,
        rules.assertCanInsertMinutesSection,
        rules.assertCanUpdateMinutesSection,
      ]) {
        expect(() => assert(granted.actor)).not.toThrow();
        expect(() => assert(admin.actor)).not.toThrow();
        await expectRefusal(() => assert(denied.actor), { code: "R1" });
      }

      // R4 is a read permission and must not be mistaken for a write one.
      const reader = await seedActor(db, town, { role: "staff", global: ["R4"] });
      await expectRefusal(() => rules.assertCanUpdateMinutesDocument(reader.actor), { code: "R1" });
    });
  });

  // ─── Rule 14: exhibit SELECT — three tiers, three rules ──────────────
  it("14: exhibit SELECT applies a different rule to each of the three visibility tiers", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { admin, granted, denied, boardMember, sysAdmin } = await cast(db, town, ["A3"]);

      // public → every user of the town, whatever their permissions.
      for (const a of [admin, granted, denied, boardMember, sysAdmin]) {
        expect(rules.canSelectExhibit(a.actor, { visibility: "public" })).toBe(true);
      }

      // board_only → admin OR A3 OR the board_member role.
      expect(rules.canSelectExhibit(admin.actor, { visibility: "board_only" })).toBe(true);
      expect(rules.canSelectExhibit(granted.actor, { visibility: "board_only" })).toBe(true);
      expect(rules.canSelectExhibit(boardMember.actor, { visibility: "board_only" })).toBe(true);
      expect(rules.canSelectExhibit(denied.actor, { visibility: "board_only" })).toBe(false);
      expect(rules.canSelectExhibit(sysAdmin.actor, { visibility: "board_only" })).toBe(false);

      // admin_only → admin OR A3. The board_member role does NOT carry here,
      // which is the whole difference between this tier and the one above.
      expect(rules.canSelectExhibit(admin.actor, { visibility: "admin_only" })).toBe(true);
      expect(rules.canSelectExhibit(granted.actor, { visibility: "admin_only" })).toBe(true);
      expect(rules.canSelectExhibit(boardMember.actor, { visibility: "admin_only" })).toBe(false);
      expect(rules.canSelectExhibit(denied.actor, { visibility: "admin_only" })).toBe(false);

      await expectRefusal(() =>
        rules.assertCanSelectExhibit(boardMember.actor, { visibility: "admin_only" }),
      );

      const rows = [
        { id: "p", visibility: "public" as const },
        { id: "b", visibility: "board_only" as const },
        { id: "a", visibility: "admin_only" as const },
      ];
      expect(rules.visibleExhibits(boardMember.actor, rows).map((r) => r.id)).toEqual(["p", "b"]);
      expect(rules.visibleExhibits(denied.actor, rows).map((r) => r.id)).toEqual(["p"]);
      expect(rules.visibleExhibits(granted.actor, rows).map((r) => r.id)).toEqual(["p", "b", "a"]);
    });
  });

  // ─── Rules 15–16: exhibit writes ─────────────────────────────────────
  it("15/16: exhibit INSERT accepts A3 or the board_member role; UPDATE demands A3", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { admin, granted, denied, boardMember } = await cast(db, town, ["A3"]);

      expect(() => rules.assertCanInsertExhibit(granted.actor)).not.toThrow();
      expect(() => rules.assertCanInsertExhibit(admin.actor)).not.toThrow();
      // A4: a board member may upload their own material for review.
      expect(() => rules.assertCanInsertExhibit(boardMember.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanInsertExhibit(denied.actor), { code: "A3" });

      // UPDATE is strictly narrower — it is how visibility gets changed, so a
      // board member being able to upload must not imply being able to
      // promote an admin_only exhibit to public.
      expect(() => rules.assertCanUpdateExhibit(granted.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanUpdateExhibit(boardMember.actor), { code: "A3" });
      await expectRefusal(() => rules.assertCanUpdateExhibit(denied.actor), { code: "A3" });
    });
  });

  // ─── Rule 17: notification_event SELECT — C2 ─────────────────────────
  it("17: notification_event SELECT requires C2", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { admin, granted, denied } = await cast(db, town, ["C2"]);

      expect(() => rules.assertCanSelectNotificationEvent(granted.actor)).not.toThrow();
      expect(() => rules.assertCanSelectNotificationEvent(admin.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanSelectNotificationEvent(denied.actor), {
        code: "C2",
      });
    });
  });

  // ─── Rule 18: notification_delivery SELECT — C2 OR own ───────────────
  it("18: notification_delivery SELECT accepts C2, or the delivery being the caller's own", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { granted, denied } = await cast(db, town, ["C2"]);
      const stranger = await seedActor(db, town, { role: "staff", global: [] });

      // The subscriber is a PERSON, not a user_account — that is the owner's
      // Task 3 decision, and reading it off the wrong id silently shows one
      // person another person's notification history.
      expect(
        rules.canSelectNotificationDelivery(denied.actor, { subscriberId: denied.personId }),
      ).toBe(true);
      expect(
        rules.canSelectNotificationDelivery(denied.actor, { subscriberId: stranger.personId }),
      ).toBe(false);
      expect(
        rules.canSelectNotificationDelivery(granted.actor, { subscriberId: stranger.personId }),
      ).toBe(true);

      // Reading it off user_account_id would pass a naive test where the two
      // ids happen to match; they never match here.
      expect(
        rules.canSelectNotificationDelivery(denied.actor, { subscriberId: denied.userAccountId }),
      ).toBe(false);

      await expectRefusal(() =>
        rules.assertCanSelectNotificationDelivery(denied.actor, {
          subscriberId: stranger.personId,
        }),
      );

      const rows = [
        { id: "mine", subscriberId: denied.personId },
        { id: "theirs", subscriberId: stranger.personId },
      ];
      expect(rules.visibleNotificationDeliveries(denied.actor, rows).map((r) => r.id)).toEqual([
        "mine",
      ]);
      expect(rules.visibleNotificationDeliveries(granted.actor, rows).map((r) => r.id)).toEqual([
        "mine",
        "theirs",
      ]);
    });
  });

  // ─── Rule 19: subscriber_notification_preference SELECT ──────────────
  it("19: subscriber preferences are readable by their owner, or with C2", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const { granted, denied } = await cast(db, town, ["C2"]);
      const stranger = await seedActor(db, town, { role: "staff", global: [] });

      expect(rules.canSelectSubscriberPreference(denied.actor, { personId: denied.personId })).toBe(
        true,
      );
      expect(
        rules.canSelectSubscriberPreference(denied.actor, { personId: stranger.personId }),
      ).toBe(false);
      expect(
        rules.canSelectSubscriberPreference(granted.actor, { personId: stranger.personId }),
      ).toBe(true);

      await expectRefusal(() =>
        rules.assertCanSelectSubscriberPreference(denied.actor, { personId: stranger.personId }),
      );

      const rows = [
        { id: "mine", personId: denied.personId },
        { id: "theirs", personId: stranger.personId },
      ];
      expect(rules.visibleSubscriberPreferences(denied.actor, rows).map((r) => r.id)).toEqual([
        "mine",
      ]);
    });
  });

  // ─── Rule 20: meeting INSERT — A1, BOARD-SCOPED ──────────────────────
  it("20: meeting INSERT needs A1 FOR THAT BOARD — an override that grants and one that revokes", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      const admin = await seedActor(db, town, { role: "admin" });
      const globalA1 = await seedActor(db, town, { role: "staff", global: ["A1"] });
      const none = await seedActor(db, town, { role: "staff", global: [] });

      // Board-specific staff: no global A1, granted only on `boardId`.
      const boardOnly = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { A1: true } }],
      });

      // Global A1, REVOKED on `boardId`. This is the case `boardId: undefined`
      // got wrong in the other direction: passing no board silently ignores a
      // revocation, so this caller would have been allowed.
      const revoked = await seedActor(db, town, {
        role: "staff",
        global: ["A1"],
        boardOverrides: [{ boardId: town.boardId, permissions: { A1: false } }],
      });

      expect(() =>
        rules.assertCanInsertMeeting(admin.actor, { boardId: town.boardId }),
      ).not.toThrow();
      expect(() =>
        rules.assertCanInsertMeeting(globalA1.actor, { boardId: town.boardId }),
      ).not.toThrow();
      await expectRefusal(
        () => rules.assertCanInsertMeeting(none.actor, { boardId: town.boardId }),
        {
          code: "A1",
        },
      );

      // The grant is scoped: allowed on its own board, refused on the other.
      expect(() =>
        rules.assertCanInsertMeeting(boardOnly.actor, { boardId: town.boardId }),
      ).not.toThrow();
      await expectRefusal(
        () => rules.assertCanInsertMeeting(boardOnly.actor, { boardId: town.otherBoardId }),
        { code: "A1" },
      );

      // The revocation is honoured on its board, and only there.
      await expectRefusal(
        () => rules.assertCanInsertMeeting(revoked.actor, { boardId: town.boardId }),
        { code: "A1" },
      );
      expect(() =>
        rules.assertCanInsertMeeting(revoked.actor, { boardId: town.otherBoardId }),
      ).not.toThrow();
    });
  });

  // ─── Rule 21: meeting UPDATE — admin OR A1@board OR M1@board ─────────
  it("21: meeting UPDATE accepts admin, or A1 for that board, or M1 for that board", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      const admin = await seedActor(db, town, { role: "admin" });
      const none = await seedActor(db, town, { role: "staff", global: [] });
      const runsMeetings = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { M1: true } }],
      });
      const buildsAgendas = await seedActor(db, town, {
        role: "staff",
        global: [],
        boardOverrides: [{ boardId: town.boardId, permissions: { A1: true } }],
      });

      expect(() =>
        rules.assertCanUpdateMeeting(admin.actor, { boardId: town.boardId }),
      ).not.toThrow();
      expect(() =>
        rules.assertCanUpdateMeeting(runsMeetings.actor, { boardId: town.boardId }),
      ).not.toThrow();
      expect(() =>
        rules.assertCanUpdateMeeting(buildsAgendas.actor, { boardId: town.boardId }),
      ).not.toThrow();

      await expectRefusal(() =>
        rules.assertCanUpdateMeeting(none.actor, { boardId: town.boardId }),
      );
      // Both grants are board-scoped, so neither reaches the other board.
      await expectRefusal(() =>
        rules.assertCanUpdateMeeting(runsMeetings.actor, { boardId: town.otherBoardId }),
      );
      await expectRefusal(() =>
        rules.assertCanUpdateMeeting(buildsAgendas.actor, { boardId: town.otherBoardId }),
      );
    });
  });
});
