/**
 * Vote Panel — per-member vote recording for a motion.
 *
 * Shows each board member with Yea/Nay/Abstain buttons. Absent members
 * are auto-filled and grayed. Recused members show reason and are not
 * clickable.
 *
 * ─── Phase E, wave 5, Task 5: one call, and everything that follows from it ─
 *
 * "Record Vote" was `1 + N + 1` untransacted Supabase round trips — delete
 * every vote on the motion, insert the roll one member at a time, stamp the
 * motion — so a failure at member four left a motion with three votes, no
 * outcome, and the previous roll already destroyed. It is
 * `voteRecord.recordForMotion` now: one transaction, and the OUTCOME is
 * computed on the server from the votes rather than posted by the browser (a
 * client that sent its own `status` could declare a motion carried; see that
 * procedure's header). `calculateVoteResult` stays here for the live tally
 * the operator watches while voting, which is a preview and not a record.
 *
 * **And the consequences of the motion passing are the server's too.** Four
 * `useEffect`s in `routes/meetings.$meetingId.live.tsx` used to watch for this
 * write's result arriving back over the realtime subscription and then act on
 * it — on every connected device at once. They are inside this one transaction
 * now, and the three fields the call returns (`executiveSession`,
 * `minutesApproved`, `adjourned`) are how the ONE caller that performed it
 * learns what else happened, so it can invalidate the right caches and say the
 * right thing. Every other device learns the same facts from the SSE topics
 * the procedure publishes.
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage, type RouterOutputs } from "@/lib/trpc";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  calculateVoteResult,
  formatVoteCompact,
  type VoteEntry,
  type VoteResult,
} from "@/hooks/useVoteCalculation";

// ─── Types ──────────────────────────────────────────────────────────

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle?: string | null;
}

/**
 * One `meeting_attendance` row and one `vote_record` row, as the procedures
 * return them — conventions item 10, applied in Phase E wave 5, Task 5 to the
 * last two components in the live-meeting tree still restating them by hand.
 * Task 4 retyped `AttendancePanel`, `MeetingStartFlow` and
 * `AgendaItemDetailPanel`; these two received the same payloads through a
 * narrower hand-written interface, which structural typing accepted silently
 * and which is exactly how a column the procedure stops selecting becomes a
 * runtime `undefined` instead of a compile error.
 */
type AttendanceRecord = RouterOutputs["meetingAttendance"]["byMeeting"][number];

type VoteRecordData = RouterOutputs["voteRecord"]["byMeeting"][number];

interface BoardQuorumConfig {
  quorumType: string | null;
  quorumValue: number | null;
  memberCount: number;
}

interface VotePanelProps {
  motionId: string;
  meetingId: string;
  /**
   * The board this meeting belongs to — `voteRecord.recordForMotion` is
   * guarded by `requireBoardPermission("M3", boardIdFrom())`, declared before
   * `.input()`. Conventions item 2's named cost.
   */
  boardId: string;
  allMembers: MemberInfo[];
  attendanceRecords: AttendanceRecord[];
  existingVotes: VoteRecordData[];
  boardQuorumConfig: BoardQuorumConfig;
  memberNameMap: Map<string, string>;
  onComplete: () => void;
}

// ─── Component ──────────────────────────────────────────────────────

