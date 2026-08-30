/**
 * Board detail screen — Overview data on tRPC.
 *
 * This is the file Phase E's remaining waves copy, so read how it mocks
 * before copying what it asserts.
 *
 * `@/lib/trpc` is NOT mocked. The real client and the real options proxy run;
 * only `globalThis.fetch` is replaced, by `installTRPCFetchStub` (see
 * `src/test/trpc.ts` for why that distinction is the whole point). Two things
 * follow, and neither was possible in the first version of this file, which
 * mocked the proxy wholesale:
 *
 *   - the query keys under test are tRPC's own, so the third test below can
 *     prove that a writer's `invalidateQueries(trpc.board.pathFilter())`
 *     actually reaches this screen's read — the exact regression a reviewer
 *     introduced into `NoticeTemplateEditor` and watched 940 tests ignore;
 *   - every handler payload is typed by `inferProcedureOutput` off the real
 *     `AppRouter`, so renaming a column here is a compile error rather than a
 *     green test against a shape the server does not return.
 *
 * `town` and the agenda-template count still read through `@/lib/supabase` in
 * the component (see its comment), so that module is mocked too, just enough
 * that those two queries resolve instead of hitting a real network client in
 * jsdom.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import BoardDetailPage from "../boards.$boardId";

// ─── Mock Supabase (only town + template-count reads still use it) ─────────

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  chain["throwOnError"] = () => Promise.resolve({ data: [], count: 0, error: null });
  for (const m of ["select", "eq", "limit", "order", "neq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { supabase: { from: vi.fn().mockReturnValue(chain) } };
});

// ─── Mock identity ──────────────────────────────────────────────────────
//
// The hook, not `MockAuthProvider` — see `renderWithProviders`'s doc comment
// for why the provider's `user` option cannot reach `useCurrentUser()`.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns between refetches. */
const server = { boardName: "Select Board", detailRejects: false };

// Collection scope, once per file — see `installTRPCFetchStub`'s doc comment.
// Per-test variation goes through `server` above, which the handlers close
// over, not through a second install.
const stub = installTRPCFetchStub({
  "board.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return {
      id: "b1",
      name: server.boardName,
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
    };
  },
  "board.stats": () => ({ active_members: 3, meetings: 7 }),
  "board.recentMeetings": () => [],
});

function renderRoute(boardId: string) {
  return renderWithProviders(
    // Only `loaderData` is real here — `params`/`matches` are React Router's
    // data-router plumbing, unused by this component, and not worth wiring a
    // full data router for in a unit test.
    <BoardDetailPage {...({ loaderData: { boardId } } as Parameters<typeof BoardDetailPage>[0])} />,
    { route: `/boards/${boardId}`, queryClient },
  );
}

describe("board detail", () => {
  beforeEach(() => {
    server.boardName = "Select Board";
    server.detailRejects = false;
  });

  it("shows the board's name and its member and meeting counts", async () => {
    renderRoute("b1");
    // The name renders twice (breadcrumb + header), so assert with findAllByText.
    expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
    expect(await screen.findByText("3 members")).toBeInTheDocument();
    expect(await screen.findByText("7 meetings")).toBeInTheDocument();
  });

  it("shows an error state when a query rejects, not an empty page", async () => {
    // The failure mode this whole phase exists to end is a screen that
    // renders nothing and says nothing. An error must be visible.
    server.detailRejects = true;
    renderRoute("b1");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("This board could not be found.")).toBeInTheDocument();
  });

  it("refetches when a writer invalidates trpc.board.pathFilter()", async () => {
    // This is the assertion the previous version of this file could not make.
    // `pathFilter()` is what `EditBoardDialog`, `ArchiveBoardDialog`,
    // `NoticeTemplateEditor` and `MinutesWorkflowEditor` call after their
    // writes; with the real proxy in play, the key it matches is the key this
    // screen actually reads under.
    renderRoute("b1");
    expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
    const before = stub.countFor("board.detail");

    server.boardName = "Renamed Board";
    await queryClient.invalidateQueries(trpc.board.pathFilter());

    await waitFor(() => {
      expect(stub.countFor("board.detail")).toBeGreaterThan(before);
    });
    expect((await screen.findAllByText("Renamed Board")).length).toBeGreaterThan(0);
  });
});
