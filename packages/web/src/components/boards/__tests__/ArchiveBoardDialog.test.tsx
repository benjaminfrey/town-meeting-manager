/**
 * A writer's cache invalidation is a pinnable behaviour, not a code comment.
 *
 * Phase E, unit 0, task 5. Task 4's review found the hole this file fills: a
 * reviewer deleted `NoticeTemplateEditor`'s
 * `queryClient.invalidateQueries(trpc.board.pathFilter())` line and ran the
 * entire suite — 940 tests, nothing red. Every test that touched those
 * writers mocked `@/lib/trpc` (or `@tanstack/react-query`) wholesale, so the
 * key each one invalidated was invented by the test and matched nothing real.
 *
 * Here the real options proxy and the real QueryClient singleton run. The
 * test seeds the cache under the key `boards.$boardId.tsx` actually reads —
 * `trpc.board.detail.queryOptions({ boardId }).queryKey` — archives the
 * board, and asserts that entry was invalidated. Deleting the `pathFilter()`
 * line from `ArchiveBoardDialog` turns this red.
 *
 * This is the template for pinning the other three writers as their screens
 * migrate; see `docs/superpowers/plans/phase-e-conventions.md`, item 8.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

const { updates } = vi.hoisted(() => ({ updates: [] as string[] }));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
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
  }),
}));

import { ArchiveBoardDialog } from "../ArchiveBoardDialog";

const queryClient = setupAppQueryClient();

const board: RouterOutputs["board"]["detail"] = {
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
};

async function archive() {
  const detailKey = trpc.board.detail.queryOptions({ boardId: board.id }).queryKey;
  const listKey = queryKeys.boards.byTown("town-1");
  queryClient.setQueryData(detailKey, board);
  queryClient.setQueryData(listKey, [board]);
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <ArchiveBoardDialog board={board} townId="town-1" open onOpenChange={() => {}} />,
    { queryClient },
  );

  await user.type(screen.getByPlaceholderText("Select Board"), "Select Board");
  await user.click(screen.getByRole("button", { name: /archive board/i }));
  await waitFor(() => expect(updates).toContain("board_member"));

  return { detailKey, listKey };
}

describe("ArchiveBoardDialog cache invalidation", () => {
  it("invalidates the tRPC key the board detail screen reads under", async () => {
    const { detailKey } = await archive();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });

  it("invalidates the legacy boards-by-town key with the caller's own town id", async () => {
    // Not `board.town_id`: `board.detail` does not select that column, and
    // reading it off the payload is what produced `["boards","byTown",""]`
    // and left an archived board on /boards for a minute. The town id is a
    // required prop for exactly this reason.
    const { listKey } = await archive();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });
});
