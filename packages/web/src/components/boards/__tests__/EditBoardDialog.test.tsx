/**
 * A writer's cache invalidation is a pinnable behaviour, not a code comment.
 *
 * Phase E, unit 0 final-fix pass. `EditBoardDialog` was one of the three
 * writers `docs/superpowers/plans/phase-e-conventions.md` item 8 named as
 * having a `trpc.board.pathFilter()` invalidation call with no test pinning
 * it — a reviewer confirmed deleting that line stays green across all 947
 * tests. This is that pin.
 *
 * Same shape as `ArchiveBoardDialog.test.tsx`: the real options proxy and the
 * real QueryClient singleton run, the test seeds the cache under the key
 * `boards.$boardId.tsx` actually reads — `trpc.board.detail.queryOptions({
 * boardId }).queryKey` — saves the edit, and asserts that entry was
 * invalidated. Deleting the `pathFilter()` line from `EditBoardDialog` turns
 * this red.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const { updates } = vi.hoisted(() => ({ updates: [] as string[] }));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        update: () => chain,
        eq: () => {
          updates.push(table);
          return Object.assign(Promise.resolve({ data: null, count: 0, error: null }), chain);
        },
      };
      return chain;
    },
  }),
}));

import { EditBoardDialog } from "../EditBoardDialog";

const queryClient = setupAppQueryClient();

const board: RouterOutputs["board"]["detail"] = {
  id: "b1",
  name: "Select Board",
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
  const detailKey = trpc.board.detail.queryOptions({ boardId: board.id }).queryKey;
  queryClient.setQueryData(detailKey, board);
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <EditBoardDialog townId="town-1" town={{}} board={board} open onOpenChange={() => {}} />,
    { queryClient },
  );

  // Every initial value already satisfies the schema; a blur on the
  // unchanged name field is enough to trigger react-hook-form's
  // whole-schema resolver validation and flip `isValid`, which is what
  // enables the Save Changes button.
  await user.click(screen.getByDisplayValue("Select Board"));
  await user.tab();

  const saveButton = await screen.findByRole("button", { name: /save changes/i });
  await waitFor(() => expect(saveButton).not.toBeDisabled());
  await user.click(saveButton);
  await waitFor(() => expect(updates).toContain("board"));

  return { detailKey };
}

describe("EditBoardDialog cache invalidation", () => {
  it("invalidates the tRPC key the board detail screen reads under", async () => {
    const { detailKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});
