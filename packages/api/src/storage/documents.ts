/**
 * Stage 1, Task D1e — the authorized document operations.
 *
 * Every function here takes a `TenantTx` (so RLS is underneath it) and an
 * `Actor` (so the rules in `trpc/authorization/rules.ts` can be asked), and
 * NONE of them takes a path from the caller. That is the division the whole
 * task turns on:
 *
 *   - **tenancy** is RLS's, underneath these queries;
 *   - **permission** is `rules.ts`'s, restored in D1 and reused verbatim here
 *     — this file adds no authorization of its own;
 *   - **the path** is this module's, derived from ids that came out of the
 *     database rather than off the wire.
 *
 * Deliberately separated from `routes/files.ts` so the rules can be exercised
 * against a real database and real `loadActor()` actors without standing up
 * HTTP. The route file is the thin half; if a check ever appears there and not
 * here, it is in the wrong place.
 *
 * ─── The board join, and why every read does one ──────────────────────────
 *
 * `assertCanSelectExhibit` and `assertCanSelectMinutesDocument` are
 * board-scoped: R4 and A3 are granted per board by both shipped
 * `designated_boards` templates and globally by neither, so a global check
 * answers "no" to every recording secretary the product has ever created. The
 * board is not on either row in a form we may read — `minutes_document.board_id`
 * is nullable and denormalised, and `exhibit` has no board column at all — so
 * both queries join through `meeting.board_id`, which is NOT NULL. See
 * `BoardScopedRow` in `rules.ts`.
 */

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { TenantTx } from "../db/with-tenant.js";
import { toRows } from "../db/rows.js";
import type { Actor } from "../trpc/authorization/actor.js";
import {
  assertCanInsertExhibit,
  assertCanSelectExhibit,
  assertCanSelectMeetingDocument,
  assertCanSelectMinutesDocument,
  assertCanUpdateExhibit,
  assertCanUpdateTown,
  type ExhibitVisibility,
  type MinutesStatus,
} from "../trpc/authorization/rules.js";
import {
  MAX_UPLOAD_BYTES,
  EXHIBIT_CONTENT_TYPES,
  StoragePathError,
  agendaPacketRelativePath,
  allSealRelativePaths,
  documentRoot,
  exhibitRelativePath,
  meetingNoticeRelativePath,
  publicAssetRoot,
  sealExtensionFor,
  sealRelativePath,
  sealUrlFor,
  sniffFamily,
} from "./paths.js";
import { removeFileIfPresent, withWrittenFile } from "./store.js";

/**
 * The record was not found — or was found in another town, which RLS makes
 * indistinguishable, and deliberately so.
 *
 * A cross-tenant read and a nonexistent id must produce the SAME answer. If
 * town B's minutes id answered 403 while a random uuid answered 404, the pair
 * of responses would confirm that the id exists — a membership oracle over
 * every other town's records.
 */
export class DocumentNotFoundError extends Error {
  override readonly name = "DocumentNotFoundError";
}

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refuse an id that is not a UUID, with the SAME error a missing row produces.
 *
 * Two reasons, in order of importance. First: without it the id goes into a
 * `WHERE id = $1` against a `uuid` column, Postgres raises a type error, and
 * the route answers 500 — so `/api/files/minutes/../../etc/passwd` reads as an
 * outage rather than as a bad request, and every scanner probing the surface
 * produces a page of driver errors in the log. Second: it must be the same
 * error as "no such row", because a distinguishable answer for "malformed" and
 * "not yours" is the beginning of an oracle.
 */
function requireLookupId(value: string, what: string): string {
  if (typeof value !== "string" || !UUID_ID.test(value)) {
    throw new DocumentNotFoundError(`No such ${what}.`);
  }
  return value;
}

/** A file this module is prepared to serve. */
export interface StoredDocument {
  relativePath: string;
  filename: string;
  contentType: string;
  disposition: "inline" | "attachment";
}

// ─── Minutes ──────────────────────────────────────────────────────────

interface MinutesRow {
  id: string;
  status: MinutesStatus;
  board_id: string;
  pdf_storage_path: string | null;
  scheduled_date: string | null;
}

/**
 * Resolve a minutes PDF for download, refusing a caller who may not read it.
 *
 * The rule is rule 9: R4 for that board, or the document is `approved` or
 * `published`. A draft is the single most sensitive document this product
 * holds — unadopted minutes of an executive session — and until this task it
 * was fetchable by path from a public bucket.
 */
