/**
 * Upload an exhibit.
 *
 * ─── Stage 1, Task D1e ────────────────────────────────────────────────────
 *
 * This used to call `supabase.storage.from("exhibits").upload(...)`. There is
 * no `exhibits` bucket: the only bucket any migration creates is `documents`
 * (`supabase/migrations/20260311000003_session_0603_storage_bucket.sql:8`), so
 * every exhibit upload this product has ever attempted failed at that line —
 * and then `ExhibitUploader` swallowed the error in a bare `catch {}`, which
 * is why nobody noticed.
 *
 * It now posts to the API, which resolves the agenda item's BOARD, applies
 * rule 15 for that board (A3, or the `board_member` role — a member may upload
 * their own material), sniffs the file's actual bytes, enforces the 5 MB limit
 * server-side, and writes into the authorized document root. The row is
 * inserted by the same request, inside the same tenant transaction, so an
 * upload can no longer half-succeed into a file with no row.
 *
 * The hook returns the created exhibit rather than a path, because the caller
 * no longer inserts anything.
 */

import { useCallback, useState } from "react";
import { apiJson } from "@/lib/api-client";

export interface CreatedExhibit {
  id: string;
  agendaItemId: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  visibility: string;
  sortOrder: number;
}

export interface ExhibitUploadInput {
  file: File;
  agendaItemId: string;
  title?: string;
  exhibitType?: string;
  visibility?: "public" | "board_only" | "admin_only";
}

interface UseExhibitUploadReturn {
  upload: (input: ExhibitUploadInput) => Promise<CreatedExhibit>;
  isUploading: boolean;
  error: string | null;
}

export function useExhibitUpload(): UseExhibitUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (input: ExhibitUploadInput): Promise<CreatedExhibit> => {
    setIsUploading(true);
    setError(null);

    try {
      const form = new FormData();
      // The file part last, so the server has the text fields before it
      // reaches the bytes — it streams the parts in order.
      form.append("agendaItemId", input.agendaItemId);
      if (input.title) form.append("title", input.title);
      if (input.exhibitType) form.append("exhibitType", input.exhibitType);
      form.append("visibility", input.visibility ?? "public");
      form.append("file", input.file, input.file.name);

      return await apiJson<CreatedExhibit>("/api/files/exhibits", {
        method: "POST",
        formData: form,
      });
    } catch (err) {
      // The API's own message, which names the limit or the accepted types.
      // The previous version replaced it with "Upload failed".
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      throw err;
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { upload, isUploading, error };
}

/** Where an exhibit's file is fetched from. Authorized on every request. */
export function exhibitDownloadUrl(exhibitId: string): string {
  return `/api/files/exhibits/${exhibitId}`;
}
