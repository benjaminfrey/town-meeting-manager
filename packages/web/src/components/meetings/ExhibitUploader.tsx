/**
 * ExhibitUploader — manages exhibits attached to an agenda item.
 *
 * Shows numbered exhibit list and supports file upload or URL reference.
 * Client-side validation: PDF/JPEG/PNG/DOCX/XLSX, max 10MB.
 */

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { Loader2, Plus, Link as LinkIcon } from "lucide-react";
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
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

interface ExhibitUploaderProps {
  agendaItemId: string;
  meetingId: string;
  townId: string;
  exhibits: Record<string, unknown>[];
  readOnly: boolean;
}

export function ExhibitUploader({
  agendaItemId,
  meetingId,
  townId,
  exhibits,
  readOnly,
}: ExhibitUploaderProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { upload, isUploading } = useExhibitUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [isUrl, setIsUrl] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [exhibitType, setExhibitType] = useState("supporting_document");
  const [fileError, setFileError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setIsAdding(false);
    setIsUrl(false);
    setTitle("");
    setUrl("");
    setExhibitType("supporting_document");
    setFileError(null);
  }, []);

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
        setFileError("File must be under 10MB.");
        return;
      }

      try {
        const storagePath = await upload(file, townId, meetingId, agendaItemId);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const { error } = await supabase.from('exhibit').insert({
          id,
          agenda_item_id: agendaItemId,
          town_id: townId,
          title: title || file.name,
          file_storage_path: storagePath,
          file_type: file.type,
          file_size: file.size,
          file_name: file.name,
          exhibit_type: exhibitType,
          visibility: 'public',
          sort_order: exhibits.length,
          created_at: now,
        });
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byItem(agendaItemId) });
        resetForm();
      } catch {
        // Error handled by useExhibitUpload
      }
    },
    [upload, supabase, queryClient, townId, meetingId, agendaItemId, title, exhibitType, exhibits.length, resetForm],
  );

  const handleAddUrl = useCallback(async () => {
    if (!title.trim() || !url.trim()) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error } = await supabase.from('exhibit').insert({
      id,
      agenda_item_id: agendaItemId,
      town_id: townId,
      title: title.trim(),
      file_storage_path: url.trim(),
      file_type: 'url',
      file_size: 0,
      file_name: null,
      exhibit_type: exhibitType,
      visibility: 'public',
      sort_order: exhibits.length,
      created_at: now,
    });
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byItem(agendaItemId) });
    resetForm();
  }, [title, url, exhibitType, agendaItemId, townId, exhibits.length, supabase, queryClient, resetForm]);

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
            <ExhibitRow
              key={String(exhibit.id)}
              exhibit={exhibit}
              index={i}
              readOnly={readOnly}
            />
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
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">File</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
                    onChange={(e) => void handleFileSelect(e)}
                    className="text-sm"
                  />
                  {fileError && (
                    <p className="text-xs text-destructive">{fileError}</p>
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
                      onClick={() => void handleAddUrl()}
                      disabled={!title.trim() || !url.trim()}
                    >
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
