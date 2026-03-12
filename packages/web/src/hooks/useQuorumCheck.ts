/**
 * Reactive quorum check hook for live meetings.
 *
 * Queries the board's quorum configuration and meeting attendance via
 * Supabase, then calculates whether quorum is met. Used alongside
 * Realtime subscriptions for live attendance updates.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
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
  const supabase = useSupabase();

  const { data: board, isLoading: boardLoading } = useQuery({
    queryKey: queryKeys.boards.detail(boardId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("board")
        .select("id, quorum_type, quorum_value, member_count")
        .eq("id", boardId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!boardId,
  });

  const { data: activeMembers, isLoading: membersLoading } = useQuery({
    queryKey: queryKeys.members.byBoard(boardId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("board_member")
        .select("id")
        .eq("board_id", boardId)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!boardId,
  });

  const { data: attendance, isLoading: attendanceLoading } = useQuery({
    queryKey: queryKeys.attendance.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_attendance")
        .select("id, board_member_id, status")
        .eq("meeting_id", meetingId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!meetingId,
    // In the live meeting context this hook is used alongside Realtime subscriptions.
    // Add a fallback polling interval in case Realtime is slow to deliver updates.
    refetchInterval: 10_000,
  });

  const isLoading = boardLoading || membersLoading || attendanceLoading;

  const quorum = useMemo(() => {
    if (!board) return null;

    const totalSeats = activeMembers?.length ?? 0;
    const presentCount = (attendance ?? []).filter((a) => {
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
  }, [board, activeMembers, attendance]);

  return {
    quorum,
    isLoading,
  };
}
