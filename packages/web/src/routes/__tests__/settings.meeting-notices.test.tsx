/**
 * `settings.meeting-notices.tsx` — `board.list` / `board.copyNoticeTemplate`
 * on tRPC.
 *
 * Same shape as `boards.$boardId.test.tsx`: the real options proxy and real
 * `QueryClient` singleton run; only `globalThis.fetch` is replaced
 * (`installTRPCFetchStub`). No `@/lib/supabase` mock at all — this screen no
 * longer has any Supabase reads or writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

/** A full `board.detail` row — see `ArchiveBoardDialog.test.tsx`'s copy of this fixture. */
const fullBoard: RouterOutputs["board"]["detail"] = {
  id: "b2",
  name: "Planning Board",
  elected_or_appointed: "elected",
  member_count: 5,
  election_method: "at_large",
  officer_election_method: "vote_of_board",
  is_governing_board: false,
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

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns/records between calls. */
const server = {
  boards: [
    {
      id: "b1",
      name: "Select Board",
      notice_template_blocks: [{ id: "block-1", type: "letterhead" }],
      member_count: 5,
    },
    { id: "b2", name: "Planning Board", notice_template_blocks: null, member_count: null },
  ] as Array<{
    id: string;
    name: string;
    notice_template_blocks: unknown[] | null;
    member_count: number | null;
  }>,
  listRejects: false,
};

const stub = installTRPCFetchStub({
  "board.list": () => {
    if (server.listRejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.boards;
  },
  "board.copyNoticeTemplate": (input) => {
    const source = server.boards.find((b) => b.id === input.sourceBoardId);
    const target = server.boards.find((b) => b.id === input.targetBoardId);
    if (!source || !target) trpcTestError("NOT_FOUND");
    target!.notice_template_blocks = source!.notice_template_blocks;
    return { id: target!.id, notice_template_blocks: target!.notice_template_blocks };
  },
});

import MeetingNoticesSettingsPage from "../settings.meeting-notices";

function renderPage() {
  return renderWithProviders(<MeetingNoticesSettingsPage />, {
    route: "/settings/meeting-notices",
    queryClient,
  });
}

describe("settings.meeting-notices", () => {
  beforeEach(() => {
    server.boards = [
      {
        id: "b1",
        name: "Select Board",
        notice_template_blocks: [{ id: "block-1", type: "letterhead" }],
        member_count: 5,
      },
      { id: "b2", name: "Planning Board", notice_template_blocks: null, member_count: null },
    ];
    server.listRejects = false;
  });

  it("shows configured and not-configured boards once the read settles", async () => {
    renderPage();
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
    expect(await screen.findByText("Planning Board")).toBeInTheDocument();
    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(await screen.findByText("Not configured")).toBeInTheDocument();
    expect(await screen.findByText("1 of 2 boards configured")).toBeInTheDocument();
  });

  it("shows an error state when board.list rejects, not an empty page", async () => {
    server.listRejects = true;
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText("Something went wrong loading your boards."),
    ).toBeInTheDocument();
  });

  it("copying a template invalidates trpc.board.pathFilter() and the legacy per-board detail key", async () => {
    const detailKey = trpc.board.detail.queryOptions({ boardId: "b2" }).queryKey;
    const legacyKey = queryKeys.boards.detail("b2");
    queryClient.setQueryData(detailKey, fullBoard);
    queryClient.setQueryData(legacyKey, { id: "b2" });
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();
    expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();

    const { user } = renderPage();
    await screen.findByText("Planning Board");

    const copyButtons = await screen.findAllByRole("button", { name: /copy from board/i });
    await user.click(copyButtons[0]!);
    const sourceOption = await screen.findByRole("button", { name: "Select Board" });
    await user.click(sourceOption);

    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("reflects the copied template after the write settles", async () => {
    const { user } = renderPage();
    await screen.findByText("Planning Board");

    const copyButtons = await screen.findAllByRole("button", { name: /copy from board/i });
    await user.click(copyButtons[0]!);
    const sourceOption = await screen.findByRole("button", { name: "Select Board" });
    await user.click(sourceOption);

    await waitFor(() => expect(stub.countFor("board.copyNoticeTemplate")).toBe(1));
    await waitFor(() => expect(screen.getAllByText("Configured")).toHaveLength(2));
  });
});
