/**
 * Adjourn Without Objection Dialog — records an informal adjournment
 * where the presiding officer declares the meeting adjourned without
 * a formal motion/vote (per Q7 advisory decision).
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AdjournWithoutObjectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presidingOfficerName: string;
  onConfirm: () => void;
  /**
   * Whether the adjournment is in flight — the parent's mutation state, in
   * place of the local `confirming` flag this dialog used to set and never
   * clear.
   *
   * Phase E, wave 5, Task 5. That flag was correct only while adjourning could
   * not fail: it disabled the button and relied on the component unmounting.
   * A REFUSED adjournment leaves the dialog open with a permanently disabled
   * button and, before `error` below, nothing to explain it.
   */
  isPending?: boolean;
  /**
   * A refusal or failure, rendered INSIDE this dialog.
   *
   * Radix marks everything outside an open dialog `aria-hidden`, and a refused
   * destructive write is exactly the case that leaves the dialog open — so a
   * message rendered beside the Adjourn control would be invisible for the one
   * case it exists for. Conventions item 2, wave 4 Task 3.
   */
  error?: string | null;
}

export function AdjournWithoutObjectionDialog({
  open,
  onOpenChange,
  presidingOfficerName,
  onConfirm,
  isPending,
  error,
}: AdjournWithoutObjectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjourn Without Objection</DialogTitle>
          <DialogDescription>
            The Chair declares the meeting adjourned. No motion or vote is required for this method.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/50 px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">{presidingOfficerName}</span> adjourns the meeting without
            objection.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Adjourning..." : "Confirm Adjournment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
