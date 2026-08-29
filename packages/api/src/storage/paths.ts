/**
 * Stage 1, Task D1e — the two storage roots, and every path that may exist
 * inside them.
 *
 * ─── Why there are two roots and not one bucket ───────────────────────────
 *
 * The product has exactly one file that must be fetchable by something which
 * cannot authenticate: the town seal. `templates/email/layout.hbs` renders it
 * into outgoing mail, where the reader is a mail client with no session, and
 * `templates/agenda-packet.hbs` has Chromium fetch it during PDF generation.
 * Everything else — draft minutes, `board_only` and `admin_only` exhibits — is
 * the opposite: it must not be fetchable without a check.
 *
 * The Supabase `documents` bucket answered both questions with "public"
 * (`supabase/migrations/20260311000003_session_0603_storage_bucket.sql:9`,
 * `public = true`), which made the tenancy policy in that same file decorative
 * and left draft minutes readable by anyone who could guess a path. The paths
 * were `${townId}/meetings/${meetingId}/minutes-${Date.now()}.pdf`, and the
 * public portal publishes both ids — so the only secret was a millisecond
 * timestamp. That is not a security control, and this module does not try to
 * make it into one: **no path here is a secret**. Tenancy stays in the path
 * because it makes the tree operable — you can see whose bytes are whose —
 * and authorization happens in the route.
 *
 * So:
 *
 *   PUBLIC ASSET ROOT   nginx serves it directly at /public-assets/seals/,
 *                       with no route in front. It contains ONLY seals.
 *
 *   DOCUMENT ROOT       nginx marks it `internal`. It is unreachable from
 *                       outside; a route authorizes and then names a file
 *                       with `X-Accel-Redirect`.
 *
 * ─── How "only seals reach the public root" is enforced ───────────────────
 *
 * Three independent ways, because a rule enforced once is a rule that gets
 * edited:
 *
 *   1. **No caller-supplied path.** The only exported builder for the public
 *      root is `sealRelativePath(townId, ext)`. It takes a UUID and an
 *      extension from a two-element allowlist and assembles `seals/<uuid>.<ext>`
 *      itself. There is no function anywhere that writes a caller's path into
 *      the public root, so there is nothing to abuse.
 *   2. **Content sniffing, not the filename.** `sealExtensionFor` reads the
 *      magic bytes. A PDF named `.png` is refused, so the tree cannot hold a
 *      document wearing an image's extension.
 *   3. **nginx exposes the subtree, not the root.** The alias in
 *      `infrastructure/nginx/nginx.conf` points at `<root>/seals/`, so even a
 *      file written beside `seals/` by something outside this module would not
 *      be served.
 *
 * SVG is deliberately NOT accepted, although the component that never worked
 * offered it. An SVG is a script container, and this root is served from the
 * same origin as the application — a town administrator uploading a "seal"
 * would have been uploading script to `app.townmeetingmanager.com`. PNG and
 * JPEG cover every real seal, and both render in mail clients and in Chromium.
 */

import path from "node:path";

/** The public root. Contains one subtree: `seals/`. */
export function publicAssetRoot(): string {
  return path.resolve(process.env.PUBLIC_ASSET_ROOT ?? "/var/lib/tmm/public");
}

/** The authorized root. Every file here is reachable only through a route. */
export function documentRoot(): string {
  return path.resolve(process.env.DOCUMENT_ROOT ?? "/var/lib/tmm/documents");
}

/**
 * The URL prefix the public root is served from.
 *
 * Stored in `town.seal_url` as a ROOT-RELATIVE path — see `writeTownSeal` in
 * `store.ts` for why relative and not absolute.
 */
export const PUBLIC_ASSET_URL_PREFIX = "/public-assets";

/**
 * Raised when a path is refused. Distinct from an authorization refusal: this
 * one means the request was malformed, not that the caller lacked a right.
 */
