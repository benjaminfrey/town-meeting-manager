/**
 * `MeetingStartFlow` — its `pathFilter()` cache invalidations.
 *
 * Phase E wave 3 Task 2's fix round, extended in Tasks 3+4's and again in wave
 * 5, Task 5, which moved both writes onto tRPC (`meetingAttendance.setRollCall`
 * and `meeting.callToOrder`) and closed the call-to-order authorization hole
 * with them. It pins the `pathFilter()` lines its two mutations carry —
 * `trpc.meeting`, `trpc.meetingAttendance` and `trpc.agendaItem` — using a
 * real `QueryClient` (`setupAppQueryClient()`) so each predicate genuinely
 * matches a seeded cache entry rather than a hand-built key.
 *
 * The member/attendance fixtures below are the minimum that makes every
 * step's auto-advance logic fire without any attendance-toggle interaction:
 * one present member who is both chair (auto-selects presiding officer) and
 * the default recording secretary (auto-selects that too), and
 * `firstItemId: null` so the mutation's optional agenda_item/transition
 * writes are skipped entirely — with ONE exception, added in wave 5, Task 4:
 * the `agendaItemTransition` pin has to pass a real `firstItemId`, because
 * that is the only branch in which a transition row is written at all.
 *
 * **`firstItemId: null` no longer skips a client-side branch** — the four
 * writes are one transaction now, and the procedure decides for itself whether
 * an agenda item and a transition row are part of it. The fixture keeps the
 * distinction anyway, because the two cases still exercise two different
 * request bodies.
 *
 * The last two tests are the refusal surfaces, one per write: calling a
 * meeting to order and recording roll-call attendance are separate procedures
 * with separate guards (`assertCanUpdateMeeting` and M2), reached from
 * separate controls, so a single refusal test would leave one of them unpinned.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { MeetingStartFlow } from "../MeetingStartFlow";

const queryClient = setupAppQueryClient();

const server = { callToOrderRefuses: false, rollCallRefuses: false };

installTRPCFetchStub({
  "meeting.callToOrder": ({ meetingId }) => {
    if (server.callToOrderRefuses) trpcTestError("FORBIDDEN");
    return { id: meetingId, alreadyOpen: false as const };
  },
  "meetingAttendance.setRollCall": () => {
    if (server.rollCallRefuses) trpcTestError("FORBIDDEN");
    return { id: "att-new" };
  },
});

const members = [
  {
    boardMemberId: "bm1",
    personId: "p1",
    name: "Chair Person",
    seatTitle: "Chair",
    isDefaultRecSec: true,
  },
];

/**
 * `satisfies` rather than a bare literal (conventions item 8's "the floor"):
 * this fixture stands in for `meetingAttendance.byMeeting`'s output, and the
 * prop now takes that procedure's real type, so a column the procedure gains
 * or loses shows up here at `tsc` time. `is_recording_secretary` was `0` in
 * this fixture and the prop was typed `number`; the column is `boolean`.
 */
const attendance = [
  {
    id: "att1",
    board_member_id: "bm1",
    person_id: "p1",
    status: "present",
    is_recording_secretary: false,
    arrived_at: null,
    departed_at: null,
  },
] satisfies RouterOutputs["meetingAttendance"]["byMeeting"];

describe("MeetingStartFlow cache invalidation", () => {
  beforeEach(() => {
    server.callToOrderRefuses = false;
    server.rollCallRefuses = false;
  });

  it("invalidates trpc.meeting.pathFilter() — the key boards.$boardId.meetings.tsx reads under", async () => {
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <MeetingStartFlow
        meetingId="m1"
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

  it("invalidates trpc.agendaItemTransition.pathFilter() on start — wave 5, Task 4", async () => {
    // `startMeetingMutation` also opens the meeting's FIRST
    // `agenda_item_transition` row, and the live screen reads those through
    // `trpc.agendaItemTransition.byMeeting` as of wave 5, Task 4 — a fourth
    // `pathFilter()` line in the same handler, pinned on its own.
    const transitionKey = trpc.agendaItemTransition.byMeeting.queryOptions({
      meetingId: "m1",
    }).queryKey;
    queryClient.setQueryData(transitionKey, []);
    expect(queryClient.getQueryState(transitionKey)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <MeetingStartFlow
        meetingId="m1"
        boardId="b1"
        members={members}
        attendance={attendance}
        quorumRequired={1}
        quorumPresent={1}
        quorumTotal={1}
        hasQuorum
        firstItemId="item-1"
      />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    const startButton = await screen.findByRole("button", { name: /start meeting/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    await user.click(startButton);

    await waitFor(() => expect(queryClient.getQueryState(transitionKey)?.isInvalidated).toBe(true));
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

  it("shows a refusal when calling the meeting to order is FORBIDDEN", async () => {
    server.callToOrderRefuses = true;
    const { user } = renderWithProviders(
      <MeetingStartFlow
        meetingId="m1"
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to call this meeting to order/i);
  });

  it("shows a refusal when recording roll-call attendance is FORBIDDEN — the OTHER write", async () => {
    server.rollCallRefuses = true;
    const { user } = renderWithProviders(
      <MeetingStartFlow
        meetingId="m1"
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to record attendance/i);
  });
});
