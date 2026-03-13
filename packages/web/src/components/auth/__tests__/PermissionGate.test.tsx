/**
 * RBAC Tests — checkPermission, usePermission, PermissionGate
 *
 * Tests the three layers of the permission system:
 *  1. checkPermission() — pure function, no hooks
 *  2. usePermission() — hook wrapping checkPermission + auth loading state
 *  3. PermissionGate — React component that conditionally renders children
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import {
  createAdminUser,
  createStaffUser,
  createBoardMemberUser,
  createMockUser,
} from "@/test/mocks/auth-mock";
import { checkPermission } from "@/hooks/usePermission";
import { PermissionGate } from "../PermissionGate";
import type { CurrentUser } from "@/hooks/useCurrentUser";
import { buildPermissionsFromTemplate, DEFAULT_PERMISSION_TEMPLATES } from "@town-meeting/shared";
import type { PermissionsMatrix } from "@town-meeting/shared";

// ─── Mock AuthProvider and useCurrentUser ────────────────────────────

// usePermission reads from useAuth (for isLoading) and useCurrentUser (for user data).
// We mock both to control test behavior.
const { mockIsLoading, mockCurrentUser } = vi.hoisted(() => ({
  mockIsLoading: { value: false },
  mockCurrentUser: { value: null as CurrentUser | null },
}));

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ isLoading: mockIsLoading.value }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockCurrentUser.value,
}));

beforeEach(() => {
  mockIsLoading.value = false;
  mockCurrentUser.value = null;
});

// ─── Helper: build staff user with a named template ──────────────────

function staffWithTemplate(templateName: string): CurrentUser {
  const template = DEFAULT_PERMISSION_TEMPLATES.find((t) => t.name === templateName);
  if (!template) throw new Error(`Template not found: ${templateName}`);
  const permissions: PermissionsMatrix = {
    global: buildPermissionsFromTemplate(template),
    board_overrides: [],
  };
  return createMockUser({ role: "staff", permissions });
}

function staffWithGlobal(allowedActions: string[]): CurrentUser {
  const global = Object.fromEntries(allowedActions.map((a) => [a, true])) as Record<string, boolean>;
  return createMockUser({
    role: "staff",
    permissions: {
      global: global as PermissionsMatrix["global"],
      board_overrides: [],
    },
  });
}

function staffWithBoardOverride(
  boardId: string,
  boardActions: string[],
  globalActions: string[] = [],
): CurrentUser {
  const global = Object.fromEntries(globalActions.map((a) => [a, true])) as Record<string, boolean>;
  const boardGlobal = Object.fromEntries(boardActions.map((a) => [a, true])) as Record<string, boolean>;
  return createMockUser({
    role: "staff",
    permissions: {
      global: global as PermissionsMatrix["global"],
      board_overrides: [
        {
          board_id: boardId,
          permissions: boardGlobal as PermissionsMatrix["global"],
        },
      ],
    },
  });
}

// ─── checkPermission — pure function tests ────────────────────────────

describe("checkPermission", () => {
  describe("null / unauthenticated user", () => {
    it("returns false for null user", () => {
      expect(checkPermission(null, "A1")).toBe(false);
      expect(checkPermission(null, "V1")).toBe(false);
      expect(checkPermission(null, "M8")).toBe(false);
    });
  });

  describe("admin / sys_admin role", () => {
    it("admin bypasses all permission checks → true for every action code", () => {
      const admin = createAdminUser();
      // Spot-check representative codes from each group
      expect(checkPermission(admin, "A1")).toBe(true);
      expect(checkPermission(admin, "A7")).toBe(true);
      expect(checkPermission(admin, "M1")).toBe(true);
      expect(checkPermission(admin, "R1")).toBe(true);
      expect(checkPermission(admin, "T1")).toBe(true);
      expect(checkPermission(admin, "T4")).toBe(true);
      expect(checkPermission(admin, "V1")).toBe(true);
      expect(checkPermission(admin, "C5")).toBe(true);
    });

    it("sys_admin also bypasses all checks", () => {
      const sysAdmin = createMockUser({ role: "sys_admin" });
      expect(checkPermission(sysAdmin, "T1")).toBe(true);
      expect(checkPermission(sysAdmin, "R1")).toBe(true);
    });
  });

  describe("V1–V5 view actions", () => {
    it("V1–V5 are always allowed for all authenticated roles", () => {
      const staff = createStaffUser();
      const bm = createBoardMemberUser();

      for (const code of ["V1", "V2", "V3", "V4", "V5"]) {
        expect(checkPermission(staff, code)).toBe(true);
        expect(checkPermission(bm, code)).toBe(true);
      }
    });
  });

  describe("T1–T4 admin-only actions", () => {
    it("T1–T4 are denied for staff regardless of permissions", () => {
      const staff = staffWithTemplate("Town Clerk"); // Town Clerk has broad permissions
      for (const code of ["T1", "T2", "T3", "T4"]) {
        expect(checkPermission(staff, code)).toBe(false);
      }
    });

    it("T1–T4 are denied for board_member", () => {
      const bm = createBoardMemberUser();
      for (const code of ["T1", "T2", "T3", "T4"]) {
        expect(checkPermission(bm, code)).toBe(false);
      }
    });
  });

  describe("board_member role", () => {
    it("always allows fixed board_member actions: A4, A7, M8", () => {
      const bm = createBoardMemberUser();
      expect(checkPermission(bm, "A4")).toBe(true);
      expect(checkPermission(bm, "A7")).toBe(true);
      expect(checkPermission(bm, "M8")).toBe(true);
    });

    it("always allows R6 (export minutes)", () => {
      const bm = createBoardMemberUser();
      expect(checkPermission(bm, "R6")).toBe(true);
    });

    it("allows R4 (view draft minutes) by default when no permissions JSONB", () => {
      const bm = createBoardMemberUser({ permissions: null });
      expect(checkPermission(bm, "R4")).toBe(true);
    });

    it("allows R4 when explicitly true in permissions JSONB", () => {
      const bm = createBoardMemberUser({
        permissions: {
          global: { view_draft_minutes: true } as PermissionsMatrix["global"],
          board_overrides: [],
        },
      });
      expect(checkPermission(bm, "R4")).toBe(true);
    });

    it("denies R4 when explicitly false in permissions JSONB", () => {
      const bm = createBoardMemberUser({
        permissions: {
          global: { view_draft_minutes: false } as PermissionsMatrix["global"],
          board_overrides: [],
        },
      });
      expect(checkPermission(bm, "R4")).toBe(false);
    });

    it("denies non-fixed staff actions (A1, R1, M1) by default", () => {
      const bm = createBoardMemberUser({ permissions: null });
      expect(checkPermission(bm, "A1")).toBe(false);
      expect(checkPermission(bm, "R1")).toBe(false);
      expect(checkPermission(bm, "M1")).toBe(false);
    });

    it("allows extra actions when explicitly granted in JSONB", () => {
      const bm = createBoardMemberUser({
        permissions: {
          global: { edit_agenda: true } as PermissionsMatrix["global"],
          board_overrides: [],
        },
      });
      expect(checkPermission(bm, "A2")).toBe(true);
    });
  });

  describe("staff role — global permissions", () => {
    it("denies all non-view actions when no permissions object", () => {
      const staff = createMockUser({ role: "staff", permissions: null });
      expect(checkPermission(staff, "A1")).toBe(false);
      expect(checkPermission(staff, "R1")).toBe(false);
      expect(checkPermission(staff, "M1")).toBe(false);
    });

    it("allows actions present and true in global permissions", () => {
      const staff = staffWithGlobal(["create_meeting", "edit_agenda", "edit_draft_minutes"]);
      expect(checkPermission(staff, "A1")).toBe(true);
      expect(checkPermission(staff, "A2")).toBe(true);
      expect(checkPermission(staff, "R1")).toBe(true);
    });

    it("denies actions absent from global permissions", () => {
      const staff = staffWithGlobal(["create_meeting"]);
      expect(checkPermission(staff, "R1")).toBe(false);
      expect(checkPermission(staff, "M1")).toBe(false);
    });

    it("Town Clerk template: has broad permissions including A1, R1, R3, R5", () => {
      const staff = staffWithTemplate("Town Clerk");
      expect(checkPermission(staff, "A1")).toBe(true);
      expect(checkPermission(staff, "R1")).toBe(true);
      expect(checkPermission(staff, "R3")).toBe(true);
    });

    it("Recording Secretary Only template: has limited permissions", () => {
      const staff = staffWithTemplate("Recording Secretary Only");
      // Should have M5 (serve_recording_secretary)
      expect(checkPermission(staff, "M5")).toBe(true);
      // But not A1 (create_meeting)
      expect(checkPermission(staff, "A1")).toBe(false);
    });
  });

  describe("staff role — board-specific overrides", () => {
    const BOARD_A = "board-aaa";
    const BOARD_B = "board-bbb";

    it("board override takes precedence over global when boardId provided", () => {
      // Global: no edit_agenda; Board A override: yes edit_agenda
      const staff = staffWithBoardOverride(BOARD_A, ["edit_agenda"], []);
      expect(checkPermission(staff, "A2", BOARD_A)).toBe(true);
    });

    it("falls back to global when no board override matches", () => {
      // Global: has edit_agenda; Board B has no override
      const staff = staffWithBoardOverride(BOARD_A, ["edit_agenda"], ["edit_agenda"]);
      expect(checkPermission(staff, "A2", BOARD_B)).toBe(true); // global fallback
    });

    it("board override can restrict permissions present in global", () => {
      // Global: has edit_agenda; Board A override: edit_agenda = false
      const staff = createMockUser({
        role: "staff",
        permissions: {
          global: { edit_agenda: true } as PermissionsMatrix["global"],
          board_overrides: [
            {
              board_id: BOARD_A,
              permissions: { edit_agenda: false } as PermissionsMatrix["global"],
            },
          ],
        },
      });
      // Board A restricts it
      expect(checkPermission(staff, "A2", BOARD_A)).toBe(false);
      // Global still allows it for other boards
      expect(checkPermission(staff, "A2", BOARD_B)).toBe(true);
      // No boardId also falls back to global
      expect(checkPermission(staff, "A2")).toBe(true);
    });

    it("returns false for unknown action codes", () => {
      const admin = createAdminUser();
      // Admin bypasses everything except unknown actions
      // Actually admin returns true for everything — let's test a non-admin
      const staff = staffWithTemplate("Town Clerk");
      expect(checkPermission(staff, "UNKNOWN_CODE")).toBe(false);
    });
  });
});

// ─── PermissionGate component tests ──────────────────────────────────

/**
 * Helper: render PermissionGate with a specific user wired into BOTH
 * MockAuthProvider (for useAuth) AND the mockCurrentUser value (for useCurrentUser).
 */
