/**
 * CancelMeetingDialog — confirmation dialog for cancelling a meeting.
 *
 * Phase E, wave 3, Task 2 — the write moves onto `trpc.meeting.cancel`
 * (`packages/api/src/trpc/routers/meeting.ts`, wave 3 Task 1). This closes a
 * real authorization hole, not a completeness gap: `meeting_tenant_isolation`
 * is tenancy-only (no board or role predicate), so the raw
 * `.update({status: "cancelled"})` this replaces had NO authorization check
 * of any kind — any signed-in member of the town, any role, could cancel any
 * meeting on any board. `meeting.cancel` closes it with
 * `requireBoardActor(assertCanUpdateMeeting)` — admin, or A1/M1 for the
 * meeting's own board.
 *
 * `boardId` is a new required prop, threaded down from this component's only
 * caller (`boards.$boardId.meetings.tsx`, which already has the board in
 * scope): `requireBoardActor`'s guard reads it before `.input()` parses, so
 * there is something for the guard to authorize against before the resolver
 * ever looks up the meeting's real board.
 *
 * Before this task, the raw write could never be refused — there was no
 * authorization check at all, so a caught-and-surfaced error path was
 * unreachable. Closing the hole made FORBIDDEN a real outcome; without a
 * visible error here, a refused cancel would leave the dialog open with no
 * feedback and the rejection escaping as an unhandled promise rejection.
 */

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Loader2 } from "lucide-react";
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
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelMeetingDialog({
  meetingId,
  meetingTitle,
  boardId,
  open,
  onOpenChange,
}: CancelMeetingDialogProps) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelMutation = useMutation(
    trpc.meeting.cancel.mutationOptions({
      onSuccess: () => {
        // Legacy keys: `meetings.detail`/`meetings.all` still have other,
        // unmigrated readers (conventions item 7's "the legacy line stays
        // because other, unmigrated screens still read that key").
        void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.all });
        void queryClient.invalidateQueries(trpc.meeting.pathFilter());
      },
    }),
  );

  const handleCancel = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      await cancelMutation.mutateAsync({ meetingId, boardId });
      onOpenChange(false);
    } catch (err) {
      setError(
        isTRPCClientError(err) && err.data?.code === "FORBIDDEN"
          ? "You don't have permission to cancel this meeting."
          : "Couldn't cancel this meeting. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [cancelMutation, meetingId, boardId, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Meeting</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel "{meetingTitle}"? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
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
