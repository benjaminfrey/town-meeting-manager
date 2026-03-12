/**
 * Motion Panel — displays motions for the current agenda item with
 * workflow controls (call vote, amend, withdraw, table).
 *
 * Supports:
 * - Nested amendments (via parent_motion_id)
 * - Motion status workflow: seconded → in_vote → passed/failed
 * - Vote summary display in block or inline format
 * - Inline VotePanel expansion for active votes
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import {
  Gavel,
  Vote,
  Pencil,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { VotePanel } from "./VotePanel";
import {
  formatVoteCompact,
  formatVoteInline,
  formatVoteBlock,
  type VoteEntry,
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

interface MotionData {
  id: string;
  motionText: string;
  motionType: string;
  movedBy: string | null;
  secondedBy: string | null;
  status: string;
  parentMotionId: string | null;
  voteSummary: string | null; // JSON string
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

interface MotionPanelProps {
  motions: MotionData[];
  votesByMotion: Map<string, VoteRecordData[]>;
  memberNameMap: Map<string, string>;
  motionDisplayFormat: string | null;
  meetingId: string;
  townId: string;
  agendaItemId: string;
  allMembers: MemberInfo[];
  presentMembers: MemberInfo[];
  attendanceRecords: AttendanceRecord[];
  boardQuorumConfig: BoardQuorumConfig;
  quorumBlocked: boolean;
  readOnly?: boolean;
  onAmend?: (motionId: string, motionText: string) => void;
}

// ─── Status / Type Badge Colors ─────────────────────────────────────

const STATUS_BADGE: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "secondary", label: "Pending" },
  seconded: { variant: "outline", label: "Seconded" },
  in_vote: { variant: "default", label: "Voting" },
  passed: { variant: "default", label: "Passed" },
  failed: { variant: "destructive", label: "Failed" },
  tabled: { variant: "secondary", label: "Tabled" },
  withdrawn: { variant: "secondary", label: "Withdrawn" },
};

const TYPE_COLORS: Record<string, string> = {
  main: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  amendment: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  substitute: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  table: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  untable: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  postpone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  reconsider: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  adjourn: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const TYPE_LABELS: Record<string, string> = {
  main: "Main",
  amendment: "Amendment",
  substitute: "Substitute",
  table: "Table",
  untable: "Untable",
  postpone: "Postpone",
  reconsider: "Reconsider",
  adjourn: "Adjourn",
};

// ─── Component ──────────────────────────────────────────────────────

export function MotionPanel({
  motions,
  votesByMotion,
  memberNameMap,
  motionDisplayFormat,
  meetingId,
  townId,
  agendaItemId,
  allMembers,
  presentMembers,
  attendanceRecords,
  boardQuorumConfig,
  quorumBlocked,
  readOnly,
  onAmend,
}: MotionPanelProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [expandedMotionId, setExpandedMotionId] = useState<string | null>(null);
  const [votingMotionId, setVotingMotionId] = useState<string | null>(null);
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(null);

  // Separate parent motions from amendments
  const { parentMotions, amendmentsByParent } = useMemo(() => {
    const parents: MotionData[] = [];
    const amendments = new Map<string, MotionData[]>();

    for (const m of motions) {
      if (m.parentMotionId) {
        const list = amendments.get(m.parentMotionId) ?? [];
        list.push(m);
        amendments.set(m.parentMotionId, list);
      } else {
        parents.push(m);
      }
    }

    return { parentMotions: parents, amendmentsByParent: amendments };
  }, [motions]);

  // ─── Handlers ─────────────────────────────────────────────────

  const callVoteMutation = useMutation({
    mutationFn: async (motionId: string) => {
      const { error } = await supabase
        .from("motion")
        .update({ status: "in_vote", updated_at: new Date().toISOString() })
        .eq("id", motionId);
      if (error) throw error;
    },
    onSuccess: (_data, motionId) => {
      setVotingMotionId(motionId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
    },
  });

  const withdrawMotionMutation = useMutation({
    mutationFn: async (motionId: string) => {
      const { error } = await supabase
        .from("motion")
        .update({ status: "withdrawn", updated_at: new Date().toISOString() })
        .eq("id", motionId);
      if (error) throw error;
    },
    onSuccess: () => {
      setWithdrawConfirmId(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
    },
  });

  const callVote = useCallback(
    (motionId: string) => {
      callVoteMutation.mutate(motionId);
    },
    [callVoteMutation],
  );

  const withdrawMotion = useCallback(
    (motionId: string) => {
      withdrawMotionMutation.mutate(motionId);
    },
    [withdrawMotionMutation],
  );

  const handleVoteComplete = useCallback(() => {
    setVotingMotionId(null);
  }, []);

  // ─── Empty State ──────────────────────────────────────────────

  if (motions.length === 0) {
    return (
      <div className="py-2">
        <p className="text-xs text-muted-foreground italic">
          No motions recorded for this item
        </p>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Motions</h3>
      <div className="space-y-2">
        {parentMotions.map((motion) => (
          <div key={motion.id}>
            <MotionCard
              motion={motion}
              votes={votesByMotion.get(motion.id)}
              memberNameMap={memberNameMap}
              displayFormat={motionDisplayFormat}
              expanded={expandedMotionId === motion.id}
              onToggleExpand={() =>
                setExpandedMotionId((id) => (id === motion.id ? null : motion.id))
              }
              isVoting={votingMotionId === motion.id}
              quorumBlocked={quorumBlocked}
              readOnly={readOnly}
              onCallVote={() => callVote(motion.id)}
              onWithdraw={() => setWithdrawConfirmId(motion.id)}
              onAmend={onAmend ? () => onAmend(motion.id, motion.motionText) : undefined}
            />

            {/* Inline VotePanel when voting */}
            {votingMotionId === motion.id && motion.status === "in_vote" && (
              <div className="ml-4 mt-2">
                <VotePanel
                  motionId={motion.id}
                  meetingId={meetingId}
                  townId={townId}
                  allMembers={allMembers}
                  attendanceRecords={attendanceRecords}
                  existingVotes={votesByMotion.get(motion.id) ?? []}
                  boardQuorumConfig={boardQuorumConfig}
                  memberNameMap={memberNameMap}
                  onComplete={handleVoteComplete}
                />
              </div>
            )}

            {/* Nested amendments */}
            {(amendmentsByParent.get(motion.id) ?? []).map((amendment) => (
              <div key={amendment.id} className="ml-6 mt-1">
                <MotionCard
                  motion={amendment}
                  votes={votesByMotion.get(amendment.id)}
                  memberNameMap={memberNameMap}
                  displayFormat={motionDisplayFormat}
                  expanded={expandedMotionId === amendment.id}
                  onToggleExpand={() =>
                    setExpandedMotionId((id) =>
                      id === amendment.id ? null : amendment.id,
                    )
                  }
                  isVoting={votingMotionId === amendment.id}
                  quorumBlocked={quorumBlocked}
                  readOnly={readOnly}
                  onCallVote={() => callVote(amendment.id)}
                  onWithdraw={() => setWithdrawConfirmId(amendment.id)}
                />

                {/* VotePanel for amendment */}
                {votingMotionId === amendment.id &&
                  amendment.status === "in_vote" && (
                    <div className="ml-4 mt-2">
                      <VotePanel
                        motionId={amendment.id}
                        meetingId={meetingId}
                        townId={townId}
                        allMembers={allMembers}
                        attendanceRecords={attendanceRecords}
                        existingVotes={votesByMotion.get(amendment.id) ?? []}
                        boardQuorumConfig={boardQuorumConfig}
                        memberNameMap={memberNameMap}
                        onComplete={handleVoteComplete}
                      />
                    </div>
                  )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Withdraw confirmation */}
      <AlertDialog
        open={!!withdrawConfirmId}
        onOpenChange={(open) => !open && setWithdrawConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw Motion?</AlertDialogTitle>
            <AlertDialogDescription>
              The mover wishes to withdraw this motion. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => withdrawConfirmId && withdrawMotion(withdrawConfirmId)}
            >
              Confirm Withdrawal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Motion Card ────────────────────────────────────────────────────

function MotionCard({
  motion,
  votes,
  memberNameMap,
  displayFormat,
  expanded,
  onToggleExpand,
  isVoting,
  quorumBlocked,
  readOnly,
  onCallVote,
  onWithdraw,
  onAmend,
}: {
  motion: MotionData;
  votes?: VoteRecordData[];
  memberNameMap: Map<string, string>;
  displayFormat: string | null;
  expanded: boolean;
  onToggleExpand: () => void;
  isVoting: boolean;
  quorumBlocked: boolean;
  readOnly?: boolean;
  onCallVote: () => void;
  onWithdraw: () => void;
  onAmend?: () => void;
}) {
  const statusInfo = STATUS_BADGE[motion.status] ?? STATUS_BADGE.pending;
  const typeColor = TYPE_COLORS[motion.motionType] ?? TYPE_COLORS.main;
  const typeLabel = TYPE_LABELS[motion.motionType] ?? motion.motionType;
  const movedByName = motion.movedBy ? memberNameMap.get(motion.movedBy) ?? "Unknown" : null;
  const secondedByName = motion.secondedBy ? memberNameMap.get(motion.secondedBy) ?? "Unknown" : null;

  // Vote summary — Supabase returns JSONB as a native object; no JSON.parse needed.
  // Defensive: if it's still a string (legacy), parse it.
  const voteSummary = motion.voteSummary ? (() => {
    try {
      const raw = motion.voteSummary;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as { yeas: number; nays: number; abstentions: number; recusals: number; absent: number; result: string; passed: boolean };
    } catch { return null; }
  })() : null;

  const isCompleted = motion.status === "passed" || motion.status === "failed";
  const isWithdrawn = motion.status === "withdrawn";
  const canAct = !readOnly && !isVoting;
  const showActions = canAct && (motion.status === "seconded" || motion.status === "pending");

  // Build vote entries for detailed display
  const voteEntries: VoteEntry[] | null = votes?.map((v) => ({
    boardMemberId: v.board_member_id,
    vote: v.vote,
    recusalReason: v.recusal_reason,
  })) ?? null;

  return (
    <div
      className={`rounded-md border p-3 text-sm ${isWithdrawn ? "opacity-50" : ""} ${isVoting ? "ring-2 ring-primary" : ""}`}
    >
      {/* Header: type + status badges */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${typeColor}`}>
            {typeLabel}
          </span>
          <Badge variant={statusInfo.variant} className="text-xs">
            {isWithdrawn ? <span className="line-through">{statusInfo.label}</span> : statusInfo.label}
          </Badge>
        </div>
        {voteSummary && (
          <span className={`text-xs font-semibold ${voteSummary.result === "passed" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {formatVoteCompact({
              ...voteSummary,
              votingMembers: voteSummary.yeas + voteSummary.nays,
              majorityNeeded: 0,
              passed: voteSummary.result === "passed",
            })}
          </span>
        )}
      </div>

      {/* Motion text */}
      <p
        className={`mt-1.5 ${expanded ? "" : "line-clamp-2"} ${isWithdrawn ? "line-through" : "italic"} cursor-pointer`}
        onClick={onToggleExpand}
      >
        {motion.motionText}
      </p>

      {/* Expand/collapse indicator */}
      {motion.motionText.length > 120 && (
        <button
          onClick={onToggleExpand}
          className="mt-0.5 flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> More
            </>
          )}
        </button>
      )}

      {/* Moved/seconded */}
      <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
        {movedByName && <span>Moved: {movedByName}</span>}
        {secondedByName && <span>Seconded: {secondedByName}</span>}
      </div>

      {/* Expanded vote details (block or inline format) */}
      {expanded && isCompleted && voteSummary && voteEntries && (
        <div className="mt-3 border-t pt-2">
          {displayFormat === "inline_narrative" && movedByName ? (
            <p className="text-xs text-muted-foreground">
              {formatVoteInline(
                motion.motionText,
                movedByName,
                secondedByName,
                { ...voteSummary, votingMembers: voteSummary.yeas + voteSummary.nays, majorityNeeded: 0, passed: voteSummary.result === "passed" },
              )}
            </p>
          ) : movedByName ? (
            <div className="space-y-0.5">
              {formatVoteBlock(
                motion.motionText,
                movedByName,
                secondedByName,
                { ...voteSummary, votingMembers: voteSummary.yeas + voteSummary.nays, majorityNeeded: 0, passed: voteSummary.result === "passed" },
              ).map((line) => (
                <div key={line.label} className="flex gap-2 text-xs">
                  <span className="min-w-[80px] text-muted-foreground">{line.label}:</span>
                  <span className={line.label === "Result" ? (voteSummary.result === "passed" ? "font-semibold text-green-600 dark:text-green-400" : "font-semibold text-red-600 dark:text-red-400") : ""}>
                    {line.value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Action buttons */}
      {showActions && (
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onCallVote}
            disabled={quorumBlocked}
          >
            <Vote className="mr-1 h-3 w-3" /> Call the Vote
          </Button>
          {onAmend && motion.motionType === "main" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onAmend}
            >
              <Pencil className="mr-1 h-3 w-3" /> Amend
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={onWithdraw}
          >
            <XCircle className="mr-1 h-3 w-3" /> Withdraw
          </Button>
        </div>
      )}
    </div>
  );
}
