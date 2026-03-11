/**
 * Minutes PDF generation service.
 *
 * Uses the shared Puppeteer infrastructure from session 06.03.
 * Generates a PDF from minutes HTML and uploads to Supabase Storage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePdf } from "./puppeteer.js";

export interface MinutesPdfOptions {
  townName: string;
  boardName: string;
  meetingDate: string;
  isDraft: boolean;
}

/**
 * Generate a PDF from minutes HTML and upload to Supabase Storage.
 *
 * @returns The storage path for the uploaded PDF.
 */
export async function generateMinutesPdf(
  supabase: SupabaseClient,
  html: string,
  meetingId: string,
  townId: string,
  _boardId: string,
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

  // Upload to Supabase Storage
  const timestamp = Date.now();
  const storagePath = `${townId}/meetings/${meetingId}/minutes-${timestamp}.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from("documents")
    .upload(storagePath, pdf, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadErr) {
    throw new Error(`Failed to upload minutes PDF: ${uploadErr.message}`);
  }

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
    .replace(/"/g, "&quot;");
}
