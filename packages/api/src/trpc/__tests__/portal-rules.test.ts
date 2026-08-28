/**
 * Stage 1, Task D1 — what the public portal may read.
 *
 * The portal has no session and no account, so every rule in
 * `authorization/rules.ts` refuses it. What it MAY read is a separate,
 * positive list, and this file is the test on that list.
 *
 * Why it needs to exist as a rule rather than as a filter in each handler:
 * Phase B's tenancy policies do not distinguish a draft from a published
 * record, and Phase C's G1 review confirmed the portal's fifteen routes each
 * gate on `status = 'published'` inside their own query. Fifteen copies of one
 * rule is fifteen chances to omit it, and the sixteenth route — written by
 * someone reading the fifteenth — inherits whichever version they happened to
 * read. Once the portal moves onto a tenant context, that gating is the ONLY
 * thing between the public and a town's draft minutes, so it stops being a
 * query detail and becomes an authorization rule with a test.
 */

import { describe, it, expect } from "vitest";
import * as rules from "../authorization/rules.js";
import { anonymousActor } from "../authorization/actor.js";

const TOWN = "00000000-0000-4000-8000-000000000000";

describe("the public portal's read rules", () => {
  it("serves PUBLISHED minutes and nothing earlier — not even approved ones", () => {
    expect(rules.portalCanSelectMinutesDocument({ status: "published" })).toBe(true);

    // `approved` means the board adopted them. `published` means the town
    // decided to put them on the website. Those are two decisions, and the
    // portal must honour the second rather than infer it from the first —
    // which is why this is deliberately NARROWER than rule 9's second branch.
    expect(rules.portalCanSelectMinutesDocument({ status: "approved" })).toBe(false);
    expect(rules.portalCanSelectMinutesDocument({ status: "review" })).toBe(false);
    expect(rules.portalCanSelectMinutesDocument({ status: "draft" })).toBe(false);

    expect(() => rules.assertPortalCanSelectMinutesDocument({ status: "draft" })).toThrow(
      /not been published/,
    );

    const rows = [
      { id: "d", status: "draft" as const },
      { id: "a", status: "approved" as const },
      { id: "p", status: "published" as const },
    ];
    expect(rules.portalVisibleMinutesDocuments(rows).map((r) => r.id)).toEqual(["p"]);
  });

  it("serves only `public` exhibits", () => {
    expect(rules.portalCanSelectExhibit({ visibility: "public" })).toBe(true);
    expect(rules.portalCanSelectExhibit({ visibility: "board_only" })).toBe(false);
    expect(rules.portalCanSelectExhibit({ visibility: "admin_only" })).toBe(false);
  });

  it("hides draft and cancelled meetings, and serves the rest", () => {
    expect(rules.portalCanSelectMeeting({ status: "draft" })).toBe(false);
    expect(rules.portalCanSelectMeeting({ status: "cancelled" })).toBe(false);
    for (const status of ["scheduled", "noticed", "in_progress", "completed"]) {
      expect(rules.portalCanSelectMeeting({ status })).toBe(true);
    }
  });

  it("serves only published agendas", () => {
    expect(rules.portalCanSelectAgenda({ agendaStatus: "published" })).toBe(true);
    expect(rules.portalCanSelectAgenda({ agendaStatus: "draft" })).toBe(false);
    expect(rules.portalCanSelectAgenda({ agendaStatus: null })).toBe(false);
  });

  it("refuses the anonymous actor every one of the signed-in rules", () => {
    const anon = anonymousActor(TOWN);

    // Reads that a signed-in member of the town gets for free.
    expect(rules.canSelectExhibit(anon, { visibility: "public" })).toBe(false);

    // Rule 9 as the policy wrote it was `has_permission('R4') OR status IN
    // ('approved','published')` — no actor term in the second branch, because
    // a policy only ever ran inside an authenticated town context. Restored
    // literally, an anonymous caller would pass it and receive a town's
    // APPROVED-but-unpublished minutes. The guard therefore carries an actor
    // term the policy did not need, and the portal has its own narrower rule.
    expect(rules.canSelectMinutesDocument(anon, { status: "published" })).toBe(false);
    expect(rules.canSelectMinutesDocument(anon, { status: "approved" })).toBe(false);
    expect(rules.visibleMinutesDocuments(anon, [{ status: "published" as const }])).toEqual([]);
    expect(rules.portalCanSelectMinutesDocument({ status: "approved" })).toBe(false);
    expect(rules.portalCanSelectMinutesDocument({ status: "published" })).toBe(true);

    // Writes, uniformly refused.
    for (const assert of [
      rules.assertCanInsertAgendaItem,
      rules.assertCanUpdateAgendaItem,
      rules.assertCanInsertMotion,
      rules.assertCanInsertMinutesDocument,
      rules.assertCanUpdateMinutesDocument,
      rules.assertCanInsertExhibit,
      rules.assertCanUpdateExhibit,
      rules.assertCanSelectNotificationEvent,
      rules.assertCanSelectAuditLog,
      rules.assertCanSelectTownNotificationConfig,
      rules.assertCanUpdateTown,
    ]) {
      expect(() => assert(anon)).toThrow();
    }
    expect(() => rules.assertCanInsertMeeting(anon, { boardId: TOWN })).toThrow();
    expect(() => rules.assertCanUpdateMeeting(anon, { boardId: TOWN })).toThrow();
  });
});
