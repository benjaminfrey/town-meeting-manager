/**
 * A writer's cache invalidation is a pinnable behaviour, not a code comment.
 *
 * Phase E, unit 0 final-fix pass. `MinutesWorkflowEditor` was one of the
 * three writers `docs/superpowers/plans/phase-e-conventions.md` item 8 named
 * as having a `trpc.board.pathFilter()` invalidation call with no test
 * pinning it — a reviewer confirmed deleting that line stays green across
 * all 947 tests. This is that pin.
 *
 * Same shape as `ArchiveBoardDialog.test.tsx`: the real options proxy and the
 * real QueryClient singleton run, the test seeds the cache under the key
 * `boards.$boardId.tsx` actually reads — `trpc.board.detail.queryOptions({
 * boardId }).queryKey` — saves the workflow settings, and asserts that entry
 * was invalidated. Deleting the `pathFilter()` line from
 * `MinutesWorkflowEditor` turns this red.
 *
 * Wave 6, Task 5: the Supabase chain mock is gone — the write is
 * `trpc.board.updateMinutesWorkflow`, so the transport stub carries it and the
 * PAYLOAD is now assertable, which matters here because the raw write this
 * replaced sent an `updated_at` column `board` does not have and therefore
 * never succeeded at all.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterInputs, type RouterOutputs } from "@/lib/trpc";

const server = { refuses: false };
const received: { save?: RouterInputs["board"]["updateMinutesWorkflow"] } = {};

const stub = installTRPCFetchStub({
  "board.updateMinutesWorkflow": (input) => {
    received.save = input;
    if (server.refuses) trpcTestError("FORBIDDEN");
    return { id: input.boardId };
  },
});

import { MinutesWorkflowEditor } from "../MinutesWorkflowEditor";

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
    <MinutesWorkflowEditor
      boardId={boardId}
      initialValues={{
        minutes_consent_agenda: false,
        minutes_requires_second: true,
        r4_board_member_default: true,
        audio_retention_policy_override: null,
        auto_publish_on_approval_override: null,
      }}
      townDefaults={{
        audio_retention_policy: "retain_90_days",
        auto_publish_on_approval: false,
      }}
    />,
    { queryClient },
  );

  // Toggling any switch is the cheapest way to flip `dirty` and enable Save.
  await user.click(screen.getAllByRole("switch")[0]!);
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(stub.countFor("board.updateMinutesWorkflow")).toBe(1));

  return { detailKey };
}

describe("MinutesWorkflowEditor", () => {
  beforeEach(() => {
    server.refuses = false;
    received.save = undefined;
  });

  it("invalidates the tRPC key the board detail screen reads under", async () => {
    const { detailKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });

  it("sends the five minutes-workflow columns, and no phantom updated_at", async () => {
    // The raw write this replaced sent `updated_at`, a column `board` does not
    // have, so PostgREST rejected every save and nothing was ever persisted.
    // `RouterInputs` makes an extra key a compile error, so this assertion is
    // really about the five that ARE sent.
    await save();
    expect(received.save).toEqual({
      boardId,
      // The first switch is "Allow consent agenda approval", toggled on by
      // `save()` to make the form dirty.
      minutes_consent_agenda: true,
      minutes_requires_second: true,
      r4_board_member_default: true,
      audio_retention_policy_override: null,
      auto_publish_on_approval_override: null,
    });
  });

  it("says why the save failed instead of a fixed 'Error saving'", async () => {
    // `board.updateMinutesWorkflow` is the first version of this write that
    // can be REFUSED — there was no guard at all before it.
    server.refuses = true;
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /don't have permission to change this board's minutes workflow/i,
    );
  });
});
