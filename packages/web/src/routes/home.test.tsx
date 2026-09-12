/**
 * Home (/) — role-aware landing.
 *
 * Phase E, wave 6, Task 5 — the Supabase chain mock is GONE. All four of this
 * screen's reads (`town.detail`, `meeting.byTown`,
 * `minutesDocument.pendingByTown`, `board.listActive`) now run through the
 * real options proxy with only `globalThis.fetch` replaced (conventions item
 * 8/9), which is what makes the `pathFilter()` assertions below expressible at
 * all — under the old wholesale mock the keys were invented by the test.
 */

import React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
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

// Avoid the first-run tour and the create dialog
vi.mock("@/components/QuickTour", () => ({
  QuickTour: () => null,
  useShouldShowTour: () => false,
}));
vi.mock("@/components/meetings/CreateMeetingDialog", () => ({
  CreateMeetingDialog: () => null,
}));

// ─── tRPC stub (all four reads) ───────────────────────────────────────

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

const liveMeeting = {
  id: "m-live",
  title: "Regular Meeting",
  status: "open",
  meeting_type: "regular",
  scheduled_date: new Date().toISOString().slice(0, 10),
  scheduled_time: "18:00:00",
  // Added to `meeting.byTown` in wave 6, Task 5 for the "started N min ago"
  // line this screen renders — the only reader of the column.
  started_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  board_id: "b1",
  board_name: "Select Board",
} satisfies RouterOutputs["meeting"]["byTown"][number];

const boards = [
  {
    id: "b1",
    name: "Select Board",
    member_count: 5,
    is_governing_board: true,
    election_method: "at_large",
    officer_election_method: "vote_of_board",
  },
] satisfies RouterOutputs["board"]["listActive"];

/** Mutable so a test can change what the server returns between refetches. */
const server = {
  detailRejects: false,
  meetingsReject: false,
  meetings: [] as RouterOutputs["meeting"]["byTown"],
  pending: [] as RouterOutputs["minutesDocument"]["pendingByTown"],
};

const stub = installTRPCFetchStub({
  "town.detail": () => {
    if (server.detailRejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return fullTown;
  },
  "meeting.byTown": () => {
    if (server.meetingsReject) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.meetings;
  },
  "minutesDocument.pendingByTown": () => server.pending,
  "board.listActive": () => boards,
});

import Home from "@/routes/home";

describe("Home (role-aware)", () => {
  beforeEach(() => {
    server.detailRejects = false;
    server.meetingsReject = false;
    server.meetings = [];
    server.pending = [];
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

  it("leads with an open meeting, and says how long ago it started", async () => {
    server.meetings = [liveMeeting];
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });

    expect(await screen.findByText("Happening now")).toBeInTheDocument();
    // `started_at` is the column this screen is the only reader of; without
    // it in `meeting.byTown` this line cannot render at all.
    expect(await screen.findByText(/started 12 min ago/)).toBeInTheDocument();
  });

  it("surfaces minutes pending review, which needs BOTH reads to agree", async () => {
    const adjourned = {
      ...liveMeeting,
      id: "m-adj",
      status: "adjourned",
      title: "Adjourned Meeting",
    };
    server.meetings = [adjourned];
    server.pending = [{ meeting_id: "m-adj", status: "review" as const }];
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });

    expect(await screen.findByText("Minutes pending review")).toBeInTheDocument();
  });

  it("offers only active boards in the Schedule meeting picker", async () => {
    // `board.listActive` filters `archived_at IS NULL` — the hazard this
    // screen's header has named for four waves (never offer an archived board
    // as a place to schedule a meeting).
    userRef.value = createAdminUser();
    permRef.allowed = true;
    const { user } = renderWithProviders(<Home />, { route: "/", queryClient });

    await user.click((await screen.findAllByRole("button", { name: /schedule meeting/i }))[0]!);
    expect(await screen.findByText("Which board is meeting?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Board" })).toBeInTheDocument();
  });

  it("replaces the pipeline with an alert when meeting.byTown rejects", async () => {
    // Every section on this screen is computed from `meetingRows`; rendering
    // them from an empty array would show a healthy-looking, empty landing.
    server.meetingsReject = true;
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });

    expect(await screen.findByText(/couldn't load your meetings/i)).toBeInTheDocument();
    expect(screen.queryByText("Your meeting pipeline")).not.toBeInTheDocument();
  });

  it("refetches when a writer invalidates trpc.meeting.pathFilter()", async () => {
    server.meetings = [liveMeeting];
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });
    // The hero and the Upcoming table both render the title, so this is
    // "at least one", not "exactly one".
    await waitFor(() => expect(screen.getAllByText("Regular Meeting").length).toBeGreaterThan(0));
    const before = stub.countFor("meeting.byTown");

    server.meetings = [{ ...liveMeeting, title: "Renamed Meeting" }];
    await queryClient.invalidateQueries(trpc.meeting.pathFilter());

    await waitFor(() => expect(stub.countFor("meeting.byTown")).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getAllByText("Renamed Meeting").length).toBeGreaterThan(0));
  });

  it("refetches when a writer invalidates trpc.minutesDocument.pathFilter()", async () => {
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });
    await waitFor(() => expect(stub.countFor("minutesDocument.pendingByTown")).toBeGreaterThan(0));
    const before = stub.countFor("minutesDocument.pendingByTown");

    await queryClient.invalidateQueries(trpc.minutesDocument.pathFilter());

    await waitFor(() =>
      expect(stub.countFor("minutesDocument.pendingByTown")).toBeGreaterThan(before),
    );
  });

  it("refetches the board picker when a writer invalidates trpc.board.pathFilter()", async () => {
    userRef.value = createAdminUser();
    permRef.allowed = true;
    renderWithProviders(<Home />, { route: "/", queryClient });
    await waitFor(() => expect(stub.countFor("board.listActive")).toBeGreaterThan(0));
    const before = stub.countFor("board.listActive");

    await queryClient.invalidateQueries(trpc.board.pathFilter());

    await waitFor(() => expect(stub.countFor("board.listActive")).toBeGreaterThan(before));
  });
});
