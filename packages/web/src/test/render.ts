/**
 * Test render helper — wraps components in all required providers.
 *
 * Usage:
 *   import { renderWithProviders, screen } from "@/test/render";
 *   import { createStaffUser } from "@/test/mocks/auth-mock";
 *
 *   const { user } = renderWithProviders(<MyComponent />, {
 *     user: createStaffUser("Town Clerk"),
 *     route: "/dashboard",
 *   });
 *
 *   expect(screen.getByText("Dashboard")).toBeInTheDocument();
 */

import React, { type ReactElement } from "react";
import { render, type RenderResult, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { MockAuthProvider } from "./mocks/auth-mock";
import { createAdminUser } from "./mocks/auth-mock";
import type { CurrentUser } from "@/hooks/useCurrentUser";
import type { MockPowerSyncDatabase } from "./mocks/powersync-mock";

// ─── Options ────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Mock user for auth context. Default: admin user. Pass null for unauthenticated. */
  user?: CurrentUser | null;
  /** Mock PowerSync database (for usePowerSync). Typically mocked at module level. */
  powerSync?: MockPowerSyncDatabase;
  /** Initial route path. Default: "/" */
  route?: string;
}

// ─── Render helper ──────────────────────────────────────────────────

/**
 * Render a component wrapped in all test providers:
 * - MemoryRouter (React Router)
 * - MockAuthProvider (auth context)
 *
 * PowerSync (useQuery, usePowerSync) is mocked at the module level
 * via vi.mock("@powersync/react") in individual test files.
 *
 * Returns the standard RTL render result plus a pre-configured
 * userEvent instance.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult & { user: UserEvent } {
  const { user, route = "/" } = options;
  const mockUser = user === undefined ? createAdminUser() : user;

  const eventUser = userEvent.setup();

  const result = render(ui, {
    wrapper: ({ children }) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: [route] },
        React.createElement(
          MockAuthProvider,
          { mockUser },
          children,
        ),
      ),
  });

  return { ...result, user: eventUser };
}

// ─── Re-exports ─────────────────────────────────────────────────────

export { screen, waitFor, within, userEvent };
