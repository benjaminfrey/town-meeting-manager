/**
 * PublishAgendaDialog — confirmation dialog for publishing an agenda.
 *
 * Validates at least 1 item exists.
 * Warns about unfilled placeholders (non-blocking).
 *
 * ─── Phase E, wave 4, Task 3 — the A5 hole, closed ────────────────────────
 *
 * This dialog wrote `meeting.agenda_status = 'published'` through raw
 * Supabase with no authorization check of any kind, under
 * `meeting_tenant_isolation` (tenancy-only) — so any signed-in member of the
 * town could publish any board's agenda. It now calls
 * `meeting.publishAgenda` (wave 4, Task 2), guarded by **A5**
 * (`publish_agenda`) for this meeting's board through
 * `requireBoardPermission`, with the resolver re-reading the meeting's real
 * `board_id` and calling `assertMatchesAuthorizedBoard` before the UPDATE.
 * A5 had no rule anywhere in this codebase until that task.
 *
 * That is why `boardId` is a new prop: the guard is declared before
 * `.input()` and therefore has to authorize something before any query runs,
 * so the procedure takes a client-claimed board and pays for it with the
 * mismatch defence (see `trpc.ts`'s `requireBoardActor` doc comment on that
 * cost). It comes from `meeting.detail`'s own `board_id` on the screen above,
 * not from a second read.
 *
 * **The refusal is shown.** Publishing is a distinct governable action from
 * editing the agenda (A2) and from moving the meeting's status (A1/M1), so a
 * clerk who may build an agenda may well be refused here — FORBIDDEN is
 * newly reachable on this exact button, and wave 3 shipped two silent
 * refusals for precisely this reason.
 *
 * The client-side `hasItems` check stays as it was: the procedure
 * deliberately does not require a non-empty agenda, because the raw write it
 * replaces enforced nothing server-side and adding the precondition would be
 * a new rule rather than a preserved one (conventions item 1).
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage } from "@/lib/trpc";
import type { SectionWithChildren } from "./agenda-types";
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

interface PublishAgendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  /** The meeting's board — what A5 is checked against. */
  boardId: string;
  sections: SectionWithChildren[];
}

export function PublishAgendaDialog({
  open,
  onOpenChange,
  meetingId,
  boardId,
  sections,
}: PublishAgendaDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Validation
  const totalItems = sections.reduce((sum, s) => sum + s.children.length, 0);
  const hasItems = totalItems > 0;

  // Check for placeholder warnings
  const placeholderWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const section of sections) {
      for (const item of section.children) {
        const motion = item.suggested_motion ?? "";
        if (motion.includes("___") || motion.includes("[TBD]")) {
          warnings.push(`"${item.title}" has unfilled placeholders in suggested motion`);
        }
      }
    }
    return warnings;
  }, [sections]);

  const publish = useMutation(
    trpc.meeting.publishAgenda.mutationOptions({
      onSuccess: () => {
        // Legacy key: this meeting's raw `meeting` row still has unmigrated
        // readers (`live.tsx`, `review.tsx`) — conventions item 7.
        void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
        // The agenda builder's own `meeting.detail` read (whose
        // `agenda_status` gates the Publish button and the read-only mode),
        // and the board Meetings tab, which renders this meeting's
        // `agenda_status` via `trpc.meeting.byBoard`.
        void queryClient.invalidateQueries(trpc.meeting.pathFilter());
        onOpenChange(false);
      },
      onError: (err) => setError(refusalMessage(err, "publish this agenda")),
    }),
  );

  const handlePublish = useCallback(() => {
    if (!hasItems) return;
    setError(null);
    publish.mutate({ meetingId, boardId });
  }, [hasItems, publish, meetingId, boardId]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish Agenda</AlertDialogTitle>
          <AlertDialogDescription>
            {hasItems
              ? `Publish the agenda with ${totalItems} item${totalItems !== 1 ? "s" : ""} across ${sections.length} section${sections.length !== 1 ? "s" : ""}?`
              : "The agenda has no items. Add at least one item before publishing."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {placeholderWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Unfilled placeholders
              </p>
            </div>
            <ul className="space-y-1">
              {placeholderWarnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-700 dark:text-amber-300">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* A refusal, shown. Closing the A5 hole made FORBIDDEN reachable on
            this button for the first time. */}
        {error && (
          <p
            className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={publish.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handlePublish} disabled={!hasItems || publish.isPending}>
            {publish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
