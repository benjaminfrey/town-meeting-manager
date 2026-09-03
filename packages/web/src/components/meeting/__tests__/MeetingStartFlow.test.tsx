/**
 * `MeetingStartFlow` — its `trpc.meeting.pathFilter()` cache invalidation.
 *
 * Phase E wave 3 Task 2's fix round. This component's writes are still raw
 * Supabase (see its own `TODO(phase-e-wave-5)` marker) — this file is not a
 * completeness-gap conversion. It exists only to pin the
 * `trpc.meeting.pathFilter()` line added to `startMeetingMutation`'s
 * `onSuccess`, using a real `QueryClient` (`setupAppQueryClient()`) so the
 * predicate genuinely matches a seeded `trpc.meeting.byBoard` cache entry.
 *
 * The member/attendance fixtures below are the minimum that makes every
 * step's auto-advance logic fire without any attendance-toggle interaction:
 * one present member who is both chair (auto-selects presiding officer) and
 * the default recording secretary (auto-selects that too), and
 * `firstItemId: null` so the mutation's optional agenda_item/transition
 * writes are skipped entirely.
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

import { MeetingStartFlow } from "../MeetingStartFlow";

const queryClient = setupAppQueryClient();

const members = [
  {
    boardMemberId: "bm1",
    personId: "p1",
    name: "Chair Person",
    seatTitle: "Chair",
    isDefaultRecSec: true,
  },
];

const attendance = [
  {
    id: "att1",
    board_member_id: "bm1",
    person_id: "p1",
    status: "present",
    is_recording_secretary: 0,
  },
];

describe("MeetingStartFlow cache invalidation", () => {
  it("invalidates trpc.meeting.pathFilter() — the key boards.$boardId.meetings.tsx reads under", async () => {
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <MeetingStartFlow
        meetingId="m1"
        townId="town-1"
        boardId="b1"
        members={members}
        attendance={attendance}
        quorumRequired={1}
        quorumPresent={1}
        quorumTotal={1}
        hasQuorum
        firstItemId={null}
      />,
      { queryClient },
    );

    // Step through: attendance → quorum → presiding → secretary. Presiding
    // officer and recording secretary are both auto-selected from the
    // fixture above, so no per-step interaction is needed before "Start
    // Meeting" is enabled.
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    const startButton = await screen.findByRole("button", { name: /start meeting/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    await user.click(startButton);

    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });
});
