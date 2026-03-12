/**
 * CancelMeetingDialog — confirmation dialog for cancelling a meeting.
 */

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
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
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  const handleCancel = useCallback(async () => {
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('meeting')
        .update({ status: 'cancelled', updated_at: now })
        .eq('id', meetingId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.meetings.all });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [supabase, queryClient, meetingId, onOpenChange]);

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
