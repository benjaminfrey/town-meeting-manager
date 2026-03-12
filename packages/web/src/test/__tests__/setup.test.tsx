import { describe, expect, it } from "vitest";
import React from "react";
import { renderWithProviders, screen } from "@/test/render";
import {
  createAdminUser,
  createStaffUser,
  createBoardMemberUser,
} from "@/test/mocks/auth-mock";

// ─── Tests ──────────────────────────────────────────────────────────

describe("test setup verification", () => {
  it("renders a basic component with providers", () => {
    renderWithProviders(<div data-testid="hello">Hello Test</div>);
    expect(screen.getByTestId("hello")).toBeInTheDocument();
    expect(screen.getByText("Hello Test")).toBeInTheDocument();
  });

  it("RTL matchers work (toBeInTheDocument, toHaveTextContent)", () => {
    renderWithProviders(
      <p data-testid="greeting">Welcome to Town Meeting Manager</p>,
    );
    const el = screen.getByTestId("greeting");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("Welcome to Town Meeting Manager");
  });

  it("userEvent works for interaction", async () => {
    function Counter() {
      const [count, setCount] = React.useState(0);
      return (
        <button data-testid="btn" onClick={() => setCount((c) => c + 1)}>
          Count: {count}
        </button>
      );
    }

    const { user } = renderWithProviders(<Counter />);
    expect(screen.getByTestId("btn")).toHaveTextContent("Count: 0");

    await user.click(screen.getByTestId("btn"));
    expect(screen.getByTestId("btn")).toHaveTextContent("Count: 1");
  });
});

describe("user factories", () => {
  it("createAdminUser has admin role and default fields", () => {
    const user = createAdminUser();
    expect(user.role).toBe("admin");
    expect(user.townId).toBe("town-1");
    expect(user.personId).toBe("person-1");
    expect(user.email).toBe("admin@test.com");
    expect(user.govTitle).toBeNull();
  });

  it("createAdminUser accepts overrides", () => {
    const user = createAdminUser({ email: "custom@test.com", townId: "town-42" });
    expect(user.role).toBe("admin");
    expect(user.email).toBe("custom@test.com");
    expect(user.townId).toBe("town-42");
  });

  it("createStaffUser with Town Clerk template has expected permissions", () => {
    const user = createStaffUser("Town Clerk");
    expect(user.role).toBe("staff");
    expect(user.permissions).toBeDefined();
    // Town Clerk template includes meeting and agenda permissions
    expect(user.permissions.create_meeting).toBe(true);
    expect(user.permissions.edit_agenda).toBe(true);
    // Town Clerk does NOT get admin-only permissions
    expect(user.permissions.manage_town_settings).toBe(false);
  });

  it("createStaffUser without template has empty permissions", () => {
    const user = createStaffUser();
    expect(user.role).toBe("staff");
    expect(user.permissions).toEqual({});
  });

  it("createBoardMemberUser has board_member role", () => {
    const user = createBoardMemberUser();
    expect(user.role).toBe("board_member");
  });
});
