/**
 * ArchiveBoardDialog — confirmation dialog for archiving a board.
 *
 * Requires typing the board name to confirm. Archives the board
 * and all its active members. Boards are never deleted (legal compliance).
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { usePowerSync } from "@powersync/react";
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
  board: Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveBoardDialog({ board, open, onOpenChange }: ArchiveBoardDialogProps) {
  const powerSync = usePowerSync();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const boardId = String(board.id);
  const boardName = String(board.name ?? "");
  const isConfirmed = confirmation === boardName;

  const handleArchive = useCallback(async () => {
    if (!isConfirmed) return;

    setIsSaving(true);
    try {
      const now = new Date().toISOString();

      // Archive the board
      await powerSync.execute(
        `UPDATE boards SET archived_at = ? WHERE id = ?`,
        [now, boardId]
      );

      // Archive all active board members
      await powerSync.execute(
        `UPDATE board_members SET status = 'archived' WHERE board_id = ? AND status = 'active'`,
        [boardId]
      );

      onOpenChange(false);
      setConfirmation("");
      void navigate("/boards");
    } finally {
      setIsSaving(false);
    }
  }, [isConfirmed, powerSync, boardId, onOpenChange, navigate]);

  return (
    <AlertDialog open={open} onOpenChange={(val) => {
      if (!val) setConfirmation("");
      onOpenChange(val);
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {boardName}</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone from the UI.
          </AlertDialogDescription>
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
