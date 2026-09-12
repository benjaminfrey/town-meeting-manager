/**
 * `MotionPanel` — its two `trpc.motion.pathFilter()` calls, and its two
 * refusals.
 *
 * Phase E wave 5, Task 5. Both controls are tRPC now (`motion.callVote`,
 * `motion.withdraw`), and both **start working**: each raw update sent
 * `updated_at`, a column `motion` does not have, so PostgREST rejected the
 * body and neither button did anything — silently, since neither mutation had
 * an `onError`.
 *
 * **Two refusal tests, one per reachability path** (conventions item 2, wave 4
 * Task 3's fix round). "Call the Vote" fires straight from the card and its
 * message renders there; "Withdraw" goes through an `AlertDialog` that STAYS
 * OPEN on a refusal, `aria-hidden`ing everything outside itself, so its message
 * renders inside the dialog. A single test written against whichever path was
 * convenient would leave the other `role="alert"` site unpinned while the
 * file's raw site count still matched its assertion count — the exact shape
 * that hid an unpinned site in `AgendaSection.tsx`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { MotionPanel } from "../MotionPanel";

const queryClient = setupAppQueryClient();

const server = { callVoteRefuses: false, withdrawRefuses: false };

installTRPCFetchStub({
  "motion.callVote": ({ motionId }) => {
    if (server.callVoteRefuses) trpcTestError("FORBIDDEN");
    return { id: motionId };
  },
  "motion.withdraw": ({ motionId }) => {
    if (server.withdrawRefuses) trpcTestError("FORBIDDEN");
    return { id: motionId };
  },
});

const motion = {
  id: "motion-1",
  motionText: "to approve the site plan",
  motionType: "main",
  movedBy: "bm-1",
  secondedBy: "bm-2",
  status: "seconded",
  parentMotionId: null,
  voteSummary: null,
};

function seedMotionRead() {
  const key = trpc.motion.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(key, []);
  expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  return key;
}

function renderPanel() {
  return renderWithProviders(
    <MotionPanel
      motions={[motion]}
      votesByMotion={new Map()}
      memberNameMap={new Map([["bm-1", "Alice"]])}
      motionDisplayFormat="inline_narrative"
      meetingId="m1"
      boardId="board-1"
      agendaItemId="item-1"
      allMembers={[]}
      presentMembers={[]}
      attendanceRecords={[]}
      boardQuorumConfig={{ quorumType: "simple_majority", quorumValue: null, memberCount: 3 }}
      quorumBlocked={false}
    />,
    { queryClient },
  );
}

describe("MotionPanel", () => {
  beforeEach(() => {
    server.callVoteRefuses = false;
    server.withdrawRefuses = false;
  });

  it("invalidates trpc.motion.pathFilter() when the vote is called", async () => {
    const key = seedMotionRead();
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /call the vote/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.motion.pathFilter() when a motion is withdrawn — the OTHER call site", async () => {
    const key = seedMotionRead();
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /^withdraw$/i }));
    await user.click(screen.getByRole("button", { name: /confirm withdrawal/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("shows a refusal beside the motion when calling the vote is FORBIDDEN", async () => {
    server.callVoteRefuses = true;
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /call the vote/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to call a vote on this motion/i);
  });

  it("shows a refusal INSIDE the confirmation dialog when a withdrawal is FORBIDDEN", async () => {
    server.withdrawRefuses = true;
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /^withdraw$/i }));
    await user.click(screen.getByRole("button", { name: /confirm withdrawal/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to withdraw this motion/i);
    // Inside the dialog, which a refusal leaves open — everything outside it
    // is `aria-hidden`, so a message on the card behind would be unreadable.
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("alert")).toBe(alert);
  });
});