export async function resolveMinutesDocumentForDownload(
  tx: TenantTx,
  actor: Actor,
  minutesDocumentId: string,
): Promise<StoredDocument> {
  requireLookupId(minutesDocumentId, "minutes document");
  const rows = toRows<MinutesRow>(
    await tx.execute(sql`
      SELECT md.id,
             md.status::text AS status,
             m.board_id,
             md.pdf_storage_path,
             m.scheduled_date::text AS scheduled_date
      FROM minutes_document md
      JOIN meeting m ON m.id = md.meeting_id
      WHERE md.id = ${minutesDocumentId}
    `),
    (message) => new Error(`resolveMinutesDocumentForDownload: ${message}`),
  );

  const row = rows[0];
  if (!row) throw new DocumentNotFoundError("No such minutes document.");

  assertCanSelectMinutesDocument(actor, { status: row.status, boardId: row.board_id });

  if (!row.pdf_storage_path) {
    throw new DocumentNotFoundError("These minutes have no generated PDF yet.");
  }

  return {
    relativePath: row.pdf_storage_path,
    filename: `minutes-${row.scheduled_date ?? row.id}.pdf`,
    contentType: "application/pdf",
    disposition: "inline",
  };
}

// ─── The generated meeting documents ──────────────────────────────────

interface MeetingDocumentRowRecord {
  town_id: string;
  board_id: string;
  agenda_status: string | null;
  meeting_status: string;
  scheduled_date: string | null;
  agenda_packet_url: string | null;
  meeting_notice_url: string | null;
}

/** Which of the two generated documents a caller is asking for. */
export type MeetingDocumentKind = "agenda-packet" | "meeting-notice";

const MEETING_DOCUMENT_SPEC: Record<
  MeetingDocumentKind,
  {
    label: string;
    generatedColumn: (row: MeetingDocumentRowRecord) => string | null;
    relativePath: (townId: string, meetingId: string) => string;
  }
> = {
  "agenda-packet": {
    label: "agenda packet",
    generatedColumn: (row) => row.agenda_packet_url,
    relativePath: agendaPacketRelativePath,
  },
  "meeting-notice": {
    label: "meeting notice",
    generatedColumn: (row) => row.meeting_notice_url,
    relativePath: meetingNoticeRelativePath,
  },
};

/**
 * Resolve an agenda packet or a meeting notice, refusing a caller rule 9b
 * excludes.
 *
 * Stage 1, Task D1f. The path is DERIVED — `agenda-packets/<townId>/<meetingId>.pdf`
 * — rather than read out of a column, because there is no column for it and
 * adding one would store a fact that is already implied by two ids the query
 * just returned. One document per meeting, replace-not-versioned, which is the
 * same decision `services/minutes-pdf.ts` records for minutes.
 *
 * The `*_url` column is still consulted, for exactly one thing: whether the
 * document has ever been generated. A meeting whose packet was never generated
 * must answer 404 rather than "the file is missing", and that distinction is
 * only knowable from the row.
 */
export async function resolveMeetingDocumentForDownload(
  tx: TenantTx,
  actor: Actor,
  kind: MeetingDocumentKind,
  meetingId: string,
): Promise<StoredDocument> {
  const spec = MEETING_DOCUMENT_SPEC[kind];
  requireLookupId(meetingId, "meeting");

  const row = toRows<MeetingDocumentRowRecord>(
    await tx.execute(sql`
      SELECT m.town_id,
             m.board_id,
             m.agenda_status,
             m.status::text AS meeting_status,
             m.scheduled_date::text AS scheduled_date,
             m.agenda_packet_url,
             m.meeting_notice_url
      FROM meeting m
      WHERE m.id = ${meetingId}
    `),
    (message) => new Error(`resolveMeetingDocumentForDownload: ${message}`),
  )[0];

  if (!row) throw new DocumentNotFoundError("No such meeting.");

  assertCanSelectMeetingDocument(actor, {
    boardId: row.board_id,
    agendaStatus: row.agenda_status,
    meetingStatus: row.meeting_status,
  });

  if (!spec.generatedColumn(row)) {
    throw new DocumentNotFoundError(`This meeting has no generated ${spec.label} yet.`);
  }

  return {
    relativePath: spec.relativePath(row.town_id, meetingId),
    filename: `${kind}-${row.scheduled_date ?? meetingId}.pdf`,
    contentType: "application/pdf",
    disposition: "inline",
  };
}

