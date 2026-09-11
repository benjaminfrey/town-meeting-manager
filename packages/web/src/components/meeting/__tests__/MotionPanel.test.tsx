/**
 * `MotionPanel` — its two `trpc.motion.pathFilter()` calls.
 *
 * Phase E wave 5, Task 4. Calling the vote and withdrawing both write
 * `motion.status`, which the live meeting renders from `trpc.motion.byMeeting`
 * as of this task; the `queryKeys.motions.byMeeting` line each handler already
 * carried stopped reaching it. Conventions item 7, pinned per item 8 — one
 * test per call site, because a single test would credit the file for both and
 * leave whichever it did not reach unpinned (item 8's demonstrated per-file
 * credit bleed).
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

import { MotionPanel } from "../MotionPanel";

const queryClient = setupAppQueryClient();

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
      townId="town-1"
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

describe("MotionPanel cache invalidation", () => {
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
});
