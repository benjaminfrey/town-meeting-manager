/**
 * `VotePanel` — its four `pathFilter()` calls, and its refusal.
 *
 * Phase E wave 5, Task 5. "Record Vote" is `voteRecord.recordForMotion` now:
 * one transaction in place of `1 + N + 1` untransacted round trips, with the
 * outcome computed on the server from the votes rather than posted by the
 * browser.
 *
 * **The three conditional invalidations are what this file exists to pin.**
 * `live.tsx` used to watch the motion's new status arrive over the realtime
 * subscription and then write — and invalidate — for itself, on every
 * connected device. The write moved into the procedure; the invalidation moved
 * here, behind the three fields the call returns. Each is a separate `it`,
 * because item 8's per-file credit would let three of the four ride in on the
 * first, and because the branches are genuinely independent: the procedure can
 * report any combination of them.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { VotePanel } from "../VotePanel";

const queryClient = setupAppQueryClient();

const server = {
  refuses: false,
  executiveSession: null as "entered" | "discarded" | null,
  minutesApproved: null as string | null,
  adjourned: false,
};

const stub = installTRPCFetchStub({
  "voteRecord.recordForMotion": ({ motionId, votes }) => {
    if (server.refuses) trpcTestError("FORBIDDEN");
    return {
      motionId,
      status: "passed",
      recorded: votes.length,
      executiveSession: server.executiveSession,
      minutesApproved: server.minutesApproved,
      adjourned: server.adjourned,
    };
  },
});

function renderPanel() {
  return renderWithProviders(
    <VotePanel
      motionId="motion-1"
      meetingId="m1"
      boardId="board-1"
      allMembers={[{ boardMemberId: "bm-1", personId: "p-1", name: "Alice", seatTitle: null }]}
      attendanceRecords={[
        {
          id: "att-1",
          board_member_id: "bm-1",
          person_id: "p-1",
          status: "present",
          arrived_at: null,
          departed_at: null,
          is_recording_secretary: false,
        },
      ]}
      existingVotes={[]}
      boardQuorumConfig={{ quorumType: "simple_majority", quorumValue: null, memberCount: 1 }}
      memberNameMap={new Map([["bm-1", "Alice"]])}
      onComplete={() => {}}
    />,
    { queryClient },
  );
}

/** Vote the one eligible member and press Record Vote. */
async function recordVote(user: ReturnType<typeof renderPanel>["user"]) {
  // "Record Vote" is disabled until every eligible member has voted; there
  // is exactly one.
  await user.click(screen.getByRole("button", { name: /^yea$/i }));
  await user.click(screen.getByRole("button", { name: /record vote/i }));
}

/** Seed a read a writer is expected to invalidate, and assert it starts clean. */
function seed(key: readonly unknown[], value: unknown) {
  queryClient.setQueryData(key, value);
  expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  return key;
}

describe("VotePanel", () => {
  beforeEach(() => {
    server.refuses = false;
    server.executiveSession = null;
    server.minutesApproved = null;
    server.adjourned = false;
  });

  it("invalidates BOTH trpc.voteRecord.pathFilter() and trpc.motion.pathFilter() when a vote is recorded", async () => {
    const voteKey = seed(trpc.voteRecord.byMeeting.queryOptions({ meetingId: "m1" }).queryKey, []);
    const motionKey = seed(trpc.motion.byMeeting.queryOptions({ meetingId: "m1" }).queryKey, []);

    const { user } = renderPanel();
    await recordVote(user);

    await waitFor(() => {
      expect(queryClient.getQueryState(voteKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(motionKey)?.isInvalidated).toBe(true);
    });
    expect(stub.countFor("voteRecord.recordForMotion")).toBe(1);
  });

  it("invalidates trpc.executiveSession.pathFilter() when the call reports the board entered closed session", async () => {
    server.executiveSession = "entered";
    const key = seed(
      trpc.executiveSession.byMeeting.queryOptions({ meetingId: "m1" }).queryKey,
      [],
    );

    const { user } = renderPanel();
    await recordVote(user);

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.minutesDocument.pathFilter() when the call reports minutes approved", async () => {
    server.minutesApproved = "doc-1";
    const key = seed(
      trpc.minutesDocument.byMeeting.queryOptions({ meetingId: "earlier-meeting" }).queryKey,
      null,
    );

    const { user } = renderPanel();
    await recordVote(user);

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates all THREE routers the adjournment touches when the call reports it", async () => {
    server.adjourned = true;
    // Three separate `pathFilter()` lines in one branch: a test asserting only
    // the first would let the other two be deleted silently (item 8's per-file
    // credit bleed, one level down — the branch's own credit bleed).
    const meetingKey = seed(trpc.meeting.byBoard.queryOptions({ boardId: "board-1" }).queryKey, []);
    const itemKey = seed(
      trpc.agendaItem.countByMeeting.queryOptions({ meetingId: "m1" }).queryKey,
      3,
    );
    const transitionKey = seed(
      trpc.agendaItemTransition.byMeeting.queryOptions({ meetingId: "m1" }).queryKey,
      [],
    );

    const { user } = renderPanel();
    await recordVote(user);

    await waitFor(() => expect(queryClient.getQueryState(meetingKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(itemKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(transitionKey)?.isInvalidated).toBe(true);
  });

  it("shows a refusal when recording the vote is FORBIDDEN", async () => {
    server.refuses = true;
    const { user } = renderPanel();
    await recordVote(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to record the votes on this motion/i);
  });
});
