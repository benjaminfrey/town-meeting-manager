/**
 * `MeetingStartFlow` — its `pathFilter()` cache invalidations.
 *
 * Phase E wave 3 Task 2's fix round, extended in Tasks 3+4's. This
 * component's writes are still raw Supabase (see its own
 * `TODO(phase-e-wave-5)` marker) — this file is not a completeness-gap
 * conversion. It pins the `pathFilter()` lines its two mutations carry —
 * `trpc.meeting`, `trpc.meetingAttendance` and `trpc.agendaItem` — using a
 * real `QueryClient` (`setupAppQueryClient()`) so each predicate genuinely
 * matches a seeded cache entry rather than a hand-built key.
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

  // ─── Wave 3, Tasks 3+4 fix round ──────────────────────────────────
  //
  // `startMeetingMutation` also flips the recording secretary's
  // `meeting_attendance` row and the first `agenda_item` to `active`, and
  // `toggleAttendanceMutation` INSERTs a `meeting_attendance` row for a
  // member who has none — all three tables
  // `routes/meetings.$meetingId.tsx`'s shell now reads through tRPC. Each
  // `pathFilter()` line gets its own assertion so deleting any one of them
  // is caught (conventions items 7, 8 and 13).

  it("invalidates trpc.agendaItem.pathFilter() and trpc.meetingAttendance.pathFilter() on start", async () => {
    const agendaKey = trpc.agendaItem.countByMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    const attendanceKey = trpc.meetingAttendance.countByMeeting.queryOptions({
      meetingId: "m1",
    }).queryKey;
    queryClient.setQueryData(agendaKey, 4);
    queryClient.setQueryData(attendanceKey, 1);
    expect(queryClient.getQueryState(agendaKey)?.isInvalidated).toBeFalsy();
    expect(queryClient.getQueryState(attendanceKey)?.isInvalidated).toBeFalsy();

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

    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    const startButton = await screen.findByRole("button", { name: /start meeting/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    await user.click(startButton);

    await waitFor(() => expect(queryClient.getQueryState(agendaKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(attendanceKey)?.isInvalidated).toBe(true);
  });

  it("invalidates trpc.meetingAttendance.pathFilter() when a member is toggled — the OTHER call site", async () => {
    // `toggleAttendanceMutation` is reached from the attendance step's own
    // member rows, before any of the Continue clicks above — a separate
    // `pathFilter()` line from `startMeetingMutation`'s.
    const attendanceKey = trpc.meetingAttendance.countByMeeting.queryOptions({
      meetingId: "m1",
    }).queryKey;
    queryClient.setQueryData(attendanceKey, 1);
    expect(queryClient.getQueryState(attendanceKey)?.isInvalidated).toBeFalsy();

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

    await user.click(screen.getByRole("button", { name: /chair person/i }));

    await waitFor(() => expect(queryClient.getQueryState(attendanceKey)?.isInvalidated).toBe(true));
  });
});
