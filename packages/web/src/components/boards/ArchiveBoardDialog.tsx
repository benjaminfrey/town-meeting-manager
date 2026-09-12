/**
 * ArchiveBoardDialog — confirmation dialog for archiving a board.
 *
 * Requires typing the board name to confirm. Archives the board
 * and all its active members. Boards are never deleted (legal compliance).
 *
 * ~~TODO(phase-e-wave-6): `archiveMutation` below still makes two raw,
 * untransacted Supabase writes~~ — closed in wave 6, Task 5.
 *
 * It is `trpc.board.archive` now: one procedure, one transaction, both writes
 * or neither. The tRPC equivalent that "did not exist yet" was built for this
 * — see `board.ts`'s own doc comment, and `board.test.ts`'s
 * "rolls the board write back when the member write fails", which is the test
 * this dialog's old shape could not have passed.
 *
 * **And the old shape never archived anything.** Its `board` update sent
 * `archived_at` AND `updated_at`, and `board` has no `updated_at` column
 * (confirmed against a live database and `0000_baseline.sql`) — so PostgREST
 * rejected the first write, the mutation threw, and this dialog rendered
 * NOTHING: no error state existed at all, so it simply stayed open with the
 * button re-enabled. There is a `role="alert"` now (conventions item 5).
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { refusalMessage, trpc, type RouterOutputs } from "@/lib/trpc";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ArchiveBoardDialogProps {
  board: RouterOutputs["board"]["detail"];
  /**
   * The caller's own town id — NOT read off `board`. `board.detail`'s
   * explicit column list does not select `town_id` (see its doc comment),
   * so a board-shaped `town_id` read silently produced `""` here before this
   * prop existed, which invalidated `["boards","byTown",""]` instead of the
   * real list key and made a freshly archived board keep appearing on
   * `/boards` for up to a minute. The caller already has this value from
   * `useCurrentUser()`.
   */
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveBoardDialog({ board, townId, open, onOpenChange }: ArchiveBoardDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState("");

  const boardId = board.id;
  const boardName = board.name;
  const isConfirmed = confirmation === boardName;

  const archiveMutation = useMutation(
    trpc.board.archive.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(boardId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.boards.byTown(townId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
        // The legacy `queryKeys.boards.*` invalidations above have had NO
        // reader since wave 6, Task 5 removed the last of them
        // (`CommandPalette.tsx`, `home.tsx`, `meetings.tsx` for `byTown`;
        // `boards.$boardId.templates.$templateId.edit.tsx` for `detail`).
        // They stay for one more commit, deliberately: deleting every
        // `queryKeys.boards.*` line empties `cache-key-parity.test.ts`'s
        // `boards` MIGRATED entry, which then reports zero violations for the
        // wrong reason and has to be removed in the same diff. That batch is
        // `docs/backlog.md` entry 7's, which this task extends rather than
        // executes.
        void queryClient.invalidateQueries(trpc.board.pathFilter());
        // Archives every active `board_member` row on this board —
        // `MemberRoster.tsx`'s roster read moved onto `boardMember.roster`
        // (Phase E, wave 2, Task 3), a fourth writer of the legacy
        // `queryKeys.members.byBoard` key that missed this call in that
        // task's own commit; caught in review.
        void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
        onOpenChange(false);
        setConfirmation("");
        void navigate("/boards");
      },
    }),
  );

  const isSaving = archiveMutation.isPending;

  const handleArchive = useCallback(async () => {
    if (!isConfirmed) return;
    await archiveMutation.mutateAsync({ boardId });
  }, [isConfirmed, archiveMutation, boardId]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(val) => {
        if (!val) setConfirmation("");
        // Clear a previous refusal whenever the dialog OPENS: conventions
        // item 2's shared-dialog-error paragraph asks for exactly this, and
        // it applies to a single dialog too — reopening after a failed
        // attempt must not show the stale message. `useMutation`'s `error`
        // survives a close/open cycle otherwise, because the component is
        // never unmounted.
        if (val) archiveMutation.reset();
        onOpenChange(val);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {boardName}</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone from the UI.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div>
            <p className="font-medium">Archiving {boardName} will:</p>
            <ul className="mt-2 ml-4 list-disc space-y-1 text-muted-foreground">
              <li>Remove it from the active boards list</li>
              <li>Preserve all meeting records, minutes, and history</li>
              <li>Archive all active board memberships</li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label>
              Type <span className="font-semibold">{boardName}</span> to confirm
            </Label>
            <Input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={boardName}
            />
          </div>
        </div>

        {/* No error surface existed here at all before wave 6, Task 5 — a
            failed archive closed nothing and said nothing. `board.archive` is
            also the first version of this write that can be REFUSED, so a
            silent failure would now be a new defect, not an inherited one. */}
        {archiveMutation.isError && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{refusalMessage(archiveMutation.error, "archive this board")}</p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => void handleArchive()}
            disabled={!isConfirmed || isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Archive Board
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
