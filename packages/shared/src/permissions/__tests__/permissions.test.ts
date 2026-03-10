import { describe, expect, it } from "vitest";
import { hasPermission, checkRoleMutualExclusivity } from "../../utils/permissions.js";
import {
  PERMISSIONS,
  ADMIN_ONLY_ACTIONS,
  BOARD_MEMBER_ALWAYS_ACTIONS,
  VIEW_ACTIONS,
  buildPermissionsFromTemplate,
  TEMPLATE_TOWN_CLERK,
  TEMPLATE_GENERAL_STAFF,
  TEMPLATE_RECORDING_SECRETARY,
  TEMPLATE_DEPUTY_CLERK,
  TEMPLATE_BOARD_SPECIFIC_STAFF,
  ALL_PERMISSION_ACTIONS,
} from "../../constants/permissions.js";
import { areRolesMutuallyExclusive } from "../../constants/roles.js";

// ─── hasPermission ──────────────────────────────────────────────────

describe("hasPermission", () => {
  it("admin always has full access", () => {
    expect(hasPermission(null, PERMISSIONS.A1, undefined, "admin")).toBe(true);
    expect(hasPermission(null, PERMISSIONS.T1, undefined, "admin")).toBe(true);
    expect(hasPermission(null, PERMISSIONS.M8, undefined, "admin")).toBe(true);
  });

  it("denies admin-only actions (T1-T4) to staff", () => {
    const perms = { global: {} as Record<string, boolean> };
    for (const action of ADMIN_ONLY_ACTIONS) {
      expect(hasPermission(perms, action, undefined, "staff")).toBe(false);
    }
  });

  it("denies admin-only actions to board members", () => {
    for (const action of ADMIN_ONLY_ACTIONS) {
      expect(hasPermission(null, action, undefined, "board_member")).toBe(false);
    }
  });

  it("board member gets always-allowed actions (A4, A7, M8)", () => {
    for (const action of BOARD_MEMBER_ALWAYS_ACTIONS) {
      expect(hasPermission(null, action, undefined, "board_member")).toBe(true);
    }
  });

  it("board member denied non-always-allowed actions", () => {
    expect(hasPermission(null, PERMISSIONS.A1, undefined, "board_member")).toBe(false);
    expect(hasPermission(null, PERMISSIONS.M1, undefined, "board_member")).toBe(false);
    expect(hasPermission(null, PERMISSIONS.R1, undefined, "board_member")).toBe(false);
  });

  it("staff: global true grants access", () => {
    const perms = { global: { [PERMISSIONS.A1]: true } as Record<string, boolean> };
    expect(hasPermission(perms, PERMISSIONS.A1, "any-board", "staff")).toBe(true);
  });

  it("staff: global false denies access", () => {
    const perms = { global: { [PERMISSIONS.A1]: false } as Record<string, boolean> };
    expect(hasPermission(perms, PERMISSIONS.A1, "any-board", "staff")).toBe(false);
  });

  it("staff: board override takes precedence", () => {
    const perms = {
      global: { [PERMISSIONS.M1]: false } as Record<string, boolean>,
      board_overrides: [
        {
          board_id: "board-1",
          permissions: { [PERMISSIONS.M1]: true } as Record<string, boolean>,
        },
      ],
    };
    expect(hasPermission(perms, PERMISSIONS.M1, "board-1", "staff")).toBe(true);
  });

  it("staff: board override does not affect other boards", () => {
    const perms = {
      global: { [PERMISSIONS.M1]: false } as Record<string, boolean>,
      board_overrides: [
        {
          board_id: "board-1",
          permissions: { [PERMISSIONS.M1]: true } as Record<string, boolean>,
        },
      ],
    };
    expect(hasPermission(perms, PERMISSIONS.M1, "board-2", "staff")).toBe(false);
  });

  it("missing action defaults to false", () => {
    const perms = { global: {} as Record<string, boolean> };
    expect(hasPermission(perms, PERMISSIONS.C1, undefined, "staff")).toBe(false);
  });

  it("null permissions returns false", () => {
    expect(hasPermission(null, PERMISSIONS.A1, undefined, "staff")).toBe(false);
  });

  it("undefined permissions returns false", () => {
    expect(hasPermission(undefined, PERMISSIONS.A1, undefined, "staff")).toBe(false);
  });
});

// ─── checkRoleMutualExclusivity ─────────────────────────────────────

describe("checkRoleMutualExclusivity", () => {
  it("detects staff → board_member conflict", () => {
    const result = checkRoleMutualExclusivity("staff", "board_member");
    expect(result.conflict).toBe(true);
    expect(result.existingRole).toBe("staff");
    expect(result.targetRole).toBe("board_member");
    expect(result.message).toContain("Maine");
    expect(result.message).toContain("30-A M.R.S.A.");
  });

  it("detects board_member → staff conflict", () => {
    const result = checkRoleMutualExclusivity("board_member", "staff");
    expect(result.conflict).toBe(true);
    expect(result.message).toContain("archived first");
  });

  it("allows admin → board_member", () => {
    const result = checkRoleMutualExclusivity("admin", "board_member");
    expect(result.conflict).toBe(false);
  });

  it("allows admin → staff", () => {
    const result = checkRoleMutualExclusivity("admin", "staff");
    expect(result.conflict).toBe(false);
  });

  it("returns no conflict when existing role is null", () => {
    const result = checkRoleMutualExclusivity(null, "staff");
    expect(result.conflict).toBe(false);
  });

  it("returns no conflict when existing role is undefined", () => {
    const result = checkRoleMutualExclusivity(undefined, "board_member");
    expect(result.conflict).toBe(false);
  });

  it("staff → staff is not mutually exclusive", () => {
    // areRolesMutuallyExclusive only flags staff/board_member combo
    const result = checkRoleMutualExclusivity("staff", "staff");
    expect(result.conflict).toBe(false);
  });
});

