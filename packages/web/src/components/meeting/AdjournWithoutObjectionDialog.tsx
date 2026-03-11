/**
 * Adjourn Without Objection Dialog — records an informal adjournment
 * where the presiding officer declares the meeting adjourned without
 * a formal motion/vote (per Q7 advisory decision).
 */

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AdjournWithoutObjectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presidingOfficerName: string;
  onConfirm: () => void;
}

export function AdjournWithoutObjectionDialog({
  open,
  onOpenChange,
  presidingOfficerName,
  onConfirm,
}: AdjournWithoutObjectionDialogProps) {
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = () => {
    setConfirming(true);
    onConfirm();
    // Parent will handle navigation; don't reset state since component unmounts
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjourn Without Objection</DialogTitle>
          <DialogDescription>
            The Chair declares the meeting adjourned. No motion or vote is
            required for this method.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/50 px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">{presidingOfficerName}</span>{" "}
            adjourns the meeting without objection.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? "Adjourning..." : "Confirm Adjournment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
