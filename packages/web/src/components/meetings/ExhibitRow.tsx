/**
 * ExhibitRow — displays a single exhibit with delete action.
 */

import { useCallback, useState } from "react";
import { usePowerSync } from "@powersync/react";
import { FileText, Link as LinkIcon, Trash2 } from "lucide-react";
import { EXHIBIT_TYPE_LABELS } from "./meeting-labels";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ExhibitRowProps {
  exhibit: Record<string, unknown>;
  index: number;
  readOnly: boolean;
}

export function ExhibitRow({ exhibit, index, readOnly }: ExhibitRowProps) {
  const powerSync = usePowerSync();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const title = String(exhibit.title ?? `Exhibit ${index + 1}`);
  const fileType = String(exhibit.file_type ?? "");
  const exhibitType = String(exhibit.exhibit_type ?? "other");
  const isUrl = fileType === "url";

  const handleDelete = useCallback(async () => {
    await powerSync.execute("DELETE FROM exhibits WHERE id = ?", [
      String(exhibit.id),
    ]);
    setConfirmDelete(false);
  }, [powerSync, exhibit.id]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
      {confirmDelete && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Exhibit</AlertDialogTitle>
              <AlertDialogDescription>
                Delete "{title}"? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {isUrl ? (
        <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <span className="font-mono text-xs text-muted-foreground w-6">
        {index + 1}.
      </span>
      <span className="flex-1 truncate">{title}</span>
      <span className="text-xs text-muted-foreground">
        {EXHIBIT_TYPE_LABELS[exhibitType] ?? exhibitType}
      </span>
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
