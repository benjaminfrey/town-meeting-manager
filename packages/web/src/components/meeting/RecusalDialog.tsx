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
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
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
  townId: string;
  agendaItemId: string;
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
  townId,
  agendaItemId,
  activeMotionId,
  onRecusalRecorded,
}: RecusalDialogProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"item" | "remaining">("item");
  const [error, setError] = useState<string | null>(null);

  const recusalMutation = useMutation({
    mutationFn: async ({ trimmedReason }: { trimmedReason: string }) => {
      // If there's an active motion being voted on, create the vote_record immediately
      if (activeMotionId) {
        const { error: insertError } = await supabase.from("vote_record").insert({
          id: crypto.randomUUID(),
          motion_id: activeMotionId,
          meeting_id: meetingId,
          town_id: townId,
          board_member_id: boardMemberId,
          vote: "recusal",
          recusal_reason: trimmedReason,
          created_at: new Date().toISOString(),
        });
        if (insertError) throw insertError;
      }
    },
    onSuccess: (_data, { trimmedReason }) => {
      if (activeMotionId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.voteRecords.byMotion(activeMotionId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.voteRecords.byMeeting(meetingId) });
      }
      onRecusalRecorded(boardMemberId, trimmedReason, scope);
      onOpenChange(false);
      setReason("");
      setScope("item");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to record recusal");
    },
  });

  const canSubmit = reason.trim().length > 0 && !recusalMutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setError(null);
    recusalMutation.mutate({ trimmedReason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Recusal</DialogTitle>
          <DialogDescription>
            Per Maine law 30-A M.R.S.A. §2605(4), the disclosure and
            abstention must be recorded with the clerk or secretary.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Member (read-only) */}
          <div>
            <Label>Member</Label>
            <p className="mt-1 rounded-md border bg-muted/50 px-3 py-1.5 text-sm">
              {memberName}
            </p>
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

          {error && <p className="text-sm text-destructive">{error}</p>}
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
