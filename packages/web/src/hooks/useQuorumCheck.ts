/**
 * Reactive quorum check hook for live meetings.
 *
 * Queries the board's quorum configuration and meeting attendance,
 * then calculates whether quorum is met. Recalculates automatically
 * whenever attendance records change via PowerSync reactivity.
 */

import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { calculateQuorum } from "@town-meeting/shared";
import type { QuorumType } from "@town-meeting/shared/constants/enums";

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
  const { data: boardRows } = useQuery(
    "SELECT quorum_type, quorum_value, member_count FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );

  const { data: memberRows } = useQuery(
    "SELECT id FROM board_members WHERE board_id = ? AND status = 'active'",
    [boardId],
  );

  const { data: attendanceRows } = useQuery(
    "SELECT id, board_member_id, status FROM meeting_attendance WHERE meeting_id = ?",
    [meetingId],
  );

  const quorum = useMemo(() => {
    const board = boardRows?.[0] as Record<string, unknown> | undefined;
    if (!board) return null;

    const totalSeats = memberRows?.length ?? 0;
    const presentCount = (attendanceRows ?? []).filter((a: Record<string, unknown>) => {
      const s = a.status as string;
      return s === "present" || s === "remote" || s === "late_arrival";
    }).length;

    const required = calculateQuorum(
      totalSeats,
      (board.quorum_type as QuorumType) ?? undefined,
      (board.quorum_value as number) ?? undefined,
    );

    return {
      required,
      present: presentCount,
      total: totalSeats,
      hasQuorum: presentCount >= required,
    };
  }, [boardRows, memberRows, attendanceRows]);

  return {
    quorum,
    isLoading: !boardRows || boardRows.length === 0,
  };
}
