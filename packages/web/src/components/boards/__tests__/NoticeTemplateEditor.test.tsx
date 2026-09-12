/**
 * A writer's cache invalidation is a pinnable behaviour, not a code comment.
 *
 * Phase E, unit 0 final-fix pass. `NoticeTemplateEditor` is the writer named
 * directly in `docs/superpowers/plans/phase-e-conventions.md` item 8: a
 * reviewer deleted its `trpc.board.pathFilter()` invalidation line and ran
 * the whole suite — nothing red, because every test touching it mocked
 * `@/lib/trpc` wholesale. This is the pin that closes that hole.
 *
 * Same shape as `ArchiveBoardDialog.test.tsx`: the real options proxy and the
 * real QueryClient singleton run, the test seeds the cache under the key
 * `boards.$boardId.tsx` actually reads — `trpc.board.detail.queryOptions({
 * boardId }).queryKey` — saves the template, and asserts that entry was
 * invalidated. Deleting the `pathFilter()` line from `NoticeTemplateEditor`
 * turns this red.
 *
 * Wave 6, Task 5: the Supabase chain mock is gone — the write is
 * `trpc.board.updateNoticeTemplate`, which is also the first version of it
 * that can be REFUSED (the raw write had no guard of any kind).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";

const server = { refuses: false };
const received: { save?: RouterInputs["board"]["updateNoticeTemplate"] } = {};

const stub = installTRPCFetchStub({
  "board.updateNoticeTemplate": (input) => {
    received.save = input;
    if (server.refuses) trpcTestError("FORBIDDEN");
    return { id: input.boardId };
  },
});

import { NoticeTemplateEditor } from "../NoticeTemplateEditor";

const queryClient = setupAppQueryClient();

const boardId = "b1";

const board: RouterOutputs["board"]["detail"] = {
  id: boardId,
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
};

async function save() {
  const detailKey = trpc.board.detail.queryOptions({ boardId }).queryKey;
  queryClient.setQueryData(detailKey, board);
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <NoticeTemplateEditor boardId={boardId} initialBlocks={null} />,
    { queryClient },
  );

  // Adding a block is the cheapest way to flip `dirty` and enable Save.
  await user.click(screen.getByRole("button", { name: /add block/i }));
  await user.click(screen.getByRole("button", { name: /^spacer$/i }));
  await user.click(screen.getByRole("button", { name: /save template/i }));
  await waitFor(() => expect(stub.countFor("board.updateNoticeTemplate")).toBe(1));

  return { detailKey };
}

describe("NoticeTemplateEditor", () => {
  beforeEach(() => {
    server.refuses = false;
    received.save = undefined;
  });

  it("invalidates the tRPC key the board detail screen reads under", async () => {
    const { detailKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });

  it("sends the board id and the whole block list", async () => {
    await save();
    expect(received.save?.boardId).toBe(boardId);
    expect(received.save?.blocks).toHaveLength(1);
    expect(received.save?.blocks[0]).toMatchObject({ type: "spacer", order: 0 });
  });

  it("says why the save failed instead of 'Failed to save template. Please try again.'", async () => {
    server.refuses = true;
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /don't have permission to change this board's notice template/i,
    );
  });
});
