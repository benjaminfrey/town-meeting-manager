/**
 * Vote Panel — per-member vote recording for a motion.
 *
 * Shows each board member with Yea/Nay/Abstain buttons. Absent members
 * are auto-filled and grayed. Recused members show reason and are not
 * clickable. Records all votes atomically via writeTransaction.
 */

import { useState, useMemo, useCallback } from "react";
import { usePowerSync } from "@powersync/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

interface AttendanceRecord {
  id: string;
  board_member_id: string | null;
  person_id: string;
  status: string;
}

interface VoteRecordData {
  id: string;
  motion_id: string;
  board_member_id: string;
  vote: string;
  recusal_reason: string | null;
}

interface BoardQuorumConfig {
  quorumType: string | null;
  quorumValue: number | null;
  memberCount: number;
}

interface VotePanelProps {
  motionId: string;
  meetingId: string;
  townId: string;
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
  townId,
  allMembers,
  attendanceRecords,
  existingVotes,
  boardQuorumConfig,
  memberNameMap,
  onComplete,
}: VotePanelProps) {
  const powerSync = usePowerSync();
  const [saving, setSaving] = useState(false);

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
          attendance === "present" ||
          attendance === "remote" ||
          attendance === "late_arrival";
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
  const votedCount = memberVoteStatus.filter(
    (m) => m.canVote && votes.has(m.boardMemberId),
  ).length;
  const allVoted = votedCount === eligibleCount && eligibleCount > 0;

  // ─── Record Vote ──────────────────────────────────────────────

  const recordVote = useCallback(async () => {
    if (!allVoted) return;
    setSaving(true);

    try {
      // Build final vote entries
      const finalEntries: VoteEntry[] = memberVoteStatus.map((m) => {
        if (!m.isPresent)
          return { boardMemberId: m.boardMemberId, vote: "absent" };
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

      const result = calculateVoteResult(finalEntries);
      const now = new Date().toISOString();
      const voteSummary = JSON.stringify({
        yeas: result.yeas,
        nays: result.nays,
        abstentions: result.abstentions,
        recusals: result.recusals,
        absent: result.absent,
        result: result.result,
        passed: result.passed,
      });

      // Atomic: insert all vote records + update motion
      await powerSync.writeTransaction(async (tx) => {
        // Delete existing vote records for this motion (in case of re-vote)
        await tx.execute("DELETE FROM vote_records WHERE motion_id = ?", [
          motionId,
        ]);

        // Insert vote records
        for (const entry of finalEntries) {
          const id = crypto.randomUUID();
          await tx.execute(
            `INSERT INTO vote_records (id, motion_id, meeting_id, town_id, board_member_id, vote, recusal_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              motionId,
              meetingId,
              townId,
              entry.boardMemberId,
              entry.vote,
              entry.recusalReason ?? null,
              now,
            ],
          );
        }

        // Update motion status + vote summary
        await tx.execute(
          "UPDATE motions SET status = ?, vote_summary = ?, updated_at = ? WHERE id = ?",
          [result.result, voteSummary, now, motionId],
        );
      });

      onComplete();
    } catch (err) {
      console.error("Failed to record vote:", err);
    } finally {
      setSaving(false);
    }
  }, [
    allVoted,
    memberVoteStatus,
    votes,
    motionId,
    meetingId,
    townId,
    powerSync,
    onComplete,
  ]);

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
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({m.seatTitle})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {!m.isPresent ? (
                <Badge variant="secondary" className="text-xs">
                  Absent
                </Badge>
              ) : m.isRecused ? (
                <Badge
                  variant="secondary"
                  className="text-xs"
                  title={m.recusalReason ?? "Recused"}
                >
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
        <span className="font-medium text-green-600 dark:text-green-400">
          Yea: {tally.yeas}
        </span>
        <span className="font-medium text-red-600 dark:text-red-400">
          Nay: {tally.nays}
        </span>
        <span className="text-muted-foreground">Abstain: {tally.abstentions}</span>
        {tally.recusals > 0 && (
          <span className="text-muted-foreground">Recused: {tally.recusals}</span>
        )}
        {tally.absent > 0 && (
          <span className="text-muted-foreground">Absent: {tally.absent}</span>
        )}
      </div>

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
          onClick={() => void recordVote()}
          disabled={!allVoted || saving}
        >
          {saving ? "Recording..." : "Record Vote"}
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
