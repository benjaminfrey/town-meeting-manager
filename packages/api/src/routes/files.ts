/**
 * Stage 1, Task D1e — the file routes.
 *
 * Two features that have never worked, rebuilt on the two storage roots:
 *
 *   POST   /api/files/town-seal            replace the town seal
 *   DELETE /api/files/town-seal            remove it
 *   POST   /api/files/exhibits             upload an exhibit
 *   DELETE /api/files/exhibits/:exhibitId  remove one
 *   GET    /api/files/exhibits/:exhibitId  download one, if the tier allows
 *   GET    /api/files/minutes/:documentId  download minutes, if rule 9 allows
 *
 * "Never worked" is literal and was checked before anything was ported: the
 * only bucket any migration creates is `documents`
 * (`supabase/migrations/20260311000003_session_0603_storage_bucket.sql:8`).
 * `town-seals` (`web/src/components/dashboard/TownSealUpload.tsx:34`) and
 * `exhibits` (`web/src/hooks/useExhibitUpload.ts:33`) appear in no migration
 * and no seed, so every upload through either has always failed. There was no
 * behaviour to preserve, which is why these are rebuilt rather than ported.
 *
 * ─── This file is deliberately thin ───────────────────────────────────────
 *
 * It parses multipart, opens a tenant transaction, and translates errors into
 * status codes. Every authorization decision is in `storage/documents.ts`,
 * which calls the rules restored in D1 and adds none of its own — so the rules
 * can be tested against a real database without HTTP, and a check that appears
 * here and not there is a check in the wrong place.
 *
 * ─── Where the gate is ────────────────────────────────────────────────────
 *
 * Nowhere in this file. These routes carry no `PUBLIC_ROUTE` marking, so
 * Phase C's deny-by-default `onRequest` hook in `auth/fastify.ts` refuses any
 * request without a session and a resolved tenant before a handler runs, and
 * `request.withTenant` is the only database handle a handler is given.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { loadActor, type Actor } from "../trpc/authorization/actor.js";
import { AuthorizationError } from "../trpc/authorization/permission.js";
import type { ExhibitVisibility } from "../trpc/authorization/rules.js";
import { MAX_UPLOAD_BYTES, StoragePathError } from "../storage/paths.js";
import { sendStoredDocument } from "../storage/serve.js";
import {
  DocumentNotFoundError,
  clearTownSeal,
  createExhibitFromUpload,
  deleteExhibit,
  removeExhibitFile,
  removeSealFiles,
  resolveExhibitForDownload,
  resolveMinutesDocumentForDownload,
  setTownSeal,
} from "../storage/documents.js";

const VISIBILITIES: readonly string[] = ["public", "board_only", "admin_only"];

/**
 * Load the caller's actor through their own tenant context.
 *
 * Same loader the tRPC context uses, for the same reason: an actor built from
 * anything other than a database read inside the caller's tenant is an actor a
 * request could steer.
 */
async function actorFor(request: FastifyRequest): Promise<Actor> {
  const tenant = request.tenant;
  const withTenant = request.withTenant;
  if (!tenant || !withTenant) {
    // Unreachable behind the gate; asserted rather than assumed, because "the
    // hook always runs" is exactly the kind of claim that stops being true
    // when someone marks a route public.
    throw new AuthorizationError(
      "This route requires a resolved tenant context and did not get one.",
    );
  }
  return withTenant((tx) => loadActor(tx, tenant));
}

/**
 * Turn the three error kinds this surface produces into three status codes.
 *
 * A refusal is 403 with the rule's own message, which names the action code
 * and says who can grant it. A missing record is 404 — and a record in another
 * town is also 404, because RLS made it invisible before any rule ran, so the
 * two are indistinguishable to this handler and must stay that way: a 403 for
 * one and a 404 for the other would confirm the existence of another town's
 * records. A malformed path or an unacceptable file is 400.
 */
async function handle(
  request: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return reply.code(403).send({ error: "Forbidden", message: err.message });
    }
    if (err instanceof DocumentNotFoundError) {
      return reply.code(404).send({ error: "Not Found", message: err.message });
    }
    if (err instanceof StoragePathError) {
      return reply.code(400).send({ error: "Bad Request", message: err.message });
    }
    request.log.error({ err }, "file route failed");
    throw err;
  }
}

interface UploadedPart {
  bytes: Buffer;
  filename: string;
  contentType: string;
  fields: Record<string, string>;
}

/**
 * Read one file part and any accompanying text fields.
 *
 * The size ceiling is applied by `@fastify/multipart` as it streams, so a
 * 4 GB body is refused after 5 MB rather than after it has all arrived. nginx
 * allows 10M on the app host deliberately: anything between the two limits
 * must be refused HERE, with a message naming the limit, instead of by nginx
 * with a bare 413 the SPA cannot explain.
 */
async function readUpload(request: FastifyRequest): Promise<UploadedPart> {
  const fields: Record<string, string> = {};
  let file: UploadedPart | undefined;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (file) {
        // Consume the extra stream so the connection is not left half-read.
        await part.toBuffer().catch(() => undefined);
        throw new StoragePathError("Send one file at a time.");
      }
      const bytes = await part.toBuffer();
      if (part.file.truncated || bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new StoragePathError(
          `That file is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`,
        );
      }
      file = {
        bytes,
        filename: part.filename ?? "",
        contentType: part.mimetype ?? "",
        fields,
      };
    } else if (typeof part.value === "string") {
      fields[part.fieldname] = part.value;
    }
  }

  if (!file) throw new StoragePathError("No file was attached to this request.");
  file.fields = fields;
  return file;
}

