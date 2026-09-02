/**
 * CancelMeetingDialog — confirmation dialog for cancelling a meeting.
 *
 * TODO(phase-e-wave-3): meeting.cancel — NOT merely a completeness gap like
 * most markers this document tracks. `meeting_tenant_isolation` is
 * tenancy-only (no board or role predicate), so the raw `.update({status:
 * "cancelled"})` below has NO authorization check of any kind today — any
 * signed-in member of the town, any role, can cancel any meeting on any
 * board. `meeting.cancel` (`packages/api/src/trpc/routers/meeting.ts`,
 * wave 3 Task 1) closes this with `requireBoardActor(assertCanUpdateMeeting)`
 * — admin, or A1/M1 for the meeting's own board — the moment this file is
 * migrated onto it (wave 3 Task 2). Its input also needs a `boardId`
 * (`requireBoardActor`'s guard reads it before `.input()` parses), which
 * this component does not currently receive as a prop — see
 * `boards.$boardId.meetings.tsx`'s own marker, its only caller, which
 * already has the board in scope.
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
      // TODO(phase-e-wave-3): meeting.cancel — see this file's header; this
      // write has NO authorization check today, not just a completeness gap.
      const { error } = await supabase
        .from("meeting")
        .update({ status: "cancelled", updated_at: now })
        .eq("id", meetingId);
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
            Are you sure you want to cancel "{meetingTitle}"? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Keep Meeting
          </Button>
          <Button variant="destructive" onClick={() => void handleCancel()} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel Meeting
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
