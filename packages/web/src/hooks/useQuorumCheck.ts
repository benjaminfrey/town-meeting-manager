/**
 * Reactive quorum check hook for live meetings.
 *
 * Reads the board's quorum configuration, its active seat count and the
 * meeting's attendance, and computes whether quorum is met.
 *
 * Phase E, wave 5, Task 4 — migrated off `@/lib/supabase` onto tRPC. The three
 * queries this replaces, as specifications (conventions item 1):
 *
 *   1. `board.select("id, quorum_type, quorum_value, member_count").eq("id", boardId).single()`
 *      → `trpc.board.detail`, which selects all three plus seventeen more. A
 *      WIDER row than this hook needs, and deliberately not a narrower new
 *      procedure: `board.detail` is the board read the whole app already
 *      shares, so a second one would be a second cache entry over the same row
 *      that a board edit would have to invalidate twice.
 *   2. `board_member.select("id").eq("board_id", boardId).eq("status", "active")`,
 *      read for `.length` alone → `trpc.boardMember.activeCountForBoard`,
 *      which is that same pair of filters counted server-side. The rows were
 *      never used for anything else here.
 *   3. `meeting_attendance.select("id, board_member_id, status").eq("meeting_id", meetingId)`
 *      → `trpc.meetingAttendance.byMeeting`, same filter, no ordering either
 *      side. It selects four columns this hook ignores
 *      (`person_id`, `is_recording_secretary`, `arrived_at`, `departed_at`)
 *      because `AttendancePanel` and `MeetingStartFlow` read them off the same
 *      procedure.
 *
 * **`refetchInterval: 10_000` is GONE, and that is the one deliberate
 * behaviour change here.** It was a fallback for Supabase Realtime being slow
 * to deliver an attendance change, added when this hook's only freshness
 * signal was a channel it did not own. The live screen now holds a single SSE
 * subscription (`hooks/useLiveMeetingEvents.ts`) whose `meeting_attendance`
 * topic invalidates `trpc.meetingAttendance.pathFilter()` — the very key this
 * hook reads — and every attendance write publishes that topic from inside its
 * own transaction (`realtime/events.ts`). Polling a fourth time per minute on
 * top of that is a request per ten seconds per connected device for an event
 * the stream already delivers. Stated rather than dropped silently, because a
 * dropped poll is exactly the kind of removal that looks like an oversight.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { calculateQuorum, type QuorumType } from "@town-meeting/shared";

export interface QuorumCheckResult {
  required: number;
  present: number;
  total: number;
  hasQuorum: boolean;
}

export function useQuorumCheck(
  meetingId: string,
  boardId: string,
): {
  quorum: QuorumCheckResult | null;
  isLoading: boolean;
} {
  const { data: board, isLoading: boardLoading } = useQuery({
    ...trpc.board.detail.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  const { data: activeSeats, isLoading: seatsLoading } = useQuery({
    ...trpc.boardMember.activeCountForBoard.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  const { data: attendance, isLoading: attendanceLoading } = useQuery({
    ...trpc.meetingAttendance.byMeeting.queryOptions({ meetingId }),
    enabled: !!meetingId,
  });

  const isLoading = boardLoading || seatsLoading || attendanceLoading;

  const quorum = useMemo(() => {
    if (!board) return null;

    const totalSeats = activeSeats ?? 0;
    const presentCount = (attendance ?? []).filter(
      (a) => a.status === "present" || a.status === "remote" || a.status === "late_arrival",
    ).length;

    const required = calculateQuorum(
      totalSeats,
      (board.quorum_type as QuorumType) ?? undefined,
      board.quorum_value ?? undefined,
    );

    return {
      required,
      present: presentCount,
      total: totalSeats,
      hasQuorum: presentCount >= required,
    };
  }, [board, activeSeats, attendance]);

  return {
    quorum,
    isLoading,
  };
}
