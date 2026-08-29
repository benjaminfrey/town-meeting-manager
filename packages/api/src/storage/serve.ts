/**
 * Stage 1, Task D1e — handing an authorized document to the caller.
 *
 * ─── Why `X-Accel-Redirect` and not a signed URL ──────────────────────────
 *
 * The shape this replaces was "public directory + signed URL"
 * (`routes/portal.ts:437,476`, both signing against a bucket that was never
 * created, so both dead). A signed URL puts the authorization decision in a
 * token with a lifetime: it can be forwarded, it stays valid after the
 * permission that produced it is revoked, and its expiry is a guess about how
 * long a download takes. There is nothing to leak here because there is no
 * token — every fetch runs the rule again, against the caller's session, at
 * the moment of the fetch.
 *
 * And Node does not pipe the bytes. The route authorizes, then answers with a
 * header naming a file inside an `internal` nginx location; nginx serves it
 * with `sendfile`. An `internal` location cannot be requested directly — nginx
 * returns 404 for a client that asks for one — so the document root is
 * reachable only by way of a response this application produced.
 *
 * ─── The development path ─────────────────────────────────────────────────
 *
 * There is no nginx in front of the API in development or in tests, so
 * `X-Accel-Redirect` would produce an empty 200. When `X_ACCEL_ENABLED` is not
 * set, this streams the file itself. The two paths differ ONLY in delivery:
 * the authorization, the path validation and the 404 all happen before either
 * one is chosen, so a rule that holds in development holds in production. The
 * production compose file sets `X_ACCEL_ENABLED=true`.
 */

import type { FastifyReply } from "fastify";
import { documentRoot, resolveWithin } from "./paths.js";
import { fileExists, fileSize, readStoredFile } from "./store.js";

/** The `internal` nginx location the document root is mounted at. */
export const X_ACCEL_LOCATION = "/__documents/";

function xAccelEnabled(): boolean {
  const value = process.env.X_ACCEL_ENABLED;
  return value === "true" || value === "1" || value === "on";
}

export interface SendDocumentOptions {
  /** The name the browser should save it as. */
  filename: string;
  contentType: string;
  /**
   * `inline` for a PDF the clerk wants to read in the browser tab,
   * `attachment` for everything else. Never omitted: a document served with
   * no disposition and a type the browser renders is a document the browser
   * will execute if the type is ever wrong.
   */
  disposition?: "inline" | "attachment";
}

/**
 * Answer with an authorized document, or 404 when the bytes are not there.
 *
 * `relative` is validated against the document root before anything is sent —
 * including when it came out of the database, because a `file_storage_path`
 * written by an older code path is no more trustworthy than a header. A URL
 * exhibit, whose `file_storage_path` holds `https://…`, is refused here by
 * `resolveWithin` even if a route forgot to check its `file_type`.
 */
export async function sendStoredDocument(
  reply: FastifyReply,
  relative: string,
  options: SendDocumentOptions,
): Promise<FastifyReply> {
  const root = documentRoot();

  // Throws `StoragePathError` for anything that is not a plain contained path;
  // the route's error translator turns that into a 400.
  resolveWithin(root, relative);

  if (!(await fileExists(root, relative))) {
    return reply.code(404).send({
      error: "Not Found",
      message:
        "The stored file for this record is missing. The record exists, so this is a " +
        "storage problem rather than a permissions one.",
    });
  }

  const disposition = options.disposition ?? "attachment";
  reply.header("Content-Type", options.contentType);
  reply.header(
    "Content-Disposition",
    `${disposition}; filename="${sanitiseFilename(options.filename)}"`,
  );
  // Documents behind an authorization check must never be held by a shared
  // cache: the next caller is a different person with different permissions.
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-Content-Type-Options", "nosniff");

  if (xAccelEnabled()) {
    reply.header("X-Accel-Redirect", `${X_ACCEL_LOCATION}${relative}`);
    return reply.send();
  }

  const size = await fileSize(root, relative);
  if (size !== undefined) reply.header("Content-Length", String(size));
  return reply.send(await readStoredFile(root, relative));
}

/**
 * Make a filename safe to put inside a quoted `Content-Disposition`.
 *
 * A raw `"` or newline in the name would let a stored title break out of the
 * header — a response-splitting shape. `exhibit.file_name` is client-supplied,
 * so this is not hypothetical.
 */
export function sanitiseFilename(name: string): string {
  const cleaned = name
    .replace(/[\r\n\0]/g, "")
    .replace(/["\\]/g, "")
    .replace(/[/]/g, "-")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "document";
}