// ─── Exhibits ─────────────────────────────────────────────────────────

interface ExhibitRowRecord {
  id: string;
  town_id: string;
  agenda_item_id: string;
  board_id: string;
  visibility: ExhibitVisibility;
  file_storage_path: string;
  file_type: string;
  file_name: string | null;
  title: string;
}

async function loadExhibit(tx: TenantTx, exhibitId: string): Promise<ExhibitRowRecord> {
  requireLookupId(exhibitId, "exhibit");
  const rows = toRows<ExhibitRowRecord>(
    await tx.execute(sql`
      SELECT e.id, e.town_id, e.agenda_item_id, e.visibility::text AS visibility,
             e.file_storage_path, e.file_type, e.file_name, e.title,
             m.board_id
      FROM exhibit e
      JOIN agenda_item ai ON ai.id = e.agenda_item_id
      JOIN meeting m ON m.id = ai.meeting_id
      WHERE e.id = ${exhibitId}
    `),
    (message) => new Error(`loadExhibit: ${message}`),
  );
  const row = rows[0];
  if (!row) throw new DocumentNotFoundError("No such exhibit.");
  return row;
}

/**
 * Resolve an exhibit's file, refusing a caller the visibility tier excludes.
 *
 * Rule 14, unchanged and not reimplemented: `public` to any member of the
 * town, `board_only` to an administrator or A3-for-that-board or a board
 * member, `admin_only` to an administrator or A3-for-that-board. The board
 * comes from the meeting, so a clerk holding A3 on the Planning Board cannot
 * read the Select Board's `admin_only` memo.
 */
export async function resolveExhibitForDownload(
  tx: TenantTx,
  actor: Actor,
  exhibitId: string,
): Promise<StoredDocument> {
  const row = await loadExhibit(tx, exhibitId);

  assertCanSelectExhibit(actor, { visibility: row.visibility, boardId: row.board_id });

  if (row.file_type === "url") {
    // A "URL exhibit" stores a link in `file_storage_path`, not a path. This
    // endpoint will not fetch it: proxying an operator-supplied URL through an
    // authenticated route is a server-side request forgery, and redirecting to
    // it is an open redirect. The client has the row and links out directly.
    throw new StoragePathError(
      "This exhibit is a link rather than an uploaded file. Open its URL directly.",
    );
  }

  return {
    relativePath: row.file_storage_path,
    filename: row.file_name ?? row.title,
    contentType: exhibitContentType(row.file_storage_path),
    // `attachment` for everything, including PDFs: an exhibit is
    // client-supplied and rendering it inline on the application's own origin
    // is how an uploaded file becomes a same-origin page.
    disposition: "attachment",
  };
}

function exhibitContentType(relativePath: string): string {
  const ext = relativePath.split(".").pop()?.toLowerCase();
  for (const [type, spec] of Object.entries(EXHIBIT_CONTENT_TYPES)) {
    if (spec.ext === ext) return type;
  }
  return "application/octet-stream";
}

export interface CreateExhibitInput {
  agendaItemId: string;
  title: string;
  exhibitType: string | null;
  visibility: ExhibitVisibility;
  declaredContentType: string;
  originalFilename: string;
  bytes: Uint8Array;
}

export interface CreatedExhibit {
  id: string;
  agendaItemId: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  visibility: ExhibitVisibility;
  sortOrder: number;
}

/**
 * Store an uploaded exhibit and insert its row.
 *
 * Rule 15: A3 for that board, or the `board_member` role (A4, "upload for
 * review"). The board is resolved from the agenda item's meeting BEFORE the
 * check, which is what makes the check board-scoped rather than global.
 *
 * File first, row second — see `store.ts` for the ordering argument. A failed
 * insert deletes the file it just wrote; the path contains a freshly generated
 * exhibit id, so it can never be the path of a file some other row still
 * references.
 */
