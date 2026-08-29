/**
 * TownSealUpload — upload and display the town seal image.
 *
 * ─── Stage 1, Task D1e ────────────────────────────────────────────────────
 *
 * This used to call `supabase.storage.from("town-seals")`. There is no
 * `town-seals` bucket — the only bucket any migration creates is `documents`
 * (`supabase/migrations/20260311000003_session_0603_storage_bucket.sql:8`) —
 * so every seal upload this product has ever attempted failed, and the error
 * surfaced as a raw storage message under the drop zone.
 *
 * It now posts to `POST /api/files/town-seal`, which is admin-gated by the
 * same `assertCanUpdateTown` rule every other change to the town record uses,
 * checks the size and the image type from the file's actual BYTES, and writes
 * the one thing allowed into the public asset root. The API also sets
 * `town.seal_url`; this component no longer writes to the `town` table.
 *
 * SVG is no longer offered. An SVG can carry script and the seal is served
 * from this application's own origin, so accepting one would have let a town
 * administrator upload script to the app's hostname. PNG and JPEG cover every
 * real seal and are what mail clients and Chromium render.
 *
 * The checks below are a courtesy that saves a round trip, not the
 * enforcement.
 */

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, X, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api-client";
import { queryKeys } from "@/lib/queryKeys";

// Matches MAX_UPLOAD_BYTES on the server.
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ["image/png", "image/jpeg"];

interface TownSealUploadProps {
  townId: string;
  sealUrl: string | null;
}

export function TownSealUpload({ townId, sealUrl }: TownSealUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      // No town id in the body. The server takes it from the caller's own
      // resolved tenant, so this request cannot name another town's seal.
      await apiJson<{ sealUrl: string }>("/api/files/town-seal", {
        method: "POST",
        formData: form,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await apiJson("/api/files/town-seal", { method: "DELETE" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Remove failed. Please try again.");
    },
  });

  const isUploading = uploadMutation.isPending || removeMutation.isPending;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please upload a PNG or JPEG image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("File must be less than 5 MB.");
      return;
    }

    setError(null);
    uploadMutation.mutate(file);
  };

  return (
    <div className="space-y-3">
      {sealUrl ? (
        /* Current seal preview */
        <div className="flex items-start gap-4">
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
            <img src={sealUrl} alt="Town seal" className="h-full w-full object-contain" />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Town seal uploaded</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeMutation.mutate()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="mr-2 h-3.5 w-3.5" />
              )}
              Remove
            </Button>
          </div>
        </div>
      ) : (
        /* Empty state / upload */
        <div
          className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">
              {isUploading ? "Uploading..." : "Upload town seal"}
            </p>
            <p className="text-xs text-muted-foreground">PNG or JPEG. Max 5 MB.</p>
          </div>
          {!isUploading && (
            <Button variant="outline" size="sm" type="button">
              <Upload className="mr-2 h-3.5 w-3.5" />
              Choose file
            </Button>
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => void handleFileSelect(e)}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
