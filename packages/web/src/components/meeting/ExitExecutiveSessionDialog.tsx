/**
 * Exit Executive Session Dialog — confirms return to public session
 * and prompts for post-session actions.
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
import { ArrowLeft } from "lucide-react";

interface ExitExecutiveSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  execSessionId: string;
  /**
   * The board this meeting belongs to — `executiveSession.markExited` is
   * guarded by `requireBoardPermission("M6", boardIdFrom())`, declared before
   * `.input()`. Conventions item 2's named cost, paid again.
   */
  boardId: string;
  /** Called when returning with post-session actions expected */
  onReturnWithActions: () => void;
  /** Called when returning with no post-session actions */
  onReturnNoActions: () => void;
}

export function ExitExecutiveSessionDialog({
  open,
  onOpenChange,
  execSessionId,
  boardId,
  onReturnWithActions,
  onReturnNoActions,
}: ExitExecutiveSessionDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"confirm" | "post_actions">("confirm");

  /**
   * Wave 5, Task 5 — `executiveSession.markExited` in place of the raw update.
   *
   * `exited_at` is the DATABASE's `now()` now, not the browser's clock, and
   * that is load-bearing rather than cosmetic: `live.tsx` decides which motions
   * count as post-session actions by comparing `motion.created_at` against this
   * timestamp, and the two used to come from different machines.
   *
   * Putting a board into closed session, and bringing it out, had no
   * authorization check of any kind before this wave. The refusal renders
   * INSIDE the dialog — it stays open when the write is refused, and Radix
   * `aria-hidden`s everything outside it (conventions item 2) — and it replaces
   * the toast the raw version used, which for a refusal would have said
   * "please try again" about something trying again cannot fix.
   */
  const exitSessionMutation = useMutation(
    trpc.executiveSession.markExited.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.executiveSessions.detail(execSessionId),
        });
        // `routes/meetings.$meetingId.live.tsx` reads this table through
        // `trpc.executiveSession.byMeeting` as of wave 5, Task 4 — the legacy
        // key above no longer reaches the banner this write dismisses.
        void queryClient.invalidateQueries(trpc.executiveSession.pathFilter());
        toast.success("Returned to open session");
        setStep("post_actions");
      },
    }),
  );

  const handleConfirmReturn = () => {
    exitSessionMutation.reset();
    exitSessionMutation.mutate({ boardId, executiveSessionId: execSessionId });
  };

  const handleClose = () => {
    onOpenChange(false);
    setStep("confirm");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {step === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowLeft className="h-5 w-5" />
                Return to Public Session
              </DialogTitle>
              <DialogDescription>
                This will end the executive session and resume public recording.
              </DialogDescription>
            </DialogHeader>
            {exitSessionMutation.error && (
              <p className="text-sm text-destructive" role="alert">
                {refusalMessage(exitSessionMutation.error, "return this board to open session")}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={() => handleConfirmReturn()}
                disabled={exitSessionMutation.isPending}
              >
                {exitSessionMutation.isPending ? "Recording..." : "Confirm Return"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Post-Session Actions</DialogTitle>
              <DialogDescription>
                Were any actions taken in public session following the executive session? (e.g.,
                motions or votes based on executive session discussion)
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  handleClose();
                  onReturnNoActions();
                }}
              >
                No Actions Taken
              </Button>
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  handleClose();
                  onReturnWithActions();
                }}
              >
                Yes — Record Actions
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
