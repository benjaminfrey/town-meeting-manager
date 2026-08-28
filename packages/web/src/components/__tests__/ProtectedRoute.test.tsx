/**
 * Stage 1, Task C2, review round 1 — `null` has two meanings, and only one of
 * them is the onboarding wizard.
 *
 * Before C2, `currentUser` came from JWT claims the page already held, so
 * "no town" was the only way it could be absent. It now comes from
 * `GET /api/me`, so a 5xx or a dropped connection produces the same `null` —
 * and this component navigated on it. A fully onboarded administrator would be
 * sent into the wizard by a transient network blip, and refused with 409 at
 * the end of it.
 *
 * The second test is the one that matters. A redirect discards whatever the
 * user was doing, and the failure it reacts to is usually over by the time
 * they read the screen.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock("@/providers/AuthProvider", () => ({ useAuth: mockUseAuth }));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  };
});

import { ProtectedRoute } from "../ProtectedRoute";

const BASE = {
  isAuthenticated: true,
  isLoading: false,
  currentUser: null as unknown,
  currentUserError: null as Error | null,
  refreshCurrentUser: vi.fn(),
};

function renderGuard(overrides: Partial<typeof BASE> = {}) {
  mockUseAuth.mockReturnValue({ ...BASE, ...overrides });
  return render(
    <MemoryRouter>
      <ProtectedRoute>
        <div data-testid="content">the app</div>
      </ProtectedRoute>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a signed-in user with genuinely no town to the wizard", () => {
    renderGuard({ currentUser: null, currentUserError: null });
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/setup");
  });

  it("does NOT send a user to the wizard when /api/me merely failed", async () => {
    const refresh = vi.fn();
    renderGuard({
      currentUser: null,
      currentUserError: new Error("500 Internal Server Error"),
      refreshCurrentUser: refresh,
    });

    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
    expect(screen.getByText(/could not load your account/i)).toBeInTheDocument();

    // And the way out is retrying, not restarting onboarding.
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(refresh).toHaveBeenCalled();
  });

  it("sends an unauthenticated visitor to /login", () => {
    renderGuard({ isAuthenticated: false });
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/login");
  });

  it("waits rather than deciding while auth is still loading", () => {
    renderGuard({ isLoading: true });
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("renders the app for an onboarded user", () => {
    renderGuard({ currentUser: { townId: "town-1" } });
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });
});
