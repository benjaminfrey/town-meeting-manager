/**
 * `AttendancePanel` — its `trpc.meetingAttendance.pathFilter()` invalidation.
 *
 * Phase E wave 3, Tasks 3+4 fix round. Task 3 moved
 * `routes/meetings.$meetingId.tsx`'s "N members recorded" summary onto
 * `trpc.meetingAttendance.countByMeeting`, which left this component — still
 * a raw Supabase writer, see its `cycleStatusMutation` — invalidating only
 * the abandoned `queryKeys.attendance.byMeeting` key. Its `else` branch
 * INSERTs a `meeting_attendance` row for a member who has none, so it moves
 * exactly the number that shell renders.
 *
 * Real `QueryClient` (`setupAppQueryClient()`), real `@/lib/trpc` proxy —
 * only `@/hooks/useSupabase` is mocked, per conventions item 8's writer-pin
 * template (`ArchiveBoardDialog.test.tsx`).
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
        insert: () => Promise.resolve({ error: null }),
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { AttendancePanel } from "../AttendancePanel";

const queryClient = setupAppQueryClient();

const members = [
  { boardMemberId: "bm1", personId: "p1", name: "Chair Person", seatTitle: "Chair" },
];

describe("AttendancePanel cache invalidation", () => {
  it("invalidates trpc.meetingAttendance.pathFilter() when a member's status is cycled", async () => {
    const countKey = trpc.meetingAttendance.countByMeeting.queryOptions({
      meetingId: "m1",
    }).queryKey;
    queryClient.setQueryData(countKey, 0);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <AttendancePanel
        meetingId="m1"
        townId="town-1"
        members={members}
        // No record for `bm1` — so the mutation takes its INSERT branch,
        // the one that genuinely changes the shell's count.
        attendance={[]}
        presidingOfficerId={null}
        recordingSecretaryId={null}
        quorumRequired={1}
        quorumPresent={0}
        quorumTotal={1}
        hasQuorum={false}
        meetingStartedAt={null}
        currentItemStartedAt={null}
        currentItemEstimatedDuration={null}
      />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: /chair person/i }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });
});
