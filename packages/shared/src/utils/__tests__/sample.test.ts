import { describe, expect, it } from "vitest";
import { calculateQuorum } from "../quorum.js";
import { hasPermission, checkRoleMutualExclusivity } from "../permissions.js";

describe("shared package test setup", () => {
  it("runs basic assertions", () => {
    expect(1 + 1).toBe(2);
  });
});

describe("calculateQuorum", () => {
  it("calculates simple majority", () => {
    expect(calculateQuorum(5, "simple_majority", null)).toBe(3);
    expect(calculateQuorum(7, "simple_majority", null)).toBe(4);
  });

  it("calculates two-thirds", () => {
    expect(calculateQuorum(6, "two_thirds", null)).toBe(4);
  });

  it("uses fixed number", () => {
    expect(calculateQuorum(10, "fixed_number", 4)).toBe(4);
  });
});

describe("hasPermission", () => {
  it("grants admin full access", () => {
    expect(hasPermission(null, "create_meeting", undefined, "admin")).toBe(true);
  });

  it("denies admin-only actions to non-admins", () => {
    expect(hasPermission(null, "manage_town_settings", undefined, "staff")).toBe(false);
  });

  it("resolves staff permissions from global", () => {
    const perms = { global: { create_meeting: true } as Record<string, boolean> };
    expect(hasPermission(perms, "create_meeting", undefined, "staff")).toBe(true);
  });

  it("resolves board-specific overrides", () => {
    const perms = {
      global: { create_meeting: false } as Record<string, boolean>,
      board_overrides: [
        { board_id: "board-1", permissions: { create_meeting: true } as Record<string, boolean> },
      ],
    };
    expect(hasPermission(perms, "create_meeting", "board-1", "staff")).toBe(true);
    expect(hasPermission(perms, "create_meeting", "board-2", "staff")).toBe(false);
  });
});

describe("checkRoleMutualExclusivity", () => {
  it("detects staff/board_member conflict", () => {
    const result = checkRoleMutualExclusivity("staff", "board_member");
    expect(result.conflict).toBe(true);
    expect(result.message).toContain("Maine");
  });

  it("allows admin to any role", () => {
    const result = checkRoleMutualExclusivity("admin", "board_member");
    expect(result.conflict).toBe(false);
  });

  it("returns no conflict when no existing role", () => {
    const result = checkRoleMutualExclusivity(null, "staff");
    expect(result.conflict).toBe(false);
  });
});