export async function createExhibitFromUpload(
  tx: TenantTx,
  actor: Actor,
  input: CreateExhibitInput,
  onCleanupError?: (err: unknown) => void,
): Promise<CreatedExhibit> {
  if (input.bytes.byteLength === 0) {
    throw new StoragePathError("The uploaded file is empty.");
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new StoragePathError(uploadTooLarge(input.bytes.byteLength));
  }

  const spec = EXHIBIT_CONTENT_TYPES[input.declaredContentType];
  if (!spec) {
    throw new StoragePathError(
      `${input.declaredContentType || "This file type"} is not an accepted exhibit. ` +
        "Upload a PDF, JPEG, PNG, DOCX or XLSX.",
    );
  }
  // The declared type must agree with the bytes. Without this, "PDF" is
  // whatever the browser said it was.
  const family = sniffFamily(input.bytes);
  if (family !== spec.family) {
    throw new StoragePathError(
      `The file's contents are not a ${input.declaredContentType}. Uploads are checked ` +
        "by their contents, not by their name or the type the browser reported.",
    );
  }

  requireLookupId(input.agendaItemId, "agenda item");
  const context = toRows<{ town_id: string; board_id: string; next_sort: number }>(
    await tx.execute(sql`
      SELECT ai.town_id,
             m.board_id,
             (SELECT COALESCE(MAX(e.sort_order) + 1, 0)
                FROM exhibit e WHERE e.agenda_item_id = ai.id) AS next_sort
      FROM agenda_item ai
      JOIN meeting m ON m.id = ai.meeting_id
      WHERE ai.id = ${input.agendaItemId}
    `),
    (message) => new Error(`createExhibitFromUpload: ${message}`),
  )[0];
  if (!context) throw new DocumentNotFoundError("No such agenda item.");

  assertCanInsertExhibit(actor, { boardId: context.board_id });

  const exhibitId = randomUUID();
  const relativePath = exhibitRelativePath(
    context.town_id,
    input.agendaItemId,
    exhibitId,
    spec.ext,
  );
  const fileName = safeStoredName(input.originalFilename, spec.ext);
  const sortOrder = Number(context.next_sort ?? 0);

  await withWrittenFile(
    documentRoot(),
    relativePath,
    input.bytes,
    async () => {
      await tx.execute(sql`
        INSERT INTO exhibit (id, agenda_item_id, town_id, title, file_storage_path,
                             file_type, file_size, file_name, exhibit_type, visibility,
                             sort_order, uploaded_by)
        VALUES (${exhibitId}, ${input.agendaItemId}, ${context.town_id},
                ${input.title || fileName}, ${relativePath},
                ${input.declaredContentType}, ${input.bytes.byteLength}, ${fileName},
                ${input.exhibitType}, ${input.visibility}::exhibit_visibility,
                ${sortOrder}, ${actor.userAccountId})
      `);
    },
    { onCleanupError },
  );

  return {
    id: exhibitId,
    agendaItemId: input.agendaItemId,
    title: input.title || fileName,
    fileName,
    fileType: input.declaredContentType,
    fileSize: input.bytes.byteLength,
    visibility: input.visibility,
    sortOrder,
  };
}

/**
 * Delete an exhibit and its bytes.
 *
 * Guarded by rule 16's A3 rather than rule 15's "A3 or a board seat": deleting
 * someone else's attachment is a curation act, and the board-member branch
 * exists so a member can upload their own material, not so they can remove the
 * clerk's. `assertCanUpdateExhibit` is the same guard that protects changing
 * an exhibit's VISIBILITY, and for the same reason.
 *
 * Row first, file second. A failed delete after the row is gone leaves an
 * orphan; a file deleted before the row would leave a listed exhibit that
 * cannot be opened.
 */
export async function deleteExhibit(
  tx: TenantTx,
  actor: Actor,
  exhibitId: string,
): Promise<{ removedPath: string | null }> {
  const row = await loadExhibit(tx, exhibitId);
  assertCanUpdateExhibit(actor, { boardId: row.board_id });

  await tx.execute(sql`DELETE FROM exhibit WHERE id = ${exhibitId}`);

  return { removedPath: row.file_type === "url" ? null : row.file_storage_path };
}

/** Called after the transaction commits — never inside it. */
export async function removeExhibitFile(relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  await removeFileIfPresent(documentRoot(), relativePath);
}

// ─── The town seal ────────────────────────────────────────────────────

export interface SealUploadResult {
  sealUrl: string;
  relativePath: string;
  /** Paths superseded by this upload; delete them AFTER the row commits. */
  supersededPaths: string[];
}

