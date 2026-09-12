/**
 * ExhibitUploader — manages exhibits attached to an agenda item.
 *
 * Shows numbered exhibit list and supports file upload or URL reference.
 *
 * The checks below are a courtesy that saves a round trip. They are NOT the
 * enforcement: the API re-checks the size and sniffs the file's actual bytes,
 * because anything a component decides is a decision the client makes about
 * itself. See `useExhibitUpload` and `packages/api/src/storage/paths.ts`.
 *
 * ─── Phase E, wave 4, Task 3 — the second creation path, closed ──────────
 *
 * `handleAddUrl` was a SECOND, unauthorized creation path for the same table
 * the file upload writes properly: a raw `exhibit` INSERT through the dead
 * Supabase client with no rule, no existence check on `agenda_item_id` (FK
 * enforcement bypasses RLS — conventions item 3), a client-supplied
 * `town_id`, `uploaded_by` left NULL, and a `sort_order` taken from the
 * length of a client-side array. `exhibit_tenant_isolation` is tenancy-only,
 * so nothing else was checking either.
 *
 * It is now `exhibit.link` (wave 4, Task 2), which applies the SAME rule 15
 * against the SAME board the upload endpoint derives, checks the agenda item
 * exists in this tenant, takes `town_id`/`uploaded_by`/`sort_order` from the
 * server, and validates the URL as `http`/`https` (this component renders it
 * straight into an `href`). The refusal is shown — rule 15 is A3 for this
 * board OR a board seat, so a staff member with neither is refused for the
 * first time and an "Add Link" button that quietly did nothing would be the
 * silent-refusal failure wave 3 shipped twice.
 *
 * The `exhibits` prop now comes from `exhibit.byMeeting`, filtered by rule 14
 * — see `routes/meetings.$meetingId.agenda.tsx`'s header for what that
 * changes for a clerk. The FILE upload stays at the D1e endpoint (multipart,
 * byte sniffing, the 5 MB ceiling, the row written in the same transaction as
 * the bytes) and the DELETE stays in `ExhibitRow.tsx`; see `exhibit.ts`'s
 * header for why neither moves.
 */

import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage } from "@/lib/trpc";
import type { MeetingExhibit } from "./agenda-types";
import { Loader2, Plus } from "lucide-react";
import { ExhibitRow } from "./ExhibitRow";
import { useExhibitUpload } from "@/hooks/useExhibitUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EXHIBIT_TYPE_LABELS } from "./meeting-labels";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — matches MAX_UPLOAD_BYTES on the server

interface ExhibitUploaderProps {
  agendaItemId: string;
  meetingId: string;
  /** The agenda item's board — `exhibit.link` authorizes against it. */
  boardId: string;
  exhibits: MeetingExhibit[];
  readOnly: boolean;
}

