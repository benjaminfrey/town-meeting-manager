/**
 * Minutes PDF generation service.
 *
 * Uses the shared Puppeteer infrastructure from session 06.03.
 *
 * ─── Stage 1, Task D1e — where these bytes now live ───────────────────────
 *
 * This used to upload to the Supabase `documents` bucket, which is declared
 * `public = true`
 * (`supabase/migrations/20260311000003_session_0603_storage_bucket.sql:9`), at
 * `${townId}/meetings/${meetingId}/minutes-${Date.now()}.pdf`. Both ids are
 * published by the public portal, so the only thing standing between an
 * anonymous fetch and a town's DRAFT minutes — the unadopted record of an
 * executive session — was a millisecond timestamp.
 *
 * It now writes into the authorized document root, which nginx marks
 * `internal`. Nothing outside this process can request a file there; the only
 * way to one is `GET /api/files/minutes/:documentId`, which applies rule 9
 * (R4 for that board, or the document is approved or published) and then names
 * the file with `X-Accel-Redirect`.
 *
 * The path still carries the town and the meeting, because an operator needs
 * to see whose bytes are whose. It is not a secret and nothing depends on it
 * being one.
 */

import { generatePdf } from "./puppeteer.js";
import { documentRoot, minutesRelativePath } from "../storage/paths.js";
import { writeFileDurably } from "../storage/store.js";

export interface MinutesPdfOptions {
  townName: string;
  boardName: string;
  meetingDate: string;
  isDraft: boolean;
}

/**
 * Generate a minutes PDF and store it in the authorized document root.
 *
 * @returns The storage path, relative to that root, for `pdf_storage_path`.
 */
export async function generateMinutesPdf(
  html: string,
  meetingId: string,
  townId: string,
  minutesDocumentId: string,
  options: MinutesPdfOptions,
): Promise<string> {
  const formattedDate = formatDateForHeader(options.meetingDate);
  const draftLabel = options.isDraft ? "  —  DRAFT" : "";

  const headerTemplate = `
    <div style="font-size:8px; width:100%; padding:0 0.5in; display:flex; justify-content:space-between; color:#666;">
      <span>${escapeHtml(options.townName)} — ${escapeHtml(options.boardName)}</span>
      <span>Meeting Minutes</span>
      <span>${escapeHtml(formattedDate)}${draftLabel}</span>
    </div>
  `;

  const footerTemplate = `
    <div style="font-size:8px; width:100%; padding:0 0.5in; display:flex; justify-content:space-between; color:#666;">
      <span></span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      <span>${options.isDraft ? "DRAFT" : ""}</span>
    </div>
  `;

  const pdf = await generatePdf(html, {
    headerTemplate,
    footerTemplate,
  });

  // One path per minutes document, not per generation: the owner's decision
  // is replace-not-versioned, so regenerating supersedes the previous file
  // rather than accumulating a directory of timestamped drafts nothing points
  // at. `writeFileDurably` renames the new file over the old one atomically,
  // so a reader sees the whole old PDF or the whole new one.
  const storagePath = minutesRelativePath(townId, meetingId, minutesDocumentId);
  await writeFileDurably(documentRoot(), storagePath, pdf);

  return storagePath;
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatDateForHeader(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
