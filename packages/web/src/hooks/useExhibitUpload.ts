/**
 * Hook for uploading exhibit files to Supabase Storage.
 *
 * Uploads to: exhibits/{town_id}/meetings/{meeting_id}/items/{agenda_item_id}/{filename}
 */

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";

interface UseExhibitUploadReturn {
  upload: (
    file: File,
    townId: string,
    meetingId: string,
    agendaItemId: string,
  ) => Promise<string>;
  isUploading: boolean;
  error: string | null;
}

export function useExhibitUpload(): UseExhibitUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (
      file: File,
      townId: string,
      meetingId: string,
      agendaItemId: string,
    ): Promise<string> => {
      setIsUploading(true);
      setError(null);

      try {
        const path = `${townId}/meetings/${meetingId}/items/${agendaItemId}/${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("exhibits")
          .upload(path, file, { upsert: true });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        return path;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        throw err;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return { upload, isUploading, error };
}