export class StoragePathError extends Error {
  override readonly name = "StoragePathError";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A single path segment.
 *
 * Must start with an alphanumeric, which is what rules out `.` and `..`
 * without special-casing them — a denylist of those two strings misses
 * `..%2f`, `...`, and every encoding variant, whereas "the first character is
 * a letter or a digit" admits none of them. No slash, no backslash, no NUL,
 * no colon (which would let a Windows drive-relative path through, and which
 * also rules out a stored `https://…` being treated as a file).
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Refuse anything that is not a plain relative path of safe segments, then
 * join it to `root` and prove the result is still inside `root`.
 *
 * Both halves are load-bearing and neither is sufficient alone. The segment
 * check refuses the input shapes; the containment check refuses whatever the
 * segment check failed to imagine, including a symlinked segment resolving
 * outward on a platform where `resolve` normalises differently.
 *
 * Every user-influenced component of every stored path goes through here —
 * including values READ BACK from the database, because a row written before
 * this module existed (or by some future code path) is no more trustworthy
 * than a header. `exhibit.file_storage_path`, notably, holds a full `https://`
 * URL when the exhibit is a link rather than a file; that is refused here as
 * well as by the route.
 */
export function resolveWithin(root: string, relative: string): string {
  if (typeof relative !== "string" || relative.length === 0) {
    throw new StoragePathError("empty storage path");
  }
  if (relative.includes("\0")) {
    throw new StoragePathError("storage path contains a NUL byte");
  }
  if (relative.includes("\\")) {
    throw new StoragePathError(`storage path contains a backslash: ${JSON.stringify(relative)}`);
  }
  if (relative.startsWith("/")) {
    throw new StoragePathError(`storage path must be relative: ${JSON.stringify(relative)}`);
  }

  const segments = relative.split("/");
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      throw new StoragePathError(
        `storage path segment ${JSON.stringify(segment)} is not allowed in ` +
          `${JSON.stringify(relative)}. Segments must begin with a letter or digit and ` +
          "contain only letters, digits, dot, dash and underscore.",
      );
    }
  }

  const base = path.resolve(root);
  const absolute = path.resolve(base, relative);
  if (absolute !== path.join(base, ...segments)) {
    throw new StoragePathError(`storage path did not normalise cleanly: ${relative}`);
  }
  if (!absolute.startsWith(base + path.sep)) {
    throw new StoragePathError(`storage path escapes its root: ${relative}`);
  }
  return absolute;
}

function requireUuid(value: string, what: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new StoragePathError(`${what} must be a UUID, got ${JSON.stringify(value)}`);
  }
  return value.toLowerCase();
}

// ─── The public root: seals, and nothing else ─────────────────────────

/** The only extensions the public root may ever hold. See the header on SVG. */
export const SEAL_EXTENSIONS = ["png", "jpg"] as const;
export type SealExtension = (typeof SEAL_EXTENSIONS)[number];

/** The MIME type a seal is served as, keyed by the extension we chose for it. */
export const SEAL_CONTENT_TYPES: Record<SealExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
};

/**
 * Decide a seal's extension from its BYTES.
 *
 * Not from `file.name` and not from the multipart `Content-Type`, both of
 * which the client chooses. Returns `undefined` for anything that is not a
 * PNG or a JPEG, which the route turns into a 415.
 */
export function sealExtensionFor(bytes: Uint8Array): SealExtension | undefined {
  if (isPng(bytes)) return "png";
  if (isJpeg(bytes)) return "jpg";
  return undefined;
}

/** `seals/<townId>.<ext>` — assembled here, never supplied by a caller. */
export function sealRelativePath(townId: string, ext: SealExtension): string {
  if (!SEAL_EXTENSIONS.includes(ext)) {
    throw new StoragePathError(`${JSON.stringify(ext)} is not a seal extension`);
  }
  return `seals/${requireUuid(townId, "town id")}.${ext}`;
}

/** Every path a town's seal could occupy — used to sweep a superseded file. */
export function allSealRelativePaths(townId: string): string[] {
  return SEAL_EXTENSIONS.map((ext) => sealRelativePath(townId, ext));
}

/** The URL `town.seal_url` stores. Root-relative; see `store.ts`. */
export function sealUrlFor(relativePath: string): string {
  return `${PUBLIC_ASSET_URL_PREFIX}/${relativePath}`;
}

// ─── The document root ────────────────────────────────────────────────

/** `minutes/<townId>/<meetingId>/<minutesDocumentId>.pdf` */
export function minutesRelativePath(
  townId: string,
  meetingId: string,
  minutesDocumentId: string,
): string {
  return [
    "minutes",
    requireUuid(townId, "town id"),
    requireUuid(meetingId, "meeting id"),
    `${requireUuid(minutesDocumentId, "minutes document id")}.pdf`,
  ].join("/");
}

/**
 * `agenda-packets/<townId>/<meetingId>.pdf`
 *
 * Stage 1, Task D1f. Derived from the meeting, with no column to store it in
 * and none added: one packet per meeting, replace-not-versioned, so the path
 * is a function of ids the serving route already has. `meeting.agenda_packet_url`
 * keeps holding a URL (now `/api/files/agenda-packet/<meetingId>`) because
 * that is what every consumer of the column already does with it — the web
 * client opens it in a tab, and `types/portal.ts` ships it to the portal.
 *
 * The old path was `${townId}/meetings/${meetingId}/agenda-packet-${Date.now()}.pdf`
 * in the Supabase `documents` bucket, which is declared `public = true`. Both
 * ids are published by the portal, so the only thing between an anonymous
 * fetch and an unpublished agenda packet was a millisecond timestamp — the
 * same defect `services/minutes-pdf.ts` records for minutes. The timestamp is
 * gone from the path because it never protected anything, and every
 * regeneration now supersedes its predecessor instead of leaving an orphan
 * that nothing points at but anyone could still fetch.
 */
