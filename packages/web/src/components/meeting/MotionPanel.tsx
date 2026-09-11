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
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage, type RouterOutputs } from "@/lib/trpc";
import { Gavel, Vote, Pencil, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
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

interface MotionData {
  id: string;
  motionText: string;
  motionType: string;
  movedBy: string | null;
  secondedBy: string | null;
  status: string;
  parentMotionId: string | null;
  /**
   * JSONB, so `unknown` — see the reader below, which has said so in a comment
   * since it was written and already handles a string or an object. Widened in
   * Phase E wave 5, Task 4, when `motion.byMeeting` became the source and
   * declared the column as what it is.
   */
  voteSummary: unknown;
}

type VoteRecordData = RouterOutputs["voteRecord"]["byMeeting"][number];

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
  /**
   * The board this meeting belongs to — `motion.callVote`, `motion.withdraw`
   * and (through `VotePanel`) `voteRecord.recordForMotion` are all guarded by
   * `requireBoardPermission("M3", boardIdFrom())`, declared before `.input()`.
   * Conventions item 2's named cost, threaded one level further down.
   */
  boardId: string;
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

const STATUS_BADGE: Record<
  string,
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
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
  boardId,
  agendaItemId,
  allMembers,
  presentMembers,
  attendanceRecords,
  boardQuorumConfig,
  quorumBlocked,
  readOnly,
  onAmend,
}: MotionPanelProps) {
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

  /**
   * ─── Wave 5, Task 5: these two buttons START WORKING ─────────────────────
   *
   * Both raw updates sent `updated_at: new Date().toISOString()` alongside
   * `status`, and **`motion` has no `updated_at` column** — twelve columns in
   * `0000_baseline.sql`'s `CREATE TABLE public.motion`, none of them that, and
   * no later `ALTER TABLE … ADD COLUMN`. PostgREST rejects an unknown column in
   * the body rather than ignoring it, so "Call the Vote" and "Withdraw" have
   * been FAILING in the browser since they shipped, and failing silently:
   * neither mutation had an `onError` at all.
   *
   * `motion.callVote` and `motion.withdraw` write `status` alone. So this is a
   * user-visible behaviour change and not a migration — the two controls do
   * what they say for the first time. It is also why each now has a refusal
   * surface, which it needs twice over: the write is newly guarded (M3,
   * board-scoped; `motion_tenant_isolation` is tenancy-only and checked
   * nothing) AND newly capable of failing in a way a user can act on.
   *
   * **Two surfaces, because there are two reachability paths.** "Call the
   * Vote" fires straight from the card, so its refusal renders on the card.
   * "Withdraw" goes through an `AlertDialog`, and a refused write leaves that
   * dialog OPEN while Radix marks everything outside it `aria-hidden` — a
   * message on the card behind it would be invisible for exactly the case it
   * exists for (conventions item 2, wave 4 Task 3). Its refusal therefore
   * renders inside the dialog, and `AlertDialogAction` is replaced by a plain
   * `Button` so that a refusal does not dismiss the dialog it belongs to.
   */
  const callVoteMutation = useMutation(
    trpc.motion.callVote.mutationOptions({
      onSuccess: (_data, variables) => {
        setVotingMotionId(variables.motionId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
        // Moves `motion.status` to `in_vote`, which the live screen renders from
        // `trpc.motion.byMeeting` as of wave 5, Task 4.
        void queryClient.invalidateQueries(trpc.motion.pathFilter());
      },
    }),
  );

  const withdrawMotionMutation = useMutation(
    trpc.motion.withdraw.mutationOptions({
      onSuccess: () => {
        setWithdrawConfirmId(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
        // Its own call site — see `callVoteMutation` above.
        void queryClient.invalidateQueries(trpc.motion.pathFilter());
      },
    }),
  );

  const callVote = useCallback(
    (motionId: string) => {
      callVoteMutation.reset();
      callVoteMutation.mutate({ boardId, motionId });
    },
    [boardId, callVoteMutation],
  );

  const withdrawMotion = useCallback(
    (motionId: string) => {
      withdrawMotionMutation.reset();
      withdrawMotionMutation.mutate({ boardId, motionId });
    },
    [boardId, withdrawMotionMutation],
  );

  const handleVoteComplete = useCallback(() => {
    setVotingMotionId(null);
  }, []);

  // ─── Empty State ──────────────────────────────────────────────

  if (motions.length === 0) {
    return (
      <div className="py-2">
        <p className="text-xs text-muted-foreground italic">No motions recorded for this item</p>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Motions</h3>
      {callVoteMutation.error && (
        <p className="mb-2 text-sm text-destructive" role="alert">
          {refusalMessage(callVoteMutation.error, "call a vote on this motion")}
        </p>
      )}
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
                  boardId={boardId}
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
                    setExpandedMotionId((id) => (id === amendment.id ? null : amendment.id))
                  }
                  isVoting={votingMotionId === amendment.id}
                  quorumBlocked={quorumBlocked}
                  readOnly={readOnly}
                  onCallVote={() => callVote(amendment.id)}
                  onWithdraw={() => setWithdrawConfirmId(amendment.id)}
                />

                {/* VotePanel for amendment */}
                {votingMotionId === amendment.id && amendment.status === "in_vote" && (
                  <div className="ml-4 mt-2">
                    <VotePanel
                      motionId={amendment.id}
                      meetingId={meetingId}
                      boardId={boardId}
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
              {/* A refused withdrawal leaves this dialog open, and Radix marks
                  everything outside it `aria-hidden` — so the message has to
                  live in here. */}
              {withdrawMotionMutation.error && (
                <span className="mt-2 block text-destructive" role="alert">
                  {refusalMessage(withdrawMotionMutation.error, "withdraw this motion")}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* A plain `Button`, not `AlertDialogAction`: that one closes the
                dialog on click, which would take the refusal above with it. */}
            <Button
              onClick={() => withdrawConfirmId && withdrawMotion(withdrawConfirmId)}
              disabled={withdrawMotionMutation.isPending}
            >
              Confirm Withdrawal
            </Button>
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
  const statusInfo = (STATUS_BADGE[motion.status] ?? STATUS_BADGE.pending)!;
  const typeColor = TYPE_COLORS[motion.motionType] ?? TYPE_COLORS.main;
  const typeLabel = TYPE_LABELS[motion.motionType] ?? motion.motionType;
  const movedByName = motion.movedBy ? (memberNameMap.get(motion.movedBy) ?? "Unknown") : null;
  const secondedByName = motion.secondedBy
    ? (memberNameMap.get(motion.secondedBy) ?? "Unknown")
    : null;

  // Vote summary — Supabase returns JSONB as a native object; no JSON.parse needed.
  // Defensive: if it's still a string (legacy), parse it.
  const voteSummary = motion.voteSummary
    ? (() => {
        try {
          const raw = motion.voteSummary;
          return (typeof raw === "string" ? JSON.parse(raw) : raw) as {
            yeas: number;
            nays: number;
            abstentions: number;
            recusals: number;
            absent: number;
            result: string;
            passed: boolean;
          };
        } catch {
          return null;
        }
      })()
    : null;

  const isCompleted = motion.status === "passed" || motion.status === "failed";
  const isWithdrawn = motion.status === "withdrawn";
  const canAct = !readOnly && !isVoting;
  const showActions = canAct && (motion.status === "seconded" || motion.status === "pending");

  // Build vote entries for detailed display
  const voteEntries: VoteEntry[] | null =
    votes?.map((v) => ({
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
            {isWithdrawn ? (
              <span className="line-through">{statusInfo.label}</span>
            ) : (
              statusInfo.label
            )}
          </Badge>
        </div>
        {voteSummary && (
          <span
            className={`text-xs font-semibold ${voteSummary.result === "passed" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
          >
            {formatVoteCompact({
              ...voteSummary,
              votingMembers: voteSummary.yeas + voteSummary.nays,
              majorityNeeded: 0,
              passed: voteSummary.result === "passed",
              result: voteSummary.result as "passed" | "failed",
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
              {formatVoteInline(motion.motionText, movedByName, secondedByName, {
                ...voteSummary,
                votingMembers: voteSummary.yeas + voteSummary.nays,
                majorityNeeded: 0,
                passed: voteSummary.result === "passed",
                result: voteSummary.result as "passed" | "failed",
              })}
            </p>
          ) : movedByName ? (
            <div className="space-y-0.5">
              {formatVoteBlock(motion.motionText, movedByName, secondedByName, {
                ...voteSummary,
                votingMembers: voteSummary.yeas + voteSummary.nays,
                majorityNeeded: 0,
                passed: voteSummary.result === "passed",
                result: voteSummary.result as "passed" | "failed",
              }).map((line) => (
                <div key={line.label} className="flex gap-2 text-xs">
                  <span className="min-w-[80px] text-muted-foreground">{line.label}:</span>
                  <span
                    className={
                      line.label === "Result"
                        ? voteSummary.result === "passed"
                          ? "font-semibold text-green-600 dark:text-green-400"
                          : "font-semibold text-red-600 dark:text-red-400"
                        : ""
                    }
                  >
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
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAmend}>
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
