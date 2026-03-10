/**
 * TownSealUpload — upload and display the town seal image.
 *
 * Uploads to Supabase Storage bucket "town-seals" under {town_id}/seal.{ext}.
 * Updates the TOWN record with seal_url on success.
 */

import { useCallback, useRef, useState } from "react";
import { usePowerSync } from "@powersync/react";
import { Upload, X, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/hooks/useSupabase";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

interface TownSealUploadProps {
  townId: string;
  sealUrl: string | null;
}

export function TownSealUpload({ townId, sealUrl }: TownSealUploadProps) {
  const supabase = useSupabase();
  const powerSync = usePowerSync();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Client-side validation
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError("Please upload a PNG, JPEG, or SVG image.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("File must be less than 2 MB.");
        return;
      }

      setError(null);
      setIsUploading(true);

      try {
        const ext = file.name.split(".").pop() ?? "png";
        const storagePath = `${townId}/seal.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("town-seals")
          .upload(storagePath, file, { upsert: true });

        if (uploadError) throw uploadError;

        // Get the public URL
        const { data: urlData } = supabase.storage
          .from("town-seals")
          .getPublicUrl(storagePath);

        const publicUrl = urlData.publicUrl;

        // Update town record locally
        await powerSync.execute(
          `UPDATE towns SET seal_url = ?, updated_at = ? WHERE id = ?`,
          [publicUrl, new Date().toISOString(), townId]
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Upload failed. Please try again."
        );
      } finally {
        setIsUploading(false);
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [supabase, powerSync, townId]
  );

  const handleRemove = useCallback(async () => {
    setIsUploading(true);
    try {
      // Remove from storage
      const { error: removeError } = await supabase.storage
        .from("town-seals")
        .remove([`${townId}/seal.png`, `${townId}/seal.jpg`, `${townId}/seal.jpeg`, `${townId}/seal.svg`]);

      if (removeError) throw removeError;

      // Clear URL in town record
      await powerSync.execute(
        `UPDATE towns SET seal_url = NULL, updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), townId]
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Remove failed. Please try again."
      );
    } finally {
      setIsUploading(false);
    }
  }, [supabase, powerSync, townId]);

  return (
    <div className="space-y-3">
      {sealUrl ? (
        /* Current seal preview */
        <div className="flex items-start gap-4">
          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
            <img
              src={sealUrl}
              alt="Town seal"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Town seal uploaded</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRemove()}
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
            <p className="text-xs text-muted-foreground">
              PNG, JPEG, or SVG. Max 2 MB.
            </p>
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
        accept=".png,.jpg,.jpeg,.svg"
        className="hidden"
        onChange={(e) => void handleFileSelect(e)}
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
