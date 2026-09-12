/**
 * `AttendancePanel` — its `trpc.meetingAttendance.pathFilter()` invalidation,
 * and its refusal.
 *
 * Phase E wave 5, Task 5. The status cycle is `meetingAttendance.setStatus`
 * now: one `INSERT … ON CONFLICT DO UPDATE` in place of a branch the browser
 * chose between UPDATE and INSERT from its own stale copy of the roster —
 * which is why two clerks taking attendance at once used to collide on
 * `attendance_unique_per_meeting`. The upsert still creates a row for a member
 * who has none, which is the number the meeting shell renders through
 * `trpc.meetingAttendance.countByMeeting`.
 *
 * `meeting_attendance_tenant_isolation` is tenancy-only, so this write was
 * authorized by nothing; it is M2, board-scoped, now, and the second test pins
 * that the refusal reaches a human. It is not behind a confirmation dialog, so
 * there is one reachability path and one `role="alert"` site.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { AttendancePanel } from "../AttendancePanel";

const queryClient = setupAppQueryClient();

const server = { setStatusRefuses: false };

installTRPCFetchStub({
  "meetingAttendance.setStatus": () => {
    if (server.setStatusRefuses) trpcTestError("FORBIDDEN");
    return { id: "att-new" };
  },
});

const members = [
  { boardMemberId: "bm1", personId: "p1", name: "Chair Person", seatTitle: "Chair" },
];

function renderPanel() {
  return renderWithProviders(
    <AttendancePanel
      meetingId="m1"
      boardId="board-1"
      members={members}
      // No record for `bm1` — so the upsert takes its INSERT path, the one
      // that genuinely changes the shell's count.
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
}

describe("AttendancePanel", () => {
  beforeEach(() => {
    server.setStatusRefuses = false;
  });

  it("invalidates trpc.meetingAttendance.pathFilter() when a member's status is cycled", async () => {
    const countKey = trpc.meetingAttendance.countByMeeting.queryOptions({
      meetingId: "m1",
    }).queryKey;
    queryClient.setQueryData(countKey, 0);
    expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();

    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /chair person/i }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("shows a refusal when changing recorded attendance is FORBIDDEN", async () => {
    server.setStatusRefuses = true;
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /chair person/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to change recorded attendance/i);
  });
});
