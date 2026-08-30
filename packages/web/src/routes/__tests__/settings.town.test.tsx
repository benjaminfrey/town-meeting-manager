/**
 * Town Profile screen — `town.detail` on tRPC.
 *
 * Same shape as `boards.$boardId.test.tsx`: the real options proxy and real
 * `QueryClient` singleton run; only `globalThis.fetch` is replaced
 * (`installTRPCFetchStub`). `@/lib/supabase` is no longer mocked — wave 2,
 * Task 2 moved this route's own boards list (the "Governing Board" /
 * "Boards & Committees" sections) onto `board.listActive`, and
 * `ProgressChecklist`'s last remaining own Supabase read (`memberCount`, off
 * `board_member`) onto `board.memberCount` — both stubbed below like every
 * other tRPC procedure, closing the two `TODO(phase-e-wave-2)` markers this
 * file used to work around.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import SettingsTownPage from "../settings.town";

// ─── Mock identity ──────────────────────────────────────────────────────

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns between refetches. */
const server = { townName: "Newcastle", detailRejects: false };

const stub = installTRPCFetchStub({
  "town.detail": () => {
    if (server.detailRejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return {
      id: "town-1",
      name: server.townName,
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
    };
  },
  "board.list": () => [],
  "board.listActive": () => [
    {
      id: "b1",
      name: "Select Board",
      member_count: 5,
      is_governing_board: true,
      election_method: "at_large",
      officer_election_method: "vote_of_board",
    },
  ],
  "board.memberCount": () => 3,
});

function renderRoute() {
  return renderWithProviders(
    <SettingsTownPage {...({} as Parameters<typeof SettingsTownPage>[0])} />,
    { route: "/settings/town", queryClient },
  );
}

describe("settings.town", () => {
  beforeEach(() => {
    server.townName = "Newcastle";
    server.detailRejects = false;
  });

  it("shows the town's profile once the read settles", async () => {
    // The settings sections are collapsed Radix accordion panels by default
    // — their summary rows (e.g. the contact line) are not in the DOM until
    // expanded, and neither are the four editors: `isEditing` starts false,
    // so `TownSettingsEditor` / `MeetingDefaultsEditor` / `MeetingRolesEditor`
    // never mount here and their typed `initial` props are NOT exercised by
    // this test (F8, Task 2 fix round — an earlier version of this comment
    // overclaimed that they were). What this test DOES prove: the route's
    // own `const t = { ... }` mapping off `town.detail`'s row builds without
    // throwing, the always-visible heading and section titles render (the
    // titles are static JSX strings, not town data — they only confirm the
    // page didn't crash before reaching them), and the two children that DO
    // receive `town.detail`-derived props while collapsed —
    // `ProgressChecklist` (sealUrl, subdomain, the two timestamps) and
    // `TownSealUpload` (sealUrl) — render without error.
    renderRoute();
    expect(await screen.findByText("Town of Newcastle")).toBeInTheDocument();
    expect(await screen.findByText("Your Town")).toBeInTheDocument();
    expect(await screen.findByText("Meeting Roles")).toBeInTheDocument();
  });

  it("shows an error state when town.detail rejects, not an empty page", async () => {
    // The failure mode this whole phase exists to end is a screen that
    // renders nothing and says nothing. An error must be visible.
    server.detailRejects = true;
    renderRoute();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText("Something went wrong loading your town's settings."),
    ).toBeInTheDocument();
  });

  it("opens SetPortalAddressModal from the portal-subdomain checklist row", async () => {
    // The wiring this test pins: `ProgressChecklist`'s "portal-subdomain"
    // row calls `onSetPortalAddressClick`, which this ROUTE (not
    // `ProgressChecklist` itself) turns into opening `SetPortalAddressModal`
    // — see this file's own header comment and `ProgressChecklist.tsx`'s.
    // Before Task 5, this row had no `onClick` at all (a `linkTo="/settings"`
    // that led nowhere useful), so there was no way to complete this
    // checklist item anywhere in the product.
    const { user } = renderRoute();
    const row = await screen.findByText(/public portal subdomain set/i);
    await user.click(row);
    expect(await screen.findByText("Set your public portal address")).toBeInTheDocument();
  });

  it("shows the governing board from board.listActive once its section is expanded", async () => {
    // Pins the wiring this task closed: this route's own boards read moved
    // off `queryKeys.boards.byTown` (a Supabase select) onto
    // `trpc.board.listActive` — see this file's header comment. The section
    // is a collapsed accordion panel (see the first test's comment), so it
    // has to be expanded before its summary rows reach the DOM.
    const { user } = renderRoute();
    await user.click(await screen.findByText("Governing Board"));
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
  });

  it("refetches when a writer invalidates trpc.town.pathFilter()", async () => {
    renderRoute();
    expect(await screen.findByText("Town of Newcastle")).toBeInTheDocument();
    const before = stub.countFor("town.detail");

    server.townName = "New Castle";
    await queryClient.invalidateQueries(trpc.town.pathFilter());

    await waitFor(() => expect(stub.countFor("town.detail")).toBeGreaterThan(before));
    expect(await screen.findByText("Town of New Castle")).toBeInTheDocument();
  });
});