export function agendaPacketRelativePath(townId: string, meetingId: string): string {
  return [
    "agenda-packets",
    requireUuid(townId, "town id"),
    `${requireUuid(meetingId, "meeting id")}.pdf`,
  ].join("/");
}

/** `meeting-notices/<townId>/<meetingId>.pdf` — see `agendaPacketRelativePath`. */
export function meetingNoticeRelativePath(townId: string, meetingId: string): string {
  return [
    "meeting-notices",
    requireUuid(townId, "town id"),
    `${requireUuid(meetingId, "meeting id")}.pdf`,
  ].join("/");
}

/** `exhibits/<townId>/<agendaItemId>/<exhibitId>.<ext>` */
export function exhibitRelativePath(
  townId: string,
  agendaItemId: string,
  exhibitId: string,
  ext: string,
): string {
  if (!SEGMENT.test(ext) || ext.includes(".")) {
    throw new StoragePathError(`${JSON.stringify(ext)} is not a usable file extension`);
  }
  return [
    "exhibits",
    requireUuid(townId, "town id"),
    requireUuid(agendaItemId, "agenda item id"),
    `${requireUuid(exhibitId, "exhibit id")}.${ext}`,
  ].join("/");
}

// ─── Exhibit content types ────────────────────────────────────────────

/**
 * What an exhibit may be, and the extension each type gets.
 *
 * The declared type is only consulted AFTER the bytes have been sniffed into
 * a family (`pdf`, `image`, `zip`), so a declared `…spreadsheetml.sheet` on a
 * PDF is refused. Within the ZIP family the declaration does decide between
 * DOCX and XLSX, because both are ZIP containers and the magic bytes cannot
 * tell them apart; the consequence of getting that one wrong is a file served
 * with the wrong Office MIME type, not a file of a kind we did not intend.
 */
export const EXHIBIT_CONTENT_TYPES: Record<
  string,
  { ext: string; family: "pdf" | "image" | "zip" }
> = {
  "application/pdf": { ext: "pdf", family: "pdf" },
  "image/jpeg": { ext: "jpg", family: "image" },
  "image/png": { ext: "png", family: "image" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    ext: "docx",
    family: "zip",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    ext: "xlsx",
    family: "zip",
  },
};

/** The byte family a buffer actually belongs to, or `undefined`. */
export function sniffFamily(bytes: Uint8Array): "pdf" | "image" | "zip" | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (isPng(bytes) || isJpeg(bytes)) return "image";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return "zip"; // empty archive
  return undefined;
}

function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xff, 0xd8, 0xff]);
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * The application's own upload ceiling, in bytes.
 *
 * nginx allows 10M on the app host (`client_max_body_size`), deliberately
 * larger: a request between 5M and 10M must be refused HERE, with a message
 * naming the limit, rather than by nginx with a bare 413 that the SPA cannot
 * explain to a clerk. The two numbers are not meant to match.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Turn the stored `town.seal_url` into something a client with no notion of
 * "this origin" can fetch.
 *
 * `town.seal_url` holds a root-relative path (`/public-assets/seals/…`) —
 * see `setTownSeal` in `documents.ts` for why relative rather than absolute.
 * The browser needs no help with that; two consumers do:
 *
 *   - `templates/email/layout.hbs:38` renders the seal into outgoing mail,
 *     where the reader is a mail client on someone else's machine;
 *   - `templates/agenda-packet.hbs:13` and `templates/minutes.hbs:15` have
 *     Chromium fetch it while rendering a PDF, from a page loaded via
 *     `setContent` with no base URL.
 *
 * Both call this. Resolving here rather than storing an absolute URL means a
 * deployment that changes hostname does not leave a column full of URLs
 * pointing at the old one.
 *
 * Anything that is already absolute is returned untouched, so rows written
 * before this task — which hold a full Supabase storage URL — keep rendering
 * whatever they used to.
 */
export function absoluteSealUrl(sealUrl: string | null | undefined): string | null {
  if (!sealUrl) return null;
  if (/^https?:\/\//i.test(sealUrl)) return sealUrl;
  const base = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
  return `${base}${sealUrl.startsWith("/") ? "" : "/"}${sealUrl}`;
}
