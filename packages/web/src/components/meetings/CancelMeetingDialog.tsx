/**
 * CancelMeetingDialog — confirmation dialog for cancelling a meeting.
 */

import { useCallback, useState } from "react";
import { usePowerSync } from "@powersync/react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface CancelMeetingDialogProps {
  meetingId: string;
  meetingTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelMeetingDialog({
  meetingId,
  meetingTitle,
  open,
  onOpenChange,
}: CancelMeetingDialogProps) {
  const powerSync = usePowerSync();
  const [isSaving, setIsSaving] = useState(false);

  const handleCancel = useCallback(async () => {
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      await powerSync.execute(
        `UPDATE meetings SET status = 'cancelled', updated_at = ? WHERE id = ?`,
        [now, meetingId],
      );
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [powerSync, meetingId, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Meeting</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel "{meetingTitle}"? This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Keep Meeting
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleCancel()}
            disabled={isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel Meeting
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
