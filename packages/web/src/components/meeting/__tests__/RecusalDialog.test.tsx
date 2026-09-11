/**
 * `RecusalDialog` — its `trpc.voteRecord.pathFilter()` call.
 *
 * Phase E wave 5, Task 4. A recusal is a `vote_record` row; the live screen
 * reads those through `trpc.voteRecord.byMeeting` now, which the two legacy
 * `queryKeys.voteRecords.*` lines this file carried no longer reach.
 * Conventions item 7, pinned per item 8.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain = {
        insert: () => Promise.resolve({ error: null }),
        delete: () => chain,
        eq: () => chain,
        select: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        then: undefined,
      };
      return chain;
    },
  }),
}));

import { RecusalDialog } from "../RecusalDialog";

const queryClient = setupAppQueryClient();

describe("RecusalDialog cache invalidation", () => {
  it("invalidates trpc.voteRecord.pathFilter() when a recusal is recorded against a live motion", async () => {
    const key = trpc.voteRecord.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <RecusalDialog
        open
        onOpenChange={() => {}}
        memberName="Alice Smith"
        boardMemberId="bm-1"
        meetingId="m1"
        townId="town-1"
        agendaItemId="item-1"
        // The invalidation is inside `if (activeMotionId)` — with no active
        // motion there is no `vote_record` row to write and nothing to
        // invalidate, so the pin has to supply one.
        activeMotionId="motion-1"
        onRecusalRecorded={() => {}}
      />,
      { queryClient },
    );

    await user.type(
      screen.getByPlaceholderText(/conflict of interest/i),
      "Applicant is a family member",
    );
    await user.click(screen.getByRole("button", { name: /record recusal/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
