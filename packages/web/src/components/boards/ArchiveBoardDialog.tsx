/**
 * ArchiveBoardDialog — confirmation dialog for archiving a board.
 *
 * Requires typing the board name to confirm. Archives the board
 * and all its active members. Boards are never deleted (legal compliance).
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
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
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState("");

  const boardId = board.id;
  const boardName = board.name;
  const isConfirmed = confirmation === boardName;

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();

      // Archive the board
      const { error: boardError } = await supabase
        .from("board")
        .update({
          archived_at: now,
          updated_at: now,
        })
        .eq("id", boardId);
      if (boardError) throw boardError;

      // Archive all active board members
      const { error: membersError } = await supabase
        .from("board_member")
        .update({ status: "archived" })
        .eq("board_id", boardId)
        .eq("status", "active");
      if (membersError) throw membersError;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards.byTown(townId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      // `queryKeys.boards.detail` no longer reaches BoardDetailPage's read —
      // that screen's board.detail/stats query keys are tRPC's own now.
      // Both invalidations stay: unmigrated screens can still be keyed off
      // the legacy factory, and the writer should not need to know which of
      // `board`'s procedures a given screen happens to call.
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
  });

  const isSaving = archiveMutation.isPending;

  const handleArchive = useCallback(async () => {
    if (!isConfirmed) return;
    await archiveMutation.mutateAsync();
  }, [isConfirmed, archiveMutation]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(val) => {
        if (!val) setConfirmation("");
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