// ─── areRolesMutuallyExclusive ──────────────────────────────────────

describe("areRolesMutuallyExclusive", () => {
  it("staff and board_member are mutually exclusive", () => {
    expect(areRolesMutuallyExclusive("staff", "board_member")).toBe(true);
    expect(areRolesMutuallyExclusive("board_member", "staff")).toBe(true);
  });

  it("admin and staff are not mutually exclusive", () => {
    expect(areRolesMutuallyExclusive("admin", "staff")).toBe(false);
  });

  it("admin and board_member are not mutually exclusive", () => {
    expect(areRolesMutuallyExclusive("admin", "board_member")).toBe(false);
  });
});

// ─── buildPermissionsFromTemplate ───────────────────────────────────

describe("buildPermissionsFromTemplate", () => {
  it("Town Clerk template includes all operational permissions", () => {
    const perms = buildPermissionsFromTemplate(TEMPLATE_TOWN_CLERK);
    // A1-A6 (not A4, A7 which are board-member only)
    expect(perms[PERMISSIONS.A1]).toBe(true);
    expect(perms[PERMISSIONS.A2]).toBe(true);
    expect(perms[PERMISSIONS.A3]).toBe(true);
    expect(perms[PERMISSIONS.A5]).toBe(true);
    expect(perms[PERMISSIONS.A6]).toBe(true);
    // M1-M7
    expect(perms[PERMISSIONS.M1]).toBe(true);
    expect(perms[PERMISSIONS.M7]).toBe(true);
    // R1-R6
    expect(perms[PERMISSIONS.R1]).toBe(true);
    expect(perms[PERMISSIONS.R6]).toBe(true);
    // C1-C5
    expect(perms[PERMISSIONS.C1]).toBe(true);
    expect(perms[PERMISSIONS.C5]).toBe(true);
  });

  it("Town Clerk excludes admin-only T1-T4", () => {
    const perms = buildPermissionsFromTemplate(TEMPLATE_TOWN_CLERK);
    expect(perms[PERMISSIONS.T1]).toBe(false);
    expect(perms[PERMISSIONS.T2]).toBe(false);
    expect(perms[PERMISSIONS.T3]).toBe(false);
    expect(perms[PERMISSIONS.T4]).toBe(false);
  });

  it("General Staff has minimal permissions", () => {
    const perms = buildPermissionsFromTemplate(TEMPLATE_GENERAL_STAFF);
    expect(perms[PERMISSIONS.A3]).toBe(true);
    expect(perms[PERMISSIONS.R4]).toBe(true);
    expect(perms[PERMISSIONS.R6]).toBe(true);
    // Everything else should be false
    expect(perms[PERMISSIONS.A1]).toBe(false);
    expect(perms[PERMISSIONS.M1]).toBe(false);
    expect(perms[PERMISSIONS.C1]).toBe(false);
  });

  it("Recording Secretary has meeting + minutes permissions", () => {
    const perms = buildPermissionsFromTemplate(TEMPLATE_RECORDING_SECRETARY);
    expect(perms[PERMISSIONS.M2]).toBe(true);
    expect(perms[PERMISSIONS.M3]).toBe(true);
    expect(perms[PERMISSIONS.M4]).toBe(true);
    expect(perms[PERMISSIONS.M5]).toBe(true);
    expect(perms[PERMISSIONS.R1]).toBe(true);
    expect(perms[PERMISSIONS.R2]).toBe(true);
    expect(perms[PERMISSIONS.R3]).toBe(true);
    expect(perms[PERMISSIONS.R4]).toBe(true);
    expect(perms[PERMISSIONS.R6]).toBe(true);
    // Should NOT have meeting management
    expect(perms[PERMISSIONS.M1]).toBe(false);
    expect(perms[PERMISSIONS.A1]).toBe(false);
  });

  it("Deputy Clerk excludes R5 (publish)", () => {
    const perms = buildPermissionsFromTemplate(TEMPLATE_DEPUTY_CLERK);
    expect(perms[PERMISSIONS.R5]).toBe(false);
    expect(perms[PERMISSIONS.R1]).toBe(true);
    expect(perms[PERMISSIONS.M1]).toBe(true);
  });

  it("all templates cover all 30 actions", () => {
    for (const template of [TEMPLATE_TOWN_CLERK, TEMPLATE_GENERAL_STAFF, TEMPLATE_RECORDING_SECRETARY]) {
      const perms = buildPermissionsFromTemplate(template);
      expect(Object.keys(perms).length).toBe(ALL_PERMISSION_ACTIONS.length);
    }
  });
});