function renderGate(user: CurrentUser | null, jsx: React.ReactElement) {
  mockCurrentUser.value = user;
  return renderWithProviders(jsx, { user });
}

describe("PermissionGate", () => {
  describe("admin user (always allowed)", () => {
    it("renders children when admin has any permission", () => {
      renderGate(
        createAdminUser(),
        <PermissionGate action="R1">
          <span data-testid="protected">Protected Content</span>
        </PermissionGate>,
      );

      expect(screen.getByTestId("protected")).toBeInTheDocument();
    });

    it("renders children for T1 (admin-only action)", () => {
      renderGate(
        createAdminUser(),
        <PermissionGate action="T1">
          <span data-testid="admin-content">Admin Area</span>
        </PermissionGate>,
      );

      expect(screen.getByTestId("admin-content")).toBeInTheDocument();
    });
  });

  describe("board_member user", () => {
    it("renders children for always-allowed board_member action (M8)", () => {
      renderGate(
        createBoardMemberUser(),
        <PermissionGate action="M8">
          <span data-testid="vote-button">Vote</span>
        </PermissionGate>,
      );

      expect(screen.getByTestId("vote-button")).toBeInTheDocument();
    });

    it("renders fallback for restricted action (A1)", () => {
      renderGate(
        createBoardMemberUser(),
        <PermissionGate action="A1" fallback={<span data-testid="denied">No Access</span>}>
          <span data-testid="protected">Create Meeting</span>
        </PermissionGate>,
      );

      expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
      expect(screen.getByTestId("denied")).toBeInTheDocument();
    });

    it("renders nothing (no fallback) when permission denied and no fallback provided", () => {
      renderGate(
        createBoardMemberUser(),
        <PermissionGate action="R1">
          <span data-testid="protected">Edit Minutes</span>
        </PermissionGate>,
      );

      expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    });
  });

  describe("staff user", () => {
    it("renders children when staff has the required permission", () => {
      const staff = staffWithGlobal(["edit_draft_minutes"]);
      renderGate(
        staff,
        <PermissionGate action="R1">
          <span data-testid="edit-minutes">Edit Minutes</span>
        </PermissionGate>,
      );

      expect(screen.getByTestId("edit-minutes")).toBeInTheDocument();
    });

    it("renders fallback when staff lacks the required permission", () => {
      const staff = staffWithGlobal(["create_meeting"]); // has A1, not R1
      renderGate(
        staff,
        <PermissionGate action="R1" fallback={<span data-testid="no-access">No Access</span>}>
          <span data-testid="protected">Edit Minutes</span>
        </PermissionGate>,
      );

      expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
      expect(screen.getByTestId("no-access")).toBeInTheDocument();
    });
  });

  describe("unauthenticated / null user", () => {
    it("renders fallback when user is null", () => {
      renderGate(
        null,
        <PermissionGate action="V1" fallback={<span data-testid="login">Please log in</span>}>
          <span data-testid="content">Content</span>
        </PermissionGate>,
      );

      expect(screen.queryByTestId("content")).not.toBeInTheDocument();
      expect(screen.getByTestId("login")).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("hides content while auth is loading (hideWhileLoading=true default)", () => {
      // Set isLoading=true, user=admin → PermissionGate should return null
      mockIsLoading.value = true;
      mockCurrentUser.value = createAdminUser();

      renderWithProviders(
        <PermissionGate action="R1">
          <span data-testid="content">Content</span>
        </PermissionGate>,
        { user: createAdminUser() },
      );

      // hideWhileLoading=true (default) + loading=true → renders null
      expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    });

    it("shows content when hideWhileLoading=false even during loading (if allowed)", () => {
      mockIsLoading.value = true;
      mockCurrentUser.value = createAdminUser();

      renderWithProviders(
        <PermissionGate action="R1" hideWhileLoading={false}>
          <span data-testid="content">Content</span>
        </PermissionGate>,
        { user: createAdminUser() },
      );

      // hideWhileLoading=false → renders children (admin is allowed)
      expect(screen.getByTestId("content")).toBeInTheDocument();
    });
  });

  describe("view actions (always allowed)", () => {
    it("renders children for V1 for all authenticated roles", () => {
      const users = [createAdminUser(), createBoardMemberUser(), createStaffUser()];
      for (const user of users) {
        const { unmount } = renderGate(
          user,
          <PermissionGate action="V1">
            <span data-testid="content">View Content</span>
          </PermissionGate>,
        );
        expect(screen.getByTestId("content")).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe("boardId prop", () => {
    it("passes boardId to permission check for board-scoped actions", () => {
      const staff = staffWithBoardOverride("board-123", ["edit_agenda"], []);
      renderGate(
        staff,
        <PermissionGate action="A2" boardId="board-123">
          <span data-testid="board-content">Board Content</span>
        </PermissionGate>,
      );

      expect(screen.getByTestId("board-content")).toBeInTheDocument();
    });

    it("denies when board override is for a different board", () => {
      const staff = staffWithBoardOverride("board-456", ["edit_agenda"], []);
      renderGate(
        staff,
        <PermissionGate action="A2" boardId="board-123" fallback={<span data-testid="denied">Denied</span>}>
          <span data-testid="board-content">Board Content</span>
        </PermissionGate>,
      );

      expect(screen.queryByTestId("board-content")).not.toBeInTheDocument();
      expect(screen.getByTestId("denied")).toBeInTheDocument();
    });
  });

  describe("multiple PermissionGates", () => {
    it("correctly evaluates independent gates with different actions", () => {
      renderGate(
        createAdminUser(),
        <div>
          <PermissionGate action="R1">
            <span data-testid="r1-content">R1 Content</span>
          </PermissionGate>
          <PermissionGate action="T1">
            <span data-testid="t1-content">T1 Content</span>
          </PermissionGate>
        </div>,
      );

      expect(screen.getByTestId("r1-content")).toBeInTheDocument();
      expect(screen.getByTestId("t1-content")).toBeInTheDocument();
    });

    it("shows different states for mixed permissions (staff: R1 yes, T1 no)", () => {
      const staff = staffWithGlobal(["edit_draft_minutes"]);
      renderGate(
        staff,
        <div>
          <PermissionGate action="R1">
            <span data-testid="r1-allowed">Has R1</span>
          </PermissionGate>
          <PermissionGate action="T1" fallback={<span data-testid="t1-denied">No T1</span>}>
            <span data-testid="t1-allowed">Has T1</span>
          </PermissionGate>
        </div>,
      );

      expect(screen.getByTestId("r1-allowed")).toBeInTheDocument();
      expect(screen.queryByTestId("t1-allowed")).not.toBeInTheDocument();
      expect(screen.getByTestId("t1-denied")).toBeInTheDocument();
    });
  });
});
