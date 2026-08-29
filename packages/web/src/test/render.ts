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
import { afterEach, beforeEach } from "vitest";
import { render, type RenderResult, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider, type DefaultOptions } from "@tanstack/react-query";
import { MockAuthProvider } from "./mocks/auth-mock";
import { createAdminUser } from "./mocks/auth-mock";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import type { CurrentUser } from "@/hooks/useCurrentUser";

// ─── Test QueryClient ────────────────────────────────────────────────

/** No retries, no stale time, immediate garbage collection. */
const TEST_QUERY_DEFAULTS: DefaultOptions = {
  queries: { retry: false, staleTime: 0, gcTime: 0 },
  mutations: { retry: false },
};

/**
 * Create a QueryClient configured for unit tests:
 * no retries, no stale time, immediate garbage collection.
 *
 * Fine for a component with no tRPC read in it. A screen that calls `trpc.*`
 * must use `setupAppQueryClient()` instead — see below.
 */
export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: TEST_QUERY_DEFAULTS });
}

/**
 * Borrow the application's real QueryClient singleton for one test file, with
 * test defaults installed and the production defaults restored afterwards.
 *
 * Phase E, unit 0, task 5 — this replaces the workaround task 4 shipped.
 * A tRPC screen cannot use a freshly built client: `lib/trpc.ts` binds its
 * options proxy to the singleton in `lib/queryClient.ts`, and every
 * `clientLoader` calls `ensureQueryData` on that same singleton. Rendering
 * such a screen under a different client means the loader primes one cache
 * and the component reads another.
 *
 * Task 4 handled that by calling `queryClient.setDefaultOptions({...})` in its
 * own `beforeEach` and never putting them back — safe only because vitest
 * isolates modules per file, and about to be copied into eighty files. This
 * saves and restores instead, and clears the cache on both edges so one test's
 * cached row cannot satisfy the next test's read.
 *
 * ```ts
 * const queryClient = setupAppQueryClient();
 * // ...
 * renderWithProviders(<BoardDetailPage {...props} />, { queryClient });
 * ```
 */
export function setupAppQueryClient(): QueryClient {
  const productionDefaults = appQueryClient.getDefaultOptions();

  beforeEach(() => {
    appQueryClient.clear();
    // `gcTime: Infinity`, unlike `createTestQueryClient()`'s `0`: a fresh
    // per-render client is discarded with the test, so immediate collection
    // costs nothing there. Here the cache outlives the render, and an
    // invalidation assertion reads a query that has no observer left — with
    // `gcTime: 0` that entry is already gone and `getQueryState()` answers
    // `undefined`, which reads as "not invalidated" and quietly makes the
    // assertion vacuous. `clear()` on both edges is what keeps files isolated.
    appQueryClient.setDefaultOptions({
      ...TEST_QUERY_DEFAULTS,
      queries: { ...TEST_QUERY_DEFAULTS.queries, gcTime: Infinity },
    });
  });

  afterEach(() => {
    appQueryClient.clear();
    appQueryClient.setDefaultOptions(productionDefaults);
  });

  return appQueryClient;
}

// ─── Options ────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Mock user for auth context. Default: admin user. Pass null for unauthenticated. */
  user?: CurrentUser | null;
  /** Initial route path. Default: "/" */
  route?: string;
  /**
   * The QueryClient to provide. Default: a fresh per-render test client.
   *
   * Pass the value returned by `setupAppQueryClient()` for any screen that
   * reads through `trpc.*`, so the component, the options proxy and the route
   * loader all share one cache.
   */
  queryClient?: QueryClient;
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
 * ─── `user` does NOT reach `useCurrentUser()` ─────────────────────────────
 *
 * `MockAuthProvider` publishes its own `AuthContext`, created in
 * `test/mocks/auth-mock.ts`. `useCurrentUser()` calls `useAuth()` from
 * `@/providers/AuthProvider`, which reads a DIFFERENT context object and
 * throws "useAuth must be used within an AuthProvider" when it finds nothing.
 * So passing `user:` here configures a context that the component under test
 * never reads.
 *
 * The ruling for Phase E: mock the hook —
 * `vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ townId:
 * "town-1" }) }))` — which is what all eight files that actually depend on
 * identity already do, including the one file that also mocks
 * `@/providers/AuthProvider`. Do not add a second mechanism per screen.
 *
 * Returns the standard RTL render result plus a pre-configured
 * userEvent instance.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult & { user: UserEvent } {
  const { user, route = "/", queryClient } = options;
  const mockUser = user === undefined ? createAdminUser() : user;

  const eventUser = userEvent.setup();

  const testQueryClient = queryClient ?? createTestQueryClient();

  const result = render(ui, {
    wrapper: ({ children }) =>
      React.createElement(
        QueryClientProvider,
        { client: testQueryClient },
        React.createElement(
          MemoryRouter,
          { initialEntries: [route] },
          React.createElement(MockAuthProvider, { mockUser }, children),
        ),
      ),
  });

  return { ...result, user: eventUser };
}

// ─── Re-exports ─────────────────────────────────────────────────────

export { screen, waitFor, within, userEvent };
