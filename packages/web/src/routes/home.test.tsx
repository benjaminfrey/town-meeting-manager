import React from "react";
import { vi, describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { createAdminUser, createBoardMemberUser } from "@/test/mocks/auth-mock";
import type { CurrentUser } from "@/hooks/useCurrentUser";

// Injected per-test
const { userRef, permRef } = vi.hoisted(() => ({
  userRef: { value: null as CurrentUser | null },
  permRef: { allowed: true },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => userRef.value,
}));
vi.mock("@/hooks/usePermission", () => ({
  usePermission: () => ({ allowed: permRef.allowed }),
}));

// Supabase chain — all Home queries resolve empty
const { mockFrom } = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject);
  chain["catch"] = (reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).catch(reject);
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit", "throwOnError"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { mockFrom: vi.fn().mockReturnValue(chain) };
});
vi.mock("@/lib/supabase", () => ({ supabase: { from: mockFrom } }));

// Avoid the first-run tour and the create dialog
vi.mock("@/components/QuickTour", () => ({
  QuickTour: () => null,
  useShouldShowTour: () => false,
}));
vi.mock("@/components/meetings/CreateMeetingDialog", () => ({
  CreateMeetingDialog: () => null,
}));

import Home from "@/routes/home";

describe("Home (role-aware)", () => {
  it("admin sees the meeting pipeline and the Schedule meeting action", async () => {
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/" });

    expect(await screen.findByText("Your meeting pipeline")).toBeInTheDocument();
    expect(screen.getAllByText(/schedule meeting/i).length).toBeGreaterThan(0);
    // The lifecycle spine names every stage
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("board member sees neither the pipeline nor Schedule meeting", async () => {
    userRef.value = createBoardMemberUser();
    permRef.allowed = false;
    renderWithProviders(<Home />, { route: "/" });

    // Still renders a useful landing
    expect(
      await screen.findByText("Upcoming (next 30 days)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your meeting pipeline")).not.toBeInTheDocument();
    expect(screen.queryByText(/schedule meeting/i)).not.toBeInTheDocument();
  });
});
