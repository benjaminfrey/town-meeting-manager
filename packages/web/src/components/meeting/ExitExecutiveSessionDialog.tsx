/**
 * Exit Executive Session Dialog — confirms return to public session
 * and prompts for post-session actions.
 */

import { useState } from "react";
import { usePowerSync } from "@powersync/react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface ExitExecutiveSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  execSessionId: string;
  /** Called when returning with post-session actions expected */
  onReturnWithActions: () => void;
  /** Called when returning with no post-session actions */
  onReturnNoActions: () => void;
}

export function ExitExecutiveSessionDialog({
  open,
  onOpenChange,
  execSessionId,
  onReturnWithActions,
  onReturnNoActions,
}: ExitExecutiveSessionDialogProps) {
  const powerSync = usePowerSync();
  const [step, setStep] = useState<"confirm" | "post_actions">("confirm");
  const [saving, setSaving] = useState(false);

  const handleConfirmReturn = async () => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await powerSync.execute(
        "UPDATE executive_sessions SET exited_at = ? WHERE id = ?",
        [now, execSessionId],
      );
      setStep("post_actions");
    } catch (err) {
      console.error("Failed to exit executive session:", err);
    } finally {
      setSaving(false);
    }
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
            <DialogFooter>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => void handleConfirmReturn()} disabled={saving}>
                {saving ? "Recording..." : "Confirm Return"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Post-Session Actions</DialogTitle>
              <DialogDescription>
                Were any actions taken in public session following the
                executive session? (e.g., motions or votes based on
                executive session discussion)
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
