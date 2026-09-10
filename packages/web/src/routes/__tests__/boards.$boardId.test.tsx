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
 * `town` moved onto `trpc.town.detail` in Phase E wave 4, Task 0 — the last
 * raw Supabase read this file had (see the comment above its `useQuery` call
 * in the component). No `@/lib/supabase` mock is needed any more; `town.detail`
 * is stubbed below like `board.detail`/`board.stats`/`board.recentMeetings`.
 * The Overview tab's template count moved onto `trpc.agendaTemplate.countForBoard`
 * in wave 2, Task 2 — stubbed the same way.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import type { MeetingFormality } from "@town-meeting/shared";
import BoardDetailPage from "../boards.$boardId";

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
const server = {
  boardName: "Select Board",
  detailRejects: false,
  townName: "Newcastle",
  townMeetingFormality: "semi_formal" as MeetingFormality,
};

// Collection scope, once per file — see `installTRPCFetchStub`'s doc comment.
// Per-test variation goes through `server` above, which the handlers close
// over, not through a second install.
const stub = installTRPCFetchStub({
  "board.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return {
      id: "b1",
      name: server.boardName,
      board_type: "select_board",
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
  "agendaTemplate.countForBoard": () => 2,
  "town.detail": () => ({
    id: "town-1",
    name: server.townName,
    state: "ME",
    municipality_type: "town",
    population_range: "under_1000",
    contact_name: "Jamie Clerk",
    contact_role: "Town Clerk",
    meeting_formality: server.townMeetingFormality,
    minutes_style: "summary",
    presiding_officer_default: null,
    minutes_recorder_default: null,
    staff_roles_present: null,
    subdomain: "newcastle",
    seal_url: null,
    retention_policy_acknowledged_at: null,
    minutes_workflow_configured_at: null,
    audio_retention_policy: "retain_30_days",
    auto_publish_on_approval: false,
    minutes_review_window_days: 7,
  }),
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
    server.townName = "Newcastle";
    server.townMeetingFormality = "semi_formal";
  });

  it("shows the board's name and its member and meeting counts", async () => {
    renderRoute("b1");
    // The name renders twice (breadcrumb + header), so assert with findAllByText.
    expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
    expect(await screen.findByText("3 members")).toBeInTheDocument();
    expect(await screen.findByText("7 meetings")).toBeInTheDocument();
    // `agendaTemplate.countForBoard` (wave 2, Task 2) — the Overview tab's
    // template count, no longer read off `@/lib/supabase`.
    expect(await screen.findByText("2 templates")).toBeInTheDocument();
  });

  it("shows the Overview tab's effective formality, sourced from the town default", async () => {
    // `board.meeting_formality_override` is `null` in the stub above, so
    // `getEffectiveBoardSettings` falls through to `town.detail`'s own
    // `meeting_formality` — the read this task wired up. Proves the town
    // read actually reaches the Overview tab's "town default" row, not just
    // that the query resolves.
    renderRoute("b1");
    expect(await screen.findByText("Structured (semi-formal)")).toBeInTheDocument();
    // Both the formality AND minutes-style rows fall through to the town
    // default here (neither board override is set in the stub above), so
    // two rows carry the "— town default" suffix — findAllByText, not
    // findByText.
    expect((await screen.findAllByText("— town default")).length).toBe(2);
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
