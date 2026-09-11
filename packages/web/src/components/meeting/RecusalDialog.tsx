/**
 * Recusal Dialog — records a board member's recusal from an agenda item.
 *
 * Per Maine law 30-A M.R.S.A. §2605(4), disclosure and abstention must
 * be recorded with the clerk/secretary. This dialog captures the member,
 * reason (required), and scope of the recusal.
 *
 * The recusal is stored as a vote_record with vote='recusal' and the
 * recusal_reason field populated. If no active motion exists yet, the
 * recusal is stored when the first vote is taken on this item.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// ─── Types ──────────────────────────────────────────────────────────

interface RecusalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  boardMemberId: string;
  meetingId: string;
  /**
   * The board this meeting belongs to — `voteRecord.insert`'s guard runs
   * before `.input()` and has only the request body to authorize on. See
   * `MotionCaptureDialog`'s own `boardId` note; the cost is the same one
   * conventions item 2 names for every row-targeted board-scoped write.
   */
  boardId: string;
  /** If there's an active motion (in_vote status), record the recusal immediately */
  activeMotionId: string | null;
  onRecusalRecorded: (boardMemberId: string, reason: string, scope: "item" | "remaining") => void;
}

// ─── Component ──────────────────────────────────────────────────────

export function RecusalDialog({
  open,
  onOpenChange,
  memberName,
  boardMemberId,
  meetingId,
  boardId,
  activeMotionId,
  onRecusalRecorded,
}: RecusalDialogProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"item" | "remaining">("item");

  /**
   * The local half of recording a recusal — the toast, the parent's
   * quorum-impact bookkeeping, and closing the dialog.
   *
   * Split out because it runs on BOTH paths and only one of them is a write:
   * with no motion in front of the board there is nothing to insert, and the
   * raw mutation this replaces expressed that as a `mutationFn` with an empty
   * body whose `onSuccess` still fired. A tRPC mutation cannot call nothing, so
   * the branch moved to the caller and the shared tail moved here.
   */
  const finishRecusal = (trimmedReason: string) => {
    toast.success("Recusal recorded");
    onRecusalRecorded(boardMemberId, trimmedReason, scope);
    onOpenChange(false);
    setReason("");
    setScope("item");
  };

  /**
   * Wave 5, Task 5 — `voteRecord.insert` in place of the raw insert.
   *
   * `meeting_id`, `town_id`, `id` and `created_at` are gone from the payload:
   * the procedure derives the meeting from the MOTION (so a recusal can no
   * longer be filed whose `meeting_id` disagrees with its motion's), the town
   * from the caller's session, and the other two from column defaults.
   *
   * This is the one path in the product on which rule 5's self-vote branch is
   * reachable, so the refusal a board member sees comes from the rule rather
   * than from the middleware prefilter — see `routers/vote-record.ts`'s header.
   * Either way it is FORBIDDEN, newly reachable, and rendered inside this
   * dialog, which stays open on a refusal and `aria-hidden`s everything
   * outside itself.
   */
  const recusalMutation = useMutation(
    trpc.voteRecord.insert.mutationOptions({
      onSuccess: (_data, variables) => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.voteRecords.byMotion(variables.motionId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.voteRecords.byMeeting(meetingId),
        });
        // The live screen reads votes through `trpc.voteRecord.byMeeting` as
        // of wave 5, Task 4; neither legacy key above reaches it.
        void queryClient.invalidateQueries(trpc.voteRecord.pathFilter());
        finishRecusal(variables.recusalReason ?? "");
      },
    }),
  );

  const canSubmit = reason.trim().length > 0 && !recusalMutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const trimmedReason = reason.trim();
    if (!activeMotionId) {
      finishRecusal(trimmedReason);
      return;
    }
    recusalMutation.reset();
    recusalMutation.mutate({
      boardId,
      motionId: activeMotionId,
      boardMemberId,
      vote: "recusal",
      recusalReason: trimmedReason,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Recusal</DialogTitle>
          <DialogDescription>
            Per Maine law 30-A M.R.S.A. §2605(4), the disclosure and abstention must be recorded
            with the clerk or secretary.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Member (read-only) */}
          <div>
            <Label>Member</Label>
            <p className="mt-1 rounded-md border bg-muted/50 px-3 py-1.5 text-sm">{memberName}</p>
          </div>

          {/* Reason (required) */}
          <div>
            <Label htmlFor="recusal-reason">
              Reason for Recusal <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="recusal-reason"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g., Conflict of interest — applicant is a family member"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
            {reason.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                A reason is required by Maine law.
              </p>
            )}
          </div>

          {/* Scope */}
          <div>
            <Label>Scope</Label>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="recusal-scope"
                  checked={scope === "item"}
                  onChange={() => setScope("item")}
                  className="h-4 w-4"
                />
                This item only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="recusal-scope"
                  checked={scope === "remaining"}
                  onChange={() => setScope("remaining")}
                  className="h-4 w-4"
                />
                All remaining items
                <span className="text-xs text-muted-foreground">(rare)</span>
              </label>
            </div>
          </div>

          {recusalMutation.error && (
            <p className="text-sm text-destructive" role="alert">
              {refusalMessage(recusalMutation.error, "record this recusal")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => handleSubmit()} disabled={!canSubmit}>
            {recusalMutation.isPending ? "Recording..." : "Record Recusal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
