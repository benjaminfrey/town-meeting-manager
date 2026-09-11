/**
 * `VotePanel` — its `trpc.voteRecord.pathFilter()` and `trpc.motion.pathFilter()`
 * calls.
 *
 * Phase E wave 5, Task 4. Recording a vote is THREE writes in one handler: it
 * deletes every `vote_record` on the motion, re-inserts them, and stamps the
 * motion's `status`/`vote_summary`. Both tables' reads moved to tRPC in this
 * task (`trpc.voteRecord.byMeeting`, `trpc.motion.byMeeting`), so the three
 * legacy keys this handler already carried reach neither.
 *
 * Two separate assertions in one act, deliberately: the two `pathFilter()`
 * lines sit in the same `onSuccess`, so a test asserting only one of them
 * would let the other be deleted silently.
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
        update: () => chain,
        delete: () => chain,
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { VotePanel } from "../VotePanel";

const queryClient = setupAppQueryClient();

describe("VotePanel cache invalidation", () => {
  it("invalidates BOTH trpc.voteRecord.pathFilter() and trpc.motion.pathFilter() when a vote is recorded", async () => {
    const voteKey = trpc.voteRecord.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    const motionKey = trpc.motion.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(voteKey, []);
    queryClient.setQueryData(motionKey, []);
    expect(queryClient.getQueryState(voteKey)?.isInvalidated).toBeFalsy();
    expect(queryClient.getQueryState(motionKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <VotePanel
        motionId="motion-1"
        meetingId="m1"
        townId="town-1"
        allMembers={[{ boardMemberId: "bm-1", personId: "p-1", name: "Alice", seatTitle: null }]}
        attendanceRecords={[
          {
            id: "att-1",
            board_member_id: "bm-1",
            person_id: "p-1",
            status: "present",
          },
        ]}
        existingVotes={[]}
        boardQuorumConfig={{ quorumType: "simple_majority", quorumValue: null, memberCount: 1 }}
        memberNameMap={new Map([["bm-1", "Alice"]])}
        onComplete={() => {}}
      />,
      { queryClient },
    );

    // "Record Vote" is disabled until every eligible member has voted; there
    // is exactly one.
    await user.click(screen.getByRole("button", { name: /^yea$/i }));
    await user.click(screen.getByRole("button", { name: /record vote/i }));

    await waitFor(() => {
      expect(queryClient.getQueryState(voteKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(motionKey)?.isInvalidated).toBe(true);
    });
  });
});
