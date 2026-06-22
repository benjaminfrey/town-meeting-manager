import React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { createAdminUser } from "@/test/mocks/auth-mock";
import { APP_NAME } from "@town-meeting/shared";
import type { CurrentUser } from "@/hooks/useCurrentUser";

// Current user is injected per-test
const { userRef } = vi.hoisted(() => ({
  userRef: { value: null as CurrentUser | null },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => userRef.value,
}));

// Supabase chain — the live-meeting indicator query resolves empty
const { mockFrom } = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject);
  chain["catch"] = (reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).catch(reject);
  for (const m of ["select", "eq", "in", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { mockFrom: vi.fn().mockReturnValue(chain) };
});
vi.mock("@/lib/supabase", () => ({ supabase: { from: mockFrom } }));

// Isolate the shell from heavy children
vi.mock("@/components/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/ConnectionStatusBar", () => ({ ConnectionStatusBar: () => null }));
vi.mock("@/components/NavigationProgress", () => ({ NavigationProgress: () => null }));
vi.mock("@/components/LogoutDialog", () => ({
  LogoutDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));

import AppShell from "@/layouts/AppShell";

describe("AppShell", () => {
  beforeEach(() => {
    userRef.value = createAdminUser();
  });

  it("renders the wordmark and the primary navigation", () => {
    renderWithProviders(<AppShell />, { route: "/" });
    // Wordmark shows in the sidebar (and mobile top bar)
    expect(screen.getAllByText(APP_NAME).length).toBeGreaterThan(0);
    for (const label of ["Home", "Meetings", "Boards", "Settings"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("hides the live-meeting indicator when no meeting is in progress", () => {
    renderWithProviders(<AppShell />, { route: "/" });
    expect(screen.queryByText("Meeting live")).not.toBeInTheDocument();
  });

  it("exposes a command-palette search trigger", () => {
    renderWithProviders(<AppShell />, { route: "/" });
    expect(
      screen.getByRole("button", { name: /search/i }),
    ).toBeInTheDocument();
  });
});
