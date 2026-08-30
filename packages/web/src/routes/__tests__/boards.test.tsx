/**
 * Board list screen — `board.list`/`town.detail`/`board.detail` on tRPC.
 *
 * Same shape as `boards.$boardId.test.tsx`: `@/lib/trpc` is NOT mocked, only
 * `globalThis.fetch` is replaced via `installTRPCFetchStub`, so the query
 * keys under test are the real ones a writer's `trpc.board.pathFilter()`
 * invalidation actually reaches.
 *
 * Wave 2, Task 2 — this route's three former Supabase reads (`board`, active
 * `board_member` counts grouped by board, `town`) move onto `trpc.board.list`
 * (extended this task) and `trpc.town.detail`. `EditBoardDialog`/
 * `ArchiveBoardDialog` open against a per-row `trpc.board.detail` fetch, not
 * a field carried on the list row — see the route's own doc comment for why.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import BoardListPage from "../boards";

// ─── Mock identity ──────────────────────────────────────────────────────

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

// `EditBoardDialog` reads a board's meeting count off `@/hooks/useSupabase`
// directly (whether to disable the name field) — not this task's file list.
// Mocked just enough to resolve; see that dialog's own test file for the
// identical mock.
vi.mock("@/hooks/useSupabase", () => {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: { count: number; error: null }) => void) =>
      resolve({ count: 0, error: null }),
  };
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { useSupabase: () => ({ from: vi.fn().mockReturnValue(chain) }) };
});

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

// `satisfies`, not a `:` type annotation — see `SetPortalAddressModal.test.tsx`'s
// `fullTown` for the precedent. Ascribing `RouterOutputs["board"]["list"][number]`
// directly widens the literal to that (client-inferred) type, which disagrees
// with `TestHandlers`' own `inferProcedureOutput`-based type on whether an
// `unknown`-typed column (`notice_template_blocks`) is optional; `satisfies`
// checks compatibility without discarding the literal's own, fully-required type.
const activeBoard = {
  id: "b1",
  name: "Select Board",
  notice_template_blocks: null,
  member_count: 5,
  elected_or_appointed: "elected",
  archived_at: null,
  is_governing_board: true,
  active_member_count: 3,
} satisfies RouterOutputs["board"]["list"][number];

const archivedBoard = {
  id: "b2",
  name: "Old Committee",
  notice_template_blocks: null,
  member_count: 3,
  elected_or_appointed: "appointed",
  archived_at: "2025-01-01T00:00:00Z",
  is_governing_board: false,
  active_member_count: 0,
} satisfies RouterOutputs["board"]["list"][number];

const boardDetail = {
  id: "b1",
  name: "Select Board",
  board_type: "other",
  elected_or_appointed: "elected",
  member_count: 5,
  election_method: "at_large",
  officer_election_method: "vote_of_board",
  is_governing_board: true,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: "simple_majority",
  quorum_value: null,
  motion_display_format: "inline_narrative",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  notice_template_blocks: null,
  minutes_consent_agenda: false,
  minutes_requires_second: true,
  r4_board_member_default: true,
  audio_retention_policy_override: null,
  auto_publish_on_approval_override: null,
} satisfies RouterOutputs["board"]["detail"];

/** Mutable so a test can change what the server returns between refetches. */
const server = {
  boards: [activeBoard, archivedBoard] as (typeof activeBoard | typeof archivedBoard)[],
  listRejects: false,
};

const stub = installTRPCFetchStub({
  "board.list": () => {
    if (server.listRejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.boards;
  },
  "town.detail": () => ({
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
  }),
  "board.detail": () => boardDetail,
});

function renderRoute() {
  return renderWithProviders(<BoardListPage {...({} as Parameters<typeof BoardListPage>[0])} />, {
    route: "/boards",
    queryClient,
  });
}

describe("board list", () => {
  it("shows every active board's name, type and member counts, archived hidden by default", async () => {
    server.boards = [activeBoard, archivedBoard];
    server.listRejects = false;
    renderRoute();

    expect(await screen.findByText("Select Board")).toBeInTheDocument();
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    expect(screen.queryByText("Old Committee")).not.toBeInTheDocument();
  });

  it("reveals archived boards behind the toggle", async () => {
    server.boards = [activeBoard, archivedBoard];
    server.listRejects = false;
    const { user } = renderRoute();

    await screen.findByText("Select Board");
    await user.click(screen.getByLabelText(/show archived/i));

    expect(await screen.findByText("Old Committee")).toBeInTheDocument();
    expect(screen.getByText("0 / 3")).toBeInTheDocument();
  });

  it("shows an error state when board.list rejects, not an empty page", async () => {
    server.listRejects = true;
    renderRoute();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText("Something went wrong loading your town's boards."),
    ).toBeInTheDocument();
  });

  it("opens EditBoardDialog pre-filled from a per-row trpc.board.detail fetch", async () => {
    server.boards = [activeBoard, archivedBoard];
    server.listRejects = false;
    const { user } = renderRoute();

    await screen.findByText("Select Board");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(await screen.findByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Select Board")).toBeInTheDocument();
    expect(stub.countFor("board.detail")).toBeGreaterThan(0);
  });

  it("refetches when a writer invalidates trpc.board.pathFilter()", async () => {
    server.boards = [activeBoard, archivedBoard];
    server.listRejects = false;
    renderRoute();
    await screen.findByText("Select Board");
    const before = stub.countFor("board.list");

    server.boards = [{ ...activeBoard, name: "Renamed Board" }, archivedBoard];
    await queryClient.invalidateQueries(trpc.board.pathFilter());

    await waitFor(() => expect(stub.countFor("board.list")).toBeGreaterThan(before));
    expect(await screen.findByText("Renamed Board")).toBeInTheDocument();
  });
});
