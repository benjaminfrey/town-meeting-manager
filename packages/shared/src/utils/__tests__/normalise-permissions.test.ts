/**
 * Stage 1, Task D1 review round 2 — the two spellings.
 *
 * The same thirty actions are written into `user_account.permissions` in two
 * different key spellings by two different parts of this product:
 *
 *   - `supabase/seed.sql:116` writes CODES  (`{"A2": true}`)
 *   - `StaffAccountFlow.tsx` → `buildPermissionsFromTemplate()` returns
 *     `Record<PermissionAction, boolean>` — NAMES — and
 *     `AddPersonDialog.tsx:117` / `AddMemberDialog.tsx:423` persist it as-is
 *
 * So **every staff account created through the product is name-keyed**, and a
 * reader that speaks only codes denies all of them. That failure has now been
 * shipped in both directions, which is why the mapping lives here, once, with
 * a test, rather than in whichever consumer noticed the problem last.
 */

import { describe, it, expect } from "vitest";
import { normalisePermissionsMatrix, hasPermission } from "../permissions.js";
import { PERMISSIONS, buildPermissionsFromTemplate, TEMPLATE_TOWN_CLERK } from "../../index.js";

describe("normalisePermissionsMatrix", () => {
  it("accepts a CODE-keyed matrix, which is what seed.sql writes", () => {
    const m = normalisePermissionsMatrix({ global: { A2: true, M3: true, R1: false } });
    expect(m.global.edit_agenda).toBe(true);
    expect(m.global.capture_motions_votes).toBe(true);
    expect(m.global.edit_draft_minutes).toBe(false);
  });

  it("accepts a NAME-keyed matrix, which is what the product itself writes", () => {
    const m = normalisePermissionsMatrix({
      global: { edit_agenda: true, edit_draft_minutes: false },
    });
    expect(m.global.edit_agenda).toBe(true);
    expect(m.global.edit_draft_minutes).toBe(false);
  });

  it("accepts the EXACT object the staff-account flow builds, end to end", () => {
    // Not a hand-written fixture: this is `buildPermissionsFromTemplate` —
    // the function `StaffAccountFlow.tsx:86` calls — persisted verbatim.
    // Before this change every account made this way resolved to nothing.
    const global = buildPermissionsFromTemplate(TEMPLATE_TOWN_CLERK);
    const matrix = normalisePermissionsMatrix({ global, board_overrides: [] });

    expect(hasPermission(matrix, "edit_agenda", undefined, "staff")).toBe(true);
    expect(hasPermission(matrix, "create_meeting", undefined, "staff")).toBe(true);
    expect(hasPermission(matrix, "capture_motions_votes", undefined, "staff")).toBe(true);
    // A Town Clerk holds no T-code, so the non-delegable ones stay closed.
    expect(hasPermission(matrix, "manage_user_accounts", undefined, "staff")).toBe(false);
  });

  it("normalises board overrides in either spelling, including a revocation", () => {
    const m = normalisePermissionsMatrix({
      global: { A1: true },
      board_overrides: [
        { board_id: "b1", permissions: { A1: false } },
        { board_id: "b2", permissions: { create_meeting: true } },
      ],
    });
    expect(hasPermission(m, "create_meeting", "b1", "staff")).toBe(false);
    expect(hasPermission(m, "create_meeting", "b2", "staff")).toBe(true);
    expect(hasPermission(m, "create_meeting", "b3", "staff")).toBe(true);
  });

  it("resolves a disagreement between the two spellings by DENYING, whatever the key order", () => {
    // "Last one wins" would make an authorization answer depend on JSON key
    // order. Every spelling present must agree to grant.
    const a = normalisePermissionsMatrix({ global: { A2: false, edit_agenda: true } });
    const b = normalisePermissionsMatrix({ global: { edit_agenda: true, A2: false } });
    expect(a.global.edit_agenda).toBe(false);
    expect(b.global.edit_agenda).toBe(false);

    // Agreement is preserved in both directions.
    expect(
      normalisePermissionsMatrix({ global: { A2: true, edit_agenda: true } }).global.edit_agenda,
    ).toBe(true);
  });

  it("drops a key that is neither spelling, rather than passing it through", () => {
    const m = normalisePermissionsMatrix({ global: { NOPE: true, approve_minutes: true } });
    // `approve_minutes` is not one of the thirty actions — `minutes.ts` once
    // guarded on it, and it could only ever be satisfied by the admin
    // short-circuit.
    expect(Object.keys(m.global)).toEqual([]);
  });

  it("survives null, undefined, arrays and junk without throwing", () => {
    for (const junk of [null, undefined, [], "x", 3, { global: null }, { global: [] }]) {
      const m = normalisePermissionsMatrix(junk as never);
      expect(m.global).toEqual({});
      expect(m.board_overrides).toEqual([]);
    }
  });

  it("covers all thirty actions in both spellings", () => {
    const codes = Object.keys(PERMISSIONS);
    const names = Object.values(PERMISSIONS);
    const fromCodes = normalisePermissionsMatrix({
      global: Object.fromEntries(codes.map((c) => [c, true])),
    });
    const fromNames = normalisePermissionsMatrix({
      global: Object.fromEntries(names.map((n) => [n, true])),
    });
    expect(Object.keys(fromCodes.global).sort()).toEqual([...names].sort());
    expect(fromCodes).toEqual(fromNames);
  });
});