export async function fileRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 12,
      // Field VALUES are titles and visibility words, never file content.
      fieldSize: 4096,
    },
    // The plugin's own behaviour is to throw a 413 the moment the stream
    // passes `fileSize`. That is the wrong answer for the same reason nginx's
    // bare 413 is: a clerk gets a status code and no sentence. Turning it off
    // makes the stream stop at the limit and set `part.file.truncated`, which
    // `readUpload` turns into a 400 naming the limit — while still refusing to
    // buffer more than 5 MB, which is the part that actually protects the
    // process.
    throwFileSizeLimit: false,
  });

  // ─── The town seal — the one public asset ───────────────────────────
  //
  // Admin-gated through `assertCanUpdateTown`, the same guard every other
  // change to the town record uses. The image type and size are checked on
  // the server from the file's BYTES; the component's own check stays, but
  // only as a courtesy that saves a round trip.

  fastify.post("/files/town-seal", async (request, reply) =>
    handle(request, reply, async () => {
      const upload = await readUpload(request);
      const actor = await actorFor(request);

      const result = await request.withTenant!((tx) =>
        setTownSeal(tx, actor, upload.bytes, (err) =>
          request.log.error({ err }, "failed to remove a seal after a failed update"),
        ),
      );

      // After the row commits: a PNG replacing a JPEG leaves the JPEG behind.
      try {
        await removeSealFiles(result.supersededPaths);
      } catch (err) {
        // An orphaned file with a correct database. Logged, not retried, and
        // never allowed to fail a request whose real work succeeded.
        request.log.error({ err }, "failed to sweep a superseded seal");
      }

      return { sealUrl: result.sealUrl };
    }),
  );

  fastify.delete("/files/town-seal", async (request, reply) =>
    handle(request, reply, async () => {
      const actor = await actorFor(request);
      const { paths } = await request.withTenant!((tx) => clearTownSeal(tx, actor));
      try {
        await removeSealFiles(paths);
      } catch (err) {
        request.log.error({ err }, "failed to remove a cleared seal");
      }
      return { sealUrl: null };
    }),
  );

  // ─── Exhibits ───────────────────────────────────────────────────────

  fastify.post("/files/exhibits", async (request, reply) =>
    handle(request, reply, async () => {
      const upload = await readUpload(request);
      const actor = await actorFor(request);

      const agendaItemId = upload.fields.agendaItemId ?? "";
      const visibility = upload.fields.visibility ?? "public";
      if (!VISIBILITIES.includes(visibility)) {
        throw new StoragePathError(`${JSON.stringify(visibility)} is not a visibility.`);
      }

      const created = await request.withTenant!((tx) =>
        createExhibitFromUpload(
          tx,
          actor,
          {
            agendaItemId,
            title: (upload.fields.title ?? "").trim(),
            exhibitType: upload.fields.exhibitType ?? null,
            visibility: visibility as ExhibitVisibility,
            declaredContentType: upload.contentType,
            originalFilename: upload.filename,
            bytes: upload.bytes,
          },
          (err) => request.log.error({ err }, "failed to remove an exhibit after a failed insert"),
        ),
      );

      return reply.code(201).send(created);
    }),
  );

  fastify.delete<{ Params: { exhibitId: string } }>(
    "/files/exhibits/:exhibitId",
    async (request, reply) =>
      handle(request, reply, async () => {
        const actor = await actorFor(request);
        const { removedPath } = await request.withTenant!((tx) =>
          deleteExhibit(tx, actor, request.params.exhibitId),
        );
        try {
          await removeExhibitFile(removedPath);
        } catch (err) {
          request.log.error({ err }, "failed to remove a deleted exhibit's file");
        }
        return { deleted: true };
      }),
  );

  fastify.get<{ Params: { exhibitId: string } }>(
    "/files/exhibits/:exhibitId",
    async (request, reply) =>
      handle(request, reply, async () => {
        const actor = await actorFor(request);
        const document = await request.withTenant!((tx) =>
          resolveExhibitForDownload(tx, actor, request.params.exhibitId),
        );
        return sendStoredDocument(reply, document.relativePath, document);
      }),
  );

  // ─── Minutes ────────────────────────────────────────────────────────
  //
  // The route this whole design exists for. Until now a minutes PDF was
  // written to a bucket declared `public = true` at a path built from a town
  // id, a meeting id — both published by the portal — and `Date.now()`. Rule
  // 9 now decides every fetch: R4 for that board, or the document is approved
  // or published.

  fastify.get<{ Params: { documentId: string } }>(
    "/files/minutes/:documentId",
    async (request, reply) =>
      handle(request, reply, async () => {
        const actor = await actorFor(request);
        const document = await request.withTenant!((tx) =>
          resolveMinutesDocumentForDownload(tx, actor, request.params.documentId),
        );
        return sendStoredDocument(reply, document.relativePath, document);
      }),
  );
}