/**
 * Store a town's seal and point `town.seal_url` at it.
 *
 * ─── Why `town.seal_url` keeps holding a URL ──────────────────────────────
 *
 * Every other file this task touches moved from "store a URL" to "store a
 * path and build a URL in a route", because a stored URL to a public bucket
 * IS the authorization bypass. The seal is the one case where that reasoning
 * does not apply: it is public by design, it has no route in front of it, and
 * two of its three consumers cannot call one. `templates/email/layout.hbs:38`
 * renders it into mail a client fetches with no session, and
 * `templates/agenda-packet.hbs:13` has Chromium fetch it while rendering a
 * PDF. Handing either of those a path and asking them to build a URL is the
 * same value with an extra place to get it wrong.
 *
 * What DID change is the shape of the stored value: it is now a ROOT-RELATIVE
 * path (`/public-assets/seals/<townId>.png`), not the absolute
 * `https://<supabase host>/storage/v1/…` the old component wrote. Relative
 * because the value outlives the hostname — a deployment that changes domain,
 * or a town moving between environments, would otherwise carry a column full
 * of URLs pointing at the old host, with no migration to fix them. The two
 * consumers that need an absolute URL resolve it against `APP_URL` at render
 * time, where the current hostname is known. The browser needs no resolution
 * at all: `/public-assets/…` is same-origin.
 *
 * The value is also now written only by this function, from a UUID and a
 * sniffed extension — it is never a string the client chose.
 */
export async function setTownSeal(
  tx: TenantTx,
  actor: Actor,
  bytes: Uint8Array,
  onCleanupError?: (err: unknown) => void,
): Promise<SealUploadResult> {
  assertCanUpdateTown(actor);

  if (bytes.byteLength === 0) throw new StoragePathError("The uploaded file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new StoragePathError(uploadTooLarge(bytes.byteLength));
  }

  const ext = sealExtensionFor(bytes);
  if (!ext) {
    throw new StoragePathError(
      "A town seal must be a PNG or a JPEG image. The file's contents are checked, not " +
        "its name — and SVG is not accepted, because it can carry script and this file " +
        "is served from the application's own origin.",
    );
  }

  const relativePath = sealRelativePath(actor.townId, ext);
  const sealUrl = sealUrlFor(relativePath);

  // Is the file we are about to overwrite the one the current row points at?
  // If so, a failed update must NOT delete it — the town's live seal would go
  // with it.
  const current = toRows<{ seal_url: string | null }>(
    await tx.execute(sql`SELECT seal_url FROM town WHERE id = ${actor.townId}`),
    (message) => new Error(`setTownSeal: ${message}`),
  )[0];
  const overwritingLiveFile = current?.seal_url === sealUrl;

  await withWrittenFile(
    publicAssetRoot(),
    relativePath,
    bytes,
    async () => {
      await tx.execute(sql`
        UPDATE town SET seal_url = ${sealUrl}, updated_at = NOW() WHERE id = ${actor.townId}
      `);
    },
    { keepOnFailure: overwritingLiveFile, onCleanupError },
  );

  return {
    sealUrl,
    relativePath,
    // A PNG replacing a JPEG lands on a different path, so the old extension's
    // file has to be swept. Swept after the commit, never before.
    supersededPaths: allSealRelativePaths(actor.townId).filter((p) => p !== relativePath),
  };
}

/** Clear the seal. Row first, then the bytes — see `deleteExhibit`. */
export async function clearTownSeal(tx: TenantTx, actor: Actor): Promise<{ paths: string[] }> {
  assertCanUpdateTown(actor);
  await tx.execute(sql`
    UPDATE town SET seal_url = NULL, updated_at = NOW() WHERE id = ${actor.townId}
  `);
  return { paths: allSealRelativePaths(actor.townId) };
}

/** Delete seal files. Called after the transaction commits. */
export async function removeSealFiles(paths: readonly string[]): Promise<void> {
  const root = publicAssetRoot();
  for (const relative of paths) await removeFileIfPresent(root, relative);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function uploadTooLarge(size: number): string {
  return (
    `That file is ${(size / (1024 * 1024)).toFixed(1)} MB. The limit is ` +
    `${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`
  );
}

/**
 * A display name for the stored file.
 *
 * The bytes live at a path this module built out of UUIDs, so this name never
 * touches the filesystem — it is what the download is called and what the
 * exhibit list shows. Still stripped of separators and control characters,
 * because it is echoed into a `Content-Disposition` header.
 */
function safeStoredName(original: string, ext: string): string {
  const base = (original || `exhibit.${ext}`)
    .replace(/[\r\n\0]/g, "")
    .replace(/["\\/]/g, "-")
    .trim()
    .slice(0, 180);
  return base.length > 0 ? base : `exhibit.${ext}`;
}