export function ExhibitUploader({
  agendaItemId,
  meetingId,
  boardId,
  exhibits,
  readOnly,
}: ExhibitUploaderProps) {
  const queryClient = useQueryClient();
  const { upload, isUploading } = useExhibitUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The "File" label had no `htmlFor` and the input no `id`, so the two were
  // never associated — a real accessibility gap, and the reason a test could
  // not find the control by its label. Per item, so two expanded items on one
  // screen do not share an id.
  const fileInputId = `exhibit-file-${agendaItemId}`;

  const [isAdding, setIsAdding] = useState(false);
  const [isUrl, setIsUrl] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [exhibitType, setExhibitType] = useState("supporting_document");
  const [fileError, setFileError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  /**
   * The legacy per-item key plus the router filter (conventions item 7).
   * `queryKeys.exhibits.*` has no reader left — `review.tsx`, its last one,
   * moved to `trpc.exhibit.byMeeting` in Phase E wave 6, Task 4. The line
   * stays for the reason `cache-key-parity.test.ts`'s "Why a dead legacy
   * line is not removed on sight" gives; the router filter is what reaches
   * this screen's own `exhibit.byMeeting` read.
   */
  const invalidateExhibits = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byItem(agendaItemId) });
    void queryClient.invalidateQueries(trpc.exhibit.pathFilter());
  }, [queryClient, agendaItemId]);

  const resetForm = useCallback(() => {
    setIsAdding(false);
    setIsUrl(false);
    setTitle("");
    setUrl("");
    setExhibitType("supporting_document");
    setFileError(null);
    setLinkError(null);
  }, []);

  const addLink = useMutation(
    trpc.exhibit.link.mutationOptions({
      onSuccess: () => {
        invalidateExhibits();
        resetForm();
      },
      onError: (err) => setLinkError(refusalMessage(err, "attach a link to this item")),
    }),
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileError(null);

      if (!ALLOWED_TYPES.includes(file.type)) {
        setFileError("Only PDF, JPEG, PNG, DOCX, and XLSX files are allowed.");
        return;
      }
      if (file.size > MAX_SIZE) {
        setFileError("File must be under 5 MB.");
        return;
      }

      try {
        // One request: the API applies rule 15 for this item's BOARD, checks
        // the bytes and the size limit server-side, stores the file in the
        // authorized document root and inserts the row — all inside one tenant
        // transaction. The client no longer writes the `exhibit` row itself,
        // so an upload can no longer leave a row pointing at a file that was
        // never stored (or, as it happened, a file that never stored because
        // the bucket did not exist).
        await upload({ file, agendaItemId, title, exhibitType, visibility: "public" });
        // Creates an `exhibit` row, which is what this screen's own
        // `exhibit.byMeeting` read returns — the D1e endpoint is a different
        // transport, not a different table (conventions item 7).
        invalidateExhibits();
        resetForm();
      } catch (err) {
        // Shown, not swallowed. The previous `catch {}` here is why nobody
        // noticed that every exhibit upload had always failed.
        setFileError(err instanceof Error ? err.message : "Upload failed.");
      }
    },
    [upload, invalidateExhibits, agendaItemId, title, exhibitType, resetForm],
  );

  const handleAddUrl = useCallback(() => {
    if (!title.trim() || !url.trim()) return;
    setLinkError(null);
    // `visibility` is not sent: the procedure defaults to `'public'`, which
    // is what the raw insert hardcoded. Offering the other two tiers here
    // would be a feature, not a migration — see `exhibit.link`'s doc comment.
    addLink.mutate({
      boardId,
      agendaItemId,
      title: title.trim(),
      url: url.trim(),
      exhibitType,
    });
  }, [title, url, exhibitType, agendaItemId, boardId, addLink]);

  if (readOnly && exhibits.length === 0) return null;

  return (
    <div className="border-t mt-3 pt-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Exhibits ({exhibits.length})
      </p>

      {/* Exhibit list */}
      {exhibits.length > 0 && (
        <div className="space-y-0.5 mb-2">
          {exhibits.map((exhibit, i) => (
            <ExhibitRow key={exhibit.id} exhibit={exhibit} index={i} readOnly={readOnly} />
          ))}
        </div>
      )}

      {/* Add exhibit */}
      {!readOnly && (
        <>
          {isAdding ? (
            <div className="space-y-2 rounded border bg-muted/10 p-3">
              <div className="space-y-1">
                <Label className="text-xs">Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Exhibit title"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={exhibitType} onValueChange={setExhibitType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXHIBIT_TYPE_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isUrl ? (
                <div className="space-y-1">
                  <Label className="text-xs">URL</Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://..."
                  />
                  {linkError && (
                    <p className="text-xs text-destructive" role="alert">
                      {linkError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={fileInputId}>
                    File
                  </Label>
                  <input
                    id={fileInputId}
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
                    onChange={(e) => void handleFileSelect(e)}
                    className="text-sm"
                  />
                  {fileError && (
                    <p className="text-xs text-destructive" role="alert">
                      {fileError}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setIsUrl(!isUrl)}
                >
                  {isUrl ? "Upload file instead" : "Link URL instead"}
                </button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={resetForm}>
                    Cancel
                  </Button>
                  {isUrl && (
                    <Button
                      size="sm"
                      onClick={handleAddUrl}
                      disabled={!title.trim() || !url.trim() || addLink.isPending}
                    >
                      {addLink.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      Add Link
                    </Button>
                  )}
                  {isUploading && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Exhibit
            </Button>
          )}
        </>
      )}
    </div>
  );
}
