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
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const { updates } = vi.hoisted(() => ({ updates: [] as string[] }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        update: () => chain,
        eq: () => {
          updates.push(table);
          return Object.assign(Promise.resolve({ error: null }), chain);
        },
      };
      return chain;
    },
  },
}));

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
  await waitFor(() => expect(updates).toContain("board"));

  return { detailKey };
}

describe("MinutesWorkflowEditor cache invalidation", () => {
  it("invalidates the tRPC key the board detail screen reads under", async () => {
    const { detailKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});
