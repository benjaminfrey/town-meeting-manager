/**
 * Town Profile screen — `town.detail` on tRPC.
 *
 * Same shape as `boards.$boardId.test.tsx`: the real options proxy and real
 * `QueryClient` singleton run; only `globalThis.fetch` is replaced
 * (`installTRPCFetchStub`). `@/lib/supabase` is mocked too — the boards list
 * (`queryKeys.boards.byTown`) and `ProgressChecklist`'s three own reads still
 * go through it (see `settings.town.tsx`'s `TODO(phase-e-wave-2)` marker) —
 * with a thenable chain, because those call sites await different points in
 * the chain (`.eq(...)` directly in `ProgressChecklist`, `.throwOnError()` in
 * this route), unlike `boards.$boardId.test.tsx`'s mock which only needed the
 * latter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import SettingsTownPage from "../settings.town";

// ─── Mock Supabase (boards list + ProgressChecklist's own reads) ──────────

vi.mock("@/lib/supabase", () => {
  function makeChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      // Every mocked method returns this same object, and the object is
      // itself thenable, so `await` works no matter which chained call a
      // caller happens to await from — `.eq(...)` directly
      // (`ProgressChecklist`) or `.order(...).throwOnError()`
      // (`settings.town.tsx`'s own boards read).
      then: (resolve: (value: { data: unknown[]; count: number; error: null }) => void) =>
        resolve({ data: [], count: 0, error: null }),
    };
    for (const m of ["select", "eq", "is", "order", "limit", "neq", "throwOnError"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    return chain;
  }
  return { supabase: { from: vi.fn().mockReturnValue(makeChain()) } };
});

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
    };
  },
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
