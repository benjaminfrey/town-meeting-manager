/**
 * `PublishAgendaDialog` — its `trpc.meeting.pathFilter()` cache invalidation.
 *
 * Phase E wave 3 Task 2's fix round. This dialog's write itself is still raw
 * Supabase (see the component's own `TODO(phase-e-wave-4)` marker) — this
 * file is not a completeness-gap conversion. It exists only to pin the
 * `trpc.meeting.pathFilter()` line added alongside that write, using a real
 * `QueryClient` (`setupAppQueryClient()`) so the predicate genuinely matches
 * a seeded `trpc.meeting.byBoard` cache entry, the same way
 * `ArchiveBoardDialog.test.tsx` pins a writer whose own read moved to tRPC
 * elsewhere in the file.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain = {
        update: () => chain,
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { PublishAgendaDialog } from "../PublishAgendaDialog";

const queryClient = setupAppQueryClient();

const sections = [
  {
    id: "s1",
    children: [{ id: "i1", title: "Item one", suggested_motion: "to approve" }],
  },
];

describe("PublishAgendaDialog cache invalidation", () => {
  it("invalidates trpc.meeting.pathFilter() — the key boards.$boardId.meetings.tsx reads under", async () => {
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <PublishAgendaDialog meetingId="m1" sections={sections} open onOpenChange={() => {}} />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });
});
