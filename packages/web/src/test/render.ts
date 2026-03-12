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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MockAuthProvider } from "./mocks/auth-mock";
import { createAdminUser } from "./mocks/auth-mock";
import type { CurrentUser } from "@/hooks/useCurrentUser";

// ─── Test QueryClient ────────────────────────────────────────────────

/**
 * Create a QueryClient configured for unit tests:
 * no retries, no stale time, immediate garbage collection.
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// ─── Options ────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Mock user for auth context. Default: admin user. Pass null for unauthenticated. */
  user?: CurrentUser | null;
  /** Initial route path. Default: "/" */
  route?: string;
}

// ─── Render helper ──────────────────────────────────────────────────

/**
 * Render a component wrapped in all test providers:
 * - QueryClientProvider (TanStack Query)
 * - MemoryRouter (React Router)
 * - MockAuthProvider (auth context)
 *
 * Supabase reads/writes are mocked at the module level via
 * vi.mock("@/lib/supabase") in individual test files.
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

  const testQueryClient = createTestQueryClient();

  const result = render(ui, {
    wrapper: ({ children }) =>
      React.createElement(
        QueryClientProvider,
        { client: testQueryClient },
        React.createElement(
          MemoryRouter,
          { initialEntries: [route] },
          React.createElement(
            MockAuthProvider,
            { mockUser },
            children,
          ),
        ),
      ),
  });

  return { ...result, user: eventUser };
}

// ─── Re-exports ─────────────────────────────────────────────────────

export { screen, waitFor, within, userEvent };
