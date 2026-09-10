/**
 * ExhibitRow — displays a single exhibit, with a download link and a delete
 * action.
 *
 * ─── Stage 1, Task D1e ────────────────────────────────────────────────────
 *
 * Delete moved off PostgREST and onto the API. Two reasons, and the second is
 * the one that matters: an exhibit is a row AND a file, and deleting the row
 * from the client left the file behind forever with nothing pointing at it.
 * The API deletes both, in that order, inside one tenant transaction. It also
 * applies rule 16 (A3 for that board) rather than rule 15's wider "A3 or a
 * board seat" — a member may upload their own material, not remove the
 * clerk's.
 *
 * The download link is new. An uploaded exhibit had no way to be read back at
 * all, because the bucket it was written to never existed.
 *
 * Phase E, wave 4, Task 3: the DELETE stays exactly where it is — a tRPC
 * resolver cannot remove the bytes after the transaction commits, which is
 * the defect D1e was built to fix (see `exhibit.ts`'s header for the full
 * reasoning). What changed here is the CACHE KEY it owes: the agenda builder
 * now reads its exhibits through `trpc.exhibit.byMeeting`, so this writer
 * gained `trpc.exhibit.pathFilter()` alongside its legacy per-item key
 * (conventions item 7 — a read owns its key, and the writer that abandons it
 * updates in the same commit). The `exhibit` prop is the procedure's own row
 * type rather than `Record<string, unknown>`, per item 10.
 */

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/api-client";
import { exhibitDownloadUrl } from "@/hooks/useExhibitUpload";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import type { MeetingExhibit } from "./agenda-types";
import { Download, FileText, Link as LinkIcon, Trash2 } from "lucide-react";
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
  exhibit: MeetingExhibit;
  index: number;
  readOnly: boolean;
}

export function ExhibitRow({ exhibit, index, readOnly }: ExhibitRowProps) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const title = exhibit.title || `Exhibit ${index + 1}`;
  const exhibitType = exhibit.exhibit_type ?? "other";
  const isUrl = exhibit.file_type === "url";

  const handleDelete = useCallback(async () => {
    try {
      await apiJson(`/api/files/exhibits/${exhibit.id}`, { method: "DELETE" });
    } catch (err) {
      // The API's refusal names the permission and who can grant it.
      setDeleteError(err instanceof Error ? err.message : "Could not delete this exhibit.");
      return;
    }
    const agendaItemId = exhibit.agenda_item_id;
    if (agendaItemId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byItem(agendaItemId) });
    }
    // DELETEs an `exhibit` row, which is what the agenda builder's own
    // `exhibit.byMeeting` read returns (wave 4, Task 3).
    void queryClient.invalidateQueries(trpc.exhibit.pathFilter());
    setConfirmDelete(false);
  }, [queryClient, exhibit.id, exhibit.agenda_item_id]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
      {confirmDelete && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Exhibit</AlertDialogTitle>
              <AlertDialogDescription>
                Delete "{title}"? This cannot be undone.
                {deleteError && <span className="mt-2 block text-destructive">{deleteError}</span>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button variant="destructive" onClick={() => void handleDelete()}>
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
      <span className="font-mono text-xs text-muted-foreground w-6">{index + 1}.</span>
      <span className="flex-1 truncate">{title}</span>
      <span className="text-xs text-muted-foreground">
        {EXHIBIT_TYPE_LABELS[exhibitType] ?? exhibitType}
      </span>
      {isUrl ? (
        <a
          href={exhibit.file_storage_path}
          target="_blank"
          rel="noreferrer noopener"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Open ${title}`}
        >
          <LinkIcon className="h-3 w-3" />
        </a>
      ) : (
        <a
          href={exhibitDownloadUrl(exhibit.id)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Download ${title}`}
        >
          <Download className="h-3 w-3" />
        </a>
      )}
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete ${title}`}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