export function VotePanel({
  motionId,
  meetingId,
  boardId,
  allMembers,
  attendanceRecords,
  existingVotes,
  boardQuorumConfig,
  memberNameMap,
  onComplete,
}: VotePanelProps) {
  const queryClient = useQueryClient();

  // Build attendance status map
  const attendanceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of attendanceRecords) {
      if (a.board_member_id) {
        map.set(a.board_member_id, a.status);
      }
    }
    return map;
  }, [attendanceRecords]);

  // Build existing recusals (from existing vote_records with vote='recusal')
  const recusalMap = useMemo(() => {
    const map = new Map<string, string>(); // boardMemberId → reason
    for (const v of existingVotes) {
      if (v.vote === "recusal") {
        map.set(v.board_member_id, v.recusal_reason ?? "");
      }
    }
    return map;
  }, [existingVotes]);

  // Determine each member's voting status
  const memberVoteStatus = useMemo(() => {
    return allMembers
      .map((m) => {
        const attendance = attendanceMap.get(m.boardMemberId) ?? "absent";
        const isPresent =
          attendance === "present" || attendance === "remote" || attendance === "late_arrival";
        const isRecused = recusalMap.has(m.boardMemberId);

        return {
          ...m,
          attendance,
          isPresent,
          isRecused,
          recusalReason: recusalMap.get(m.boardMemberId) ?? null,
          canVote: isPresent && !isRecused,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allMembers, attendanceMap, recusalMap]);

  // Vote state — Map<boardMemberId, "yes"|"no"|"abstain">
  const [votes, setVotes] = useState<Map<string, string>>(() => {
    const initial = new Map<string, string>();
    // Pre-fill from existing votes (if re-opening a vote panel)
    for (const v of existingVotes) {
      if (v.vote !== "recusal" && v.vote !== "absent") {
        initial.set(v.board_member_id, v.vote);
      }
    }
    return initial;
  });

  const setVote = (boardMemberId: string, vote: string) => {
    setVotes((prev) => {
      const next = new Map(prev);
      next.set(boardMemberId, vote);
      return next;
    });
  };

  // ─── Tally ────────────────────────────────────────────────────

  const allVoteEntries: VoteEntry[] = useMemo(() => {
    return memberVoteStatus.map((m) => {
      if (!m.isPresent) return { boardMemberId: m.boardMemberId, vote: "absent" };
      if (m.isRecused)
        return {
          boardMemberId: m.boardMemberId,
          vote: "recusal",
          recusalReason: m.recusalReason,
        };
      return {
        boardMemberId: m.boardMemberId,
        vote: votes.get(m.boardMemberId) ?? "",
      };
    });
  }, [memberVoteStatus, votes]);

  const tally: VoteResult = useMemo(() => {
    const filled = allVoteEntries.filter((v) => v.vote !== "");
    return calculateVoteResult(filled);
  }, [allVoteEntries]);

  // Check if all eligible members have voted
  const eligibleCount = memberVoteStatus.filter((m) => m.canVote).length;
  const votedCount = memberVoteStatus.filter((m) => m.canVote && votes.has(m.boardMemberId)).length;
  const allVoted = votedCount === eligibleCount && eligibleCount > 0;

  // ─── Record Vote ──────────────────────────────────────────────

  const recordVoteMutation = useMutation(
    trpc.voteRecord.recordForMotion.mutationOptions({
      onSuccess: (data) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.voteRecords.byMotion(motionId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.voteRecords.byMeeting(meetingId),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
        // This write deletes and re-records every vote on the motion AND stamps
        // the motion's outcome, so it moves both reads the live screen now takes
        // from tRPC (wave 5, Task 4).
        void queryClient.invalidateQueries(trpc.voteRecord.pathFilter());
        void queryClient.invalidateQueries(trpc.motion.pathFilter());
        toast.success("Vote recorded");

        // ─── What else the transaction did ─────────────────────────────
        //
        // Each branch below invalidates a read that a `useEffect` in
        // `live.tsx` used to write and then invalidate for itself. The server
        // decided each of these once; this only tells the cache.

        if (data.executiveSession !== null) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
          });
          void queryClient.invalidateQueries(trpc.executiveSession.pathFilter());
        }

        if (data.minutesApproved !== null) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.minutesDocuments.byMeeting(meetingId),
          });
          // The document approved belongs to an EARLIER meeting (it is reached
          // through `agenda_item.source_minutes_document_id`), so the legacy
          // key above — keyed by the LIVE meeting — never reached the shell
          // that renders it. The router-level filter does; one more reason
          // conventions item 7 prefers it.
          void queryClient.invalidateQueries(trpc.minutesDocument.pathFilter());

          // Re-render the PDF without the DRAFT watermark, fire-and-forget.
          //
          // **Preserved, including its defect.** This names the LIVE meeting,
          // which is not the meeting whose minutes were just approved — see
          // `routers/minutes-document.ts`'s `approveMinutesForPassedMotion`.
          // The live meeting usually has no minutes document, so the request
          // 404s into the `catch` below and the watermark is never removed.
          // Fixing it means deciding what a re-render of another meeting's
          // legal record should do, which is wave 6's surface, not a
          // migration's.
          void apiFetch(`/api/meetings/${meetingId}/minutes/render`, {
            method: "POST",
            json: { is_draft: false },
          }).catch(() => {
            // Non-critical — the minutes screen can re-render on demand.
          });
        }

        if (data.adjourned) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.agendaItems.byMeeting(meetingId),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId),
          });
          // The adjournment defers the unreached items, closes the open
          // transition and moves the meeting's own status — three routers, and
          // `trpc.meeting.pathFilter()` is also what makes the live screen
          // refetch and route itself to the review page, on this device and
          // every other one.
          void queryClient.invalidateQueries(trpc.meeting.pathFilter());
          void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
          void queryClient.invalidateQueries(trpc.agendaItemTransition.pathFilter());
          // FOUR routers, not three: the adjournment also COPIES the unreached
          // and tabled items into `future_item_queue`, and as of wave 6 Task 4
          // `routes/meetings.$meetingId.review.tsx` reads that table through
          // `trpc.futureItem.byMeeting`. `future_item_queue` is not one of the
          // eight `LIVE_MEETING_TOPICS` either, so nothing else would reach it
          // — and it had no legacy `queryKeys.futureItemQueues` invalidation
          // here to be corrected, which is why item 7's usual "update the
          // writer of the key you abandoned" sweep could not find it.
          void queryClient.invalidateQueries(trpc.futureItem.pathFilter());
          toast.success("Meeting adjourned");
        }

        onComplete();
      },
    }),
  );

  const recordVote = useCallback(() => {
    if (!allVoted) return;
    // The roll the server is asked to record — every seat, including the
    // absent and the recused, exactly as the raw version built it. The server
    // computes the outcome from these; nothing about the tally is sent.
    const finalEntries: VoteEntry[] = memberVoteStatus.map((m) => {
      if (!m.isPresent) return { boardMemberId: m.boardMemberId, vote: "absent" };
      if (m.isRecused)
        return {
          boardMemberId: m.boardMemberId,
          vote: "recusal",
          recusalReason: m.recusalReason,
        };
      return {
        boardMemberId: m.boardMemberId,
        vote: votes.get(m.boardMemberId) ?? "abstain",
      };
    });

    recordVoteMutation.reset();
    recordVoteMutation.mutate({
      boardId,
      motionId,
      votes: finalEntries.map((entry) => ({
        boardMemberId: entry.boardMemberId,
        vote: entry.vote as "yes" | "no" | "abstain" | "recusal" | "absent",
        recusalReason: entry.recusalReason ?? null,
      })),
    });
  }, [allVoted, boardId, motionId, memberVoteStatus, votes, recordVoteMutation]);

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Roll Call Vote</h4>
        <span className="text-xs text-muted-foreground">
          {votedCount} of {eligibleCount} voted
        </span>
      </div>

      {/* Member vote grid */}
      <div className="space-y-1.5">
        {memberVoteStatus.map((m) => (
          <div
            key={m.boardMemberId}
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-1.5",
              !m.isPresent && "opacity-40",
              m.isRecused && "opacity-60 bg-muted/50",
            )}
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">{m.name}</span>
              {m.seatTitle && (
                <span className="ml-1.5 text-xs text-muted-foreground">({m.seatTitle})</span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {!m.isPresent ? (
                <Badge variant="secondary" className="text-xs">
                  Absent
                </Badge>
              ) : m.isRecused ? (
                <Badge variant="secondary" className="text-xs" title={m.recusalReason ?? "Recused"}>
                  Recused
                </Badge>
              ) : (
                <>
                  <VoteButton
                    label="Yea"
                    active={votes.get(m.boardMemberId) === "yes"}
                    onClick={() => setVote(m.boardMemberId, "yes")}
                    color="green"
                  />
                  <VoteButton
                    label="Nay"
                    active={votes.get(m.boardMemberId) === "no"}
                    onClick={() => setVote(m.boardMemberId, "no")}
                    color="red"
                  />
                  <VoteButton
                    label="Abstain"
                    active={votes.get(m.boardMemberId) === "abstain"}
                    onClick={() => setVote(m.boardMemberId, "abstain")}
                    color="gray"
                  />
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tally */}
      <div className="flex flex-wrap gap-3 border-t pt-3 text-xs">
        <span className="font-medium text-green-600 dark:text-green-400">Yea: {tally.yeas}</span>
        <span className="font-medium text-red-600 dark:text-red-400">Nay: {tally.nays}</span>
        <span className="text-muted-foreground">Abstain: {tally.abstentions}</span>
        {tally.recusals > 0 && (
          <span className="text-muted-foreground">Recused: {tally.recusals}</span>
        )}
        {tally.absent > 0 && <span className="text-muted-foreground">Absent: {tally.absent}</span>}
      </div>

      {recordVoteMutation.error && (
        <p className="text-sm text-destructive" role="alert">
          {refusalMessage(recordVoteMutation.error, "record the votes on this motion")}
        </p>
      )}

      {/* Result preview + Record button */}
      <div className="flex items-center justify-between border-t pt-3">
        {allVoted && (
          <span
            className={cn(
              "text-sm font-semibold",
              tally.passed
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400",
            )}
          >
            {formatVoteCompact(tally)}
          </span>
        )}
        {!allVoted && <span />}
        <Button
          size="sm"
          onClick={() => recordVote()}
          disabled={!allVoted || recordVoteMutation.isPending}
        >
          {recordVoteMutation.isPending ? "Recording..." : "Record Vote"}
        </Button>
      </div>
    </div>
  );
}

// ─── Vote Button ────────────────────────────────────────────────────

function VoteButton({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color: "green" | "red" | "gray";
}) {
  const baseClasses = "h-7 min-w-[56px] text-xs font-medium transition-colors";
  const colorClasses = {
    green: active
      ? "bg-green-600 text-white hover:bg-green-700 dark:bg-green-700"
      : "border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30",
    red: active
      ? "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700"
      : "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30",
    gray: active
      ? "bg-gray-600 text-white hover:bg-gray-700 dark:bg-gray-600"
      : "border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-900/30",
  };

  return (
    <button
      type="button"
      className={cn("rounded-md px-2", baseClasses, colorClasses[color])}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
