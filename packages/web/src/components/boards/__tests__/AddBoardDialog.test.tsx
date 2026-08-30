/**
 * `AddBoardDialog`'s cache invalidation.
 *
 * Review finding on Task 5 of Phase E, wave 1: `ProgressChecklist` moved its
 * `totalSeats` and notice-template-count reads onto `trpc.board.list` (that
 * task), but nothing checked whether every WRITER of the key those reads
 * abandoned (`queryKeys.boards.byTown`) had picked up the new one — see
 * conventions item 7's "a read owns its key" rule and item 8's "pin the
 * writers, not just the readers". `AddBoardDialog` was the one board writer
 * without `trpc.board.pathFilter()` (`EditBoardDialog`, `ArchiveBoardDialog`
 * and `NoticeTemplateEditor` all had it already) — proven by a reviewer:
 * invalidating `queryKeys.boards.byTown` does not reach `trpc.board.list`'s
 * cache entry, so creating a board left the checklist's seat total and
 * board-configured denominator stale for up to the 60s `staleTime`.
 *
 * Same shape as `EditBoardDialog.test.tsx`: the real options proxy and the
 * real `QueryClient` singleton run, Supabase mocked only at
 * `@/hooks/useSupabase`. Deleting `AddBoardDialog`'s `pathFilter()` line
 * turns this red.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const { inserts } = vi.hoisted(() => ({ inserts: [] as string[] }));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: (table: string) => ({
      insert: () => {
        inserts.push(table);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
}));

import { AddBoardDialog } from "../AddBoardDialog";

const queryClient = setupAppQueryClient();

const boardListRow: RouterOutputs["board"]["list"][number] = {
  id: "b1",
  name: "Existing Board",
  notice_template_blocks: null,
  member_count: 3,
};

async function create() {
  const listKey = trpc.board.list.queryOptions().queryKey;
  queryClient.setQueryData(listKey, [boardListRow]);
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <AddBoardDialog townId="town-1" town={undefined} open onOpenChange={() => {}} />,
    { queryClient },
  );

  const nameInput = await screen.findByPlaceholderText("e.g. Planning Board");
  await user.type(nameInput, "Zoning Board");
  await user.tab();

  const createButton = await screen.findByRole("button", { name: /create board/i });
  await waitFor(() => expect(createButton).not.toBeDisabled());
  await user.click(createButton);
  await waitFor(() => expect(inserts).toContain("board"));

  return { listKey };
}

describe("AddBoardDialog cache invalidation", () => {
  it("invalidates trpc.board.pathFilter() — the key ProgressChecklist's totalSeats/template counts read under", async () => {
    const { listKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });
});
