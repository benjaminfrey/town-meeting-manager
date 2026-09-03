/**
 * Home (/) — role-aware landing.
 *
 * Stage 1, Phase E, wave 1, Task 5 — the town name/state header moved onto
 * `town.detail`, so this file now needs `setupAppQueryClient()` +
 * `installTRPCFetchStub` (conventions item 8/9), the same shape every other
 * tRPC screen test in this phase uses: the real options proxy and a real
 * `QueryClient` run, only `globalThis.fetch` is replaced. `@/lib/supabase`
 * stays mocked wholesale — `meetingRows`, `minutesDocs` and `boardRows` all
 * still go through it (see `home.tsx`'s own `TODO(phase-e-wave-6)` marker —
 * retagged in wave 3's Task 0 after `meeting.byTown` shipped and closed the
 * `meetingRows` third of what this comment used to cite as `wave-2`; this
 * file's own reference was stale until this fix round caught it).
 */

import React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { type RouterOutputs } from "@/lib/trpc";
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

// Supabase chain — every remaining Home Supabase query resolves empty
// (meetingRows, minutesDocs, boardRows — see home.tsx's own header comment
// for why these three are not yet on tRPC).
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

// ─── tRPC stub (town.detail) ──────────────────────────────────────────

const queryClient = setupAppQueryClient();

/** A full `town.detail` row, `satisfies`-checked — see conventions item 8. */
const fullTown = {
  id: "town-1",
  name: "Newcastle",
  state: "ME",
  municipality_type: "town",
  population_range: "under_1000",
  contact_name: "Jamie Clerk",
  contact_role: "Town Clerk",
  meeting_formality: "semi_formal",
  minutes_style: "action",
  presiding_officer_default: "chair_of_board",
  minutes_recorder_default: "town_clerk",
  staff_roles_present: null,
  subdomain: "newcastle",
  seal_url: null,
  retention_policy_acknowledged_at: null,
  minutes_workflow_configured_at: null,
  audio_retention_policy: "retain_30_days",
  auto_publish_on_approval: false,
  minutes_review_window_days: 7,
} satisfies RouterOutputs["town"]["detail"];

/** Mutable so a test can make `town.detail` reject. */
const server = { detailRejects: false };

installTRPCFetchStub({
  "town.detail": () => {
    if (server.detailRejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return fullTown;
  },
});

import Home from "@/routes/home";

describe("Home (role-aware)", () => {
  beforeEach(() => {
    server.detailRejects = false;
  });

  it("admin sees the meeting pipeline and the Schedule meeting action", async () => {
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });

    expect(await screen.findByText("Your meeting pipeline")).toBeInTheDocument();
    expect(screen.getAllByText(/schedule meeting/i).length).toBeGreaterThan(0);
    // The lifecycle spine names every stage
    expect(screen.getByText("Published")).toBeInTheDocument();
    // town.detail settled — the header shows the real town name, not the
    // "Your town" default.
    expect(await screen.findByText("Newcastle")).toBeInTheDocument();
  });

  it("board member sees neither the pipeline nor Schedule meeting", async () => {
    userRef.value = createBoardMemberUser();
    permRef.allowed = false;
    renderWithProviders(<Home />, { route: "/", queryClient });

    // Still renders a useful landing
    expect(await screen.findByText("Upcoming (next 30 days)")).toBeInTheDocument();
    expect(screen.queryByText("Your meeting pipeline")).not.toBeInTheDocument();
    expect(screen.queryByText(/schedule meeting/i)).not.toBeInTheDocument();
  });

  it("shows a non-blocking alert, and the 'Your town' default, when town.detail rejects", async () => {
    // The failure mode this migration exists to end is a screen that fails
    // silently. Unlike settings.town.tsx, this read does not gate the whole
    // page — the meeting pipeline still renders — but the failure must still
    // be visible (conventions item 5/12).
    server.detailRejects = true;
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("Your town")).toBeInTheDocument();
    // The rest of the page is still useful — not replaced by the alert.
    expect(await screen.findByText("Your meeting pipeline")).toBeInTheDocument();
  });
});
