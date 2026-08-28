/**
 * Stage 1, Task D1 — the role and self-scoping predicates from Phase B's
 * report §4b.
 *
 * These are not action codes, which is exactly why they were at risk of being
 * dropped silently: the brief's checklist counts 21 rules, and §4b's ~25 admin
 * gates and 5 self-scoping rules are a separate list that nothing else in the
 * plan enumerates. They are authorization all the same, and two of them are
 * the most sensitive reads in the system:
 *
 *   - `town_notification_config` holds SMTP credentials and API keys.
 *   - `audit_log` is the record of who did what.
 *
 * Under Phase B's tenancy-only RLS, any session with a valid tenant context
 * can read both. This file is what closes that.
 *
 * Transcribed from the policies Phase B deleted:
 *   supabase/migrations/20260308000029_rls_town.sql
 *   supabase/migrations/20260308000030_rls_person_user_account.sql
 *   supabase/migrations/20260308000031_rls_board.sql
 *   supabase/migrations/20260308000035_rls_notification.sql
 *   supabase/migrations/20260308000036_rls_audit_template.sql
 *   supabase/migrations/20260310000002_rls_onboarding_inserts.sql
 */

import { describe, it, expect } from "vitest";
import { withTestDb } from "../../test/db-harness.js";
import { testDb, seedTown, seedActor, expectRefusal } from "./fixtures.js";
import { anonymousActor } from "../authorization/actor.js";
import * as rules from "../authorization/rules.js";

describe("§4b — admin gates", () => {
  it("gates every admin-only write behind the admin role, and nothing weaker", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);

      const admin = await seedActor(db, town, { role: "admin" });
      // A clerk template grants every operational code there is. None of them
      // is T1–T4, so none of them may open an admin gate — that is the whole
      // reason T1–T4 exist as a separate, non-delegable class.
      const clerk = await seedActor(db, town, {
        role: "staff",
        global: ["A1", "A2", "A3", "A5", "A6", "M1", "M2", "M3", "R1", "R4", "R5", "C2", "C5"],
      });
      const sysAdmin = await seedActor(db, town, { role: "sys_admin" });
      const boardMember = await seedActor(db, town, { role: "board_member" });

      const gates: Array<[string, (a: rules.ActorArg) => void]> = [
        ["town UPDATE", rules.assertCanUpdateTown],
        ["person INSERT", rules.assertCanInsertPerson],
        ["person UPDATE", rules.assertCanUpdatePerson],
        ["user_account INSERT", rules.assertCanInsertUserAccount],
        ["board INSERT", rules.assertCanInsertBoard],
        ["board UPDATE", rules.assertCanUpdateBoard],
        ["board_member INSERT", rules.assertCanInsertBoardMember],
        ["board_member UPDATE", rules.assertCanUpdateBoardMember],
        ["agenda_template INSERT", rules.assertCanInsertAgendaTemplate],
        ["agenda_template UPDATE", rules.assertCanUpdateAgendaTemplate],
        ["agenda_template DELETE", rules.assertCanDeleteAgendaTemplate],
        ["permission_template INSERT", rules.assertCanInsertPermissionTemplate],
        ["permission_template UPDATE", rules.assertCanUpdatePermissionTemplate],
        ["permission_template DELETE", rules.assertCanDeletePermissionTemplate],
        ["town_notification_config SELECT", rules.assertCanSelectTownNotificationConfig],
        ["town_notification_config INSERT", rules.assertCanInsertTownNotificationConfig],
        ["town_notification_config UPDATE", rules.assertCanUpdateTownNotificationConfig],
        ["notification_event INSERT", rules.assertCanInsertNotificationEvent],
        ["notification_delivery INSERT", rules.assertCanInsertNotificationDelivery],
        ["audit_log SELECT", rules.assertCanSelectAuditLog],
      ];

      expect(gates).toHaveLength(20);

      for (const [name, assert] of gates) {
        expect(() => assert(admin.actor), `${name} must allow an admin`).not.toThrow();
        await expectRefusal(() => assert(clerk.actor));
        await expectRefusal(() => assert(sysAdmin.actor));
        await expectRefusal(() => assert(boardMember.actor));
        await expectRefusal(() => assert(anonymousActor(town.townId)));
      }
    });
  });

  it("keeps the SMTP credentials in town_notification_config out of a clerk's reach", async () => {
    // Called out separately from the loop above because it is the single most
    // sensitive read on this list, and because Phase B's report names it as
    // the one D1 must not miss.
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const clerk = await seedActor(db, town, { role: "staff", global: ["C2", "C5"] });

      // C2 is "manage notification settings" and it is emphatically NOT
      // "read the mail server password".
      await expectRefusal(() => rules.assertCanSelectTownNotificationConfig(clerk.actor));
    });
  });

  it("audit_log is admin-read but town-wide-write, exactly as the policy had it", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const admin = await seedActor(db, town, { role: "admin" });
      const staff = await seedActor(db, town, { role: "staff", global: [] });

      expect(() => rules.assertCanSelectAuditLog(admin.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanSelectAuditLog(staff.actor));

      // Any signed-in member of the town may append — the app records "viewed
      // agenda", "downloaded PDF" for ordinary users, so gating the write
      // would empty the log rather than protect it.
      expect(() => rules.assertCanInsertAuditLog(staff.actor)).not.toThrow();
      await expectRefusal(() => rules.assertCanInsertAuditLog(anonymousActor(town.townId)));
    });
  });
});

describe("§4b — self-scoping", () => {
  it("lets a person read, create and change their OWN notification preferences and nobody else's", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const admin = await seedActor(db, town, { role: "admin" });
      const me = await seedActor(db, town, { role: "staff", global: [] });
      const other = await seedActor(db, town, { role: "staff", global: [] });

      for (const assert of [
        rules.assertCanInsertSubscriberPreference,
        rules.assertCanUpdateSubscriberPreference,
      ]) {
        expect(() => assert(me.actor, { personId: me.personId })).not.toThrow();
        // Admin may set preferences for others (bulk setup).
        expect(() => assert(admin.actor, { personId: me.personId })).not.toThrow();
        await expectRefusal(() => assert(me.actor, { personId: other.personId }));
      }
    });
  });

  it("lets a user update their own user_account row, and otherwise requires admin", async () => {
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db);
      const admin = await seedActor(db, town, { role: "admin" });
      const me = await seedActor(db, town, { role: "staff", global: [] });
      const other = await seedActor(db, town, { role: "staff", global: [] });

      expect(() =>
        rules.assertCanUpdateUserAccount(me.actor, { userAccountId: me.userAccountId }),
      ).not.toThrow();
      expect(() =>
        rules.assertCanUpdateUserAccount(admin.actor, { userAccountId: me.userAccountId }),
      ).not.toThrow();
      await expectRefusal(() =>
        rules.assertCanUpdateUserAccount(me.actor, { userAccountId: other.userAccountId }),
      );

      // The policy this replaces compared `person_id` to `auth.uid()`, which
      // only ever matched because onboarding reused one uuid for the person,
      // the account and the identity. Passing a person id here must NOT open
      // the gate.
      await expectRefusal(() =>
        rules.assertCanUpdateUserAccount(me.actor, { userAccountId: me.personId }),
      );
    });
  });
});
