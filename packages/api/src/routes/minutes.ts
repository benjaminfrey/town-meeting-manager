/**
 * Minutes generation routes.
 *
 * POST /api/meetings/:meetingId/minutes/generate
 *   — Generate a minutes draft (JSON → HTML → PDF)
 *
 * POST /api/meetings/:meetingId/minutes/regenerate
 *   — Overwrite an existing minutes draft
 *
 * POST /api/meetings/:meetingId/minutes/render
 *   — Re-render HTML + PDF from existing content_json (no JSON regeneration)
 *
 * POST /api/meetings/:meetingId/minutes/submit   — draft → review
 * POST /api/meetings/:meetingId/minutes/approve  — review → approved
 *
 * ─── Stage 1, Task D1f: what changed here, and why ────────────────────────
 *
 * Twenty-six calls to `fastify.supabase` — the service-role client, which
 * bypasses row level security. This was the largest remaining surface on it,
 * and three separate things are different now.
 *
 * **Tenancy is the database's.** Every read and write happens inside
 * `request.withTenant`, so a meeting id belonging to another town returns no
 * row. The five `meeting.town_id !== user.townId` comparisons are gone — not
 * because they were wrong, but because a cross-tenant boundary settled by a
 * TypeScript comparison a future edit can delete is not a boundary. The same
 * applies underneath `assembleMinutesJson`, which made fourteen unfiltered
 * service-role queries of its own and now takes the transaction.
 *
 * **Authorization is board-scoped.** The confirmed defect this task closes.
 * These four routes were guarded by `requirePermission("generate_ai_minutes")`
 * / `("edit_draft_minutes")` / `("submit_minutes_review")` in the preHandler,
 * and that guard resolves R1/R2/R3 with NO board id, because a Fastify
 * preHandler has no meeting to resolve one from. All three are granted PER
 * BOARD by the two `designated_boards` templates and globally by neither, so a
 * global check was wrong in both directions — and the direction that matters
 * is that a clerk whose town had explicitly REVOKED one for a board could
 * still edit that board's draft minutes. The handler now resolves the meeting
 * first and asks `rules.ts` about `meeting.board_id`.
 *
 * `requireAdmin` on `/approve` is NOT board-scoped and stays where it is: it
 * admits the town `admin` role and nothing else, which no board override can
 * change. See the comment at that route.
 *
 * **The notification split is closed.** `services/notification-triggers.ts`
 * was left on the service-role client by D1c with a written finish condition:
 * this file could not hand it a tenant because it did not have one. It does
 * now, so both triggers take `tenantJob(fastify.tenantDb, tenant.townId)`,
 * and the up-to-60-second delivery latency the split introduced is gone —
 * the event is queued AND scheduled in one call again.
 *
 * ─── Why the PDF is rendered OUTSIDE the transaction ──────────────────────
 *
 * Same reason `routes/documents.ts` gives: Puppeteer takes seconds and holds a
 * Chromium process, and a transaction spanning it holds a pooled connection
 * for that whole time. Read-and-authorize, then render, then write.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../plugins/auth.js";
import { loadActor, type Actor } from "../trpc/authorization/actor.js";
import { AuthorizationError } from "../trpc/authorization/permission.js";
import {
  assertCanGenerateMinutes,
  assertCanSubmitMinutesForReview,
  assertCanUpdateMinutesDocument,
} from "../trpc/authorization/rules.js";
import { toRows } from "../db/rows.js";
import type { TenantTx } from "../db/with-tenant.js";
import { tenantJob } from "../jobs/tenant-job.js";
import { DocumentNotFoundError } from "../storage/documents.js";
import { handleRouteErrors } from "./error-status.js";
import { triggerMinutesReview, triggerMinutesApproved } from "../services/notification-triggers.js";
import { assembleMinutesJson } from "../services/minutes-assembler.js";
import { formatMinutes } from "../services/minutes-formatters.js";
import { renderMinutes } from "../services/templates.js";
import { generateMinutesPdf } from "../services/minutes-pdf.js";
import { absoluteSealUrl } from "../storage/paths.js";
import type { MinutesRenderOptions, MinutesContentJson } from "@town-meeting/shared";

/**
 * Where a client fetches a minutes PDF.
 *
 * Stage 1, Task D1e. This used to be
 * `supabase.storage.from("documents").getPublicUrl(path)` — a URL into a
 * bucket declared `public = true`, handed back to the caller and, once
 * stored or forwarded, fetchable by anyone with the string. Draft minutes
 * included.
 *
 * It is now a route on this API. `GET /api/files/minutes/:documentId` applies
 * rule 9 — R4 for that board, or the document is approved or published — on
 * every fetch, against the session presenting it. There is no token, so there
 * is nothing to forward and nothing to expire.
 */
function minutesPdfUrl(minutesDocumentId: string): string {
  return `/api/files/minutes/${minutesDocumentId}`;
}

// ─── Types ───────────────────────────────────────────────────────

interface MeetingParams {
  meetingId: string;
}

interface GenerateBody {
  minutes_style_override?: string;
}

interface RenderBody {
  is_draft?: boolean;
}

// DB row types
interface MeetingRow {
  id: string;
  board_id: string;
  town_id: string;
  title: string;
  meeting_type: string;
  scheduled_date: string;
  status: string;
}

interface BoardRow {
  id: string;
  name: string;
  motion_display_format: string | null;
  certification_format: string | null;
  member_reference_style: string | null;
  minutes_style_override: string | null;
}

interface TownRow {
  id: string;
  name: string;
  minutes_style: string | null;
  seal_url: string | null;
}

interface MinutesDocRow {
  id: string;
  meeting_id: string;
  status: string;
  content_json: unknown;
  minutes_style: string | null;
}

interface WrittenMinutesRow {
  id: string;
  status: string;
  minutes_style: string | null;
  created_at: string;
}

// ─── Shared helpers ──────────────────────────────────────────────

function rows<T>(result: unknown, what: string): T[] {
  return toRows<T>(result, (message) => new Error(`minutes.${what}: ${message}`));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The tenant handles the deny-by-default gate has already established.
 *
 * Asserted rather than assumed for the reason `routes/files.ts` gives: "the
 * hook always runs" is exactly the claim that stops being true when someone
 * marks a route public.
 */
function scopeOf(request: FastifyRequest) {
  const tenant = request.tenant;
  const withTenant = request.withTenant;
  if (!tenant || !withTenant) {
    throw new AuthorizationError(
      "This route requires a resolved tenant context and did not get one.",
    );
  }
  return { tenant, withTenant };
}

/**
 * The meeting, or the same 404 a meeting in another town produces.
 *
 * Not found and "belongs to another town" must be the same answer: RLS made
 * the second invisible before any rule ran, and distinguishing them would
 * confirm other towns' meeting ids. A non-UUID id is refused here too, so a
 * probe produces a 404 rather than a Postgres type error read as a 500.
 */
async function loadMeeting(tx: TenantTx, meetingId: string): Promise<MeetingRow> {
  if (typeof meetingId !== "string" || !UUID_RE.test(meetingId)) {
    throw new DocumentNotFoundError("Meeting not found");
  }
  const meeting = rows<MeetingRow>(
    await tx.execute(sql`
      SELECT id, board_id, town_id, title, meeting_type,
             scheduled_date::text AS scheduled_date, status::text AS status
      FROM meeting WHERE id = ${meetingId}
    `),
    "meeting",
  )[0];
  if (!meeting) throw new DocumentNotFoundError("Meeting not found");
  return meeting;
}

/** Board and town, for the render options both generation routes build. */
async function loadRenderContext(
  tx: TenantTx,
  meeting: MeetingRow,
): Promise<{ board: BoardRow; town: TownRow } | null> {
  const board = rows<BoardRow>(
    await tx.execute(sql`
      SELECT id, name, motion_display_format, certification_format,
             member_reference_style, minutes_style_override
      FROM board WHERE id = ${meeting.board_id}
    `),
    "board",
  )[0];
  const town = rows<TownRow>(
    await tx.execute(sql`
      SELECT id, name, minutes_style, seal_url FROM town WHERE id = ${meeting.town_id}
    `),
    "town",
  )[0];
  if (!board || !town) return null;
  return { board, town };
}

function renderOptionsFor(
  board: BoardRow,
  town: TownRow,
  minutesStyle: string,
  isDraft: boolean,
): MinutesRenderOptions {
  return {
    minutes_style: minutesStyle as MinutesRenderOptions["minutes_style"],
    motion_display_format: (board.motion_display_format ??
      "inline_narrative") as MinutesRenderOptions["motion_display_format"],
    member_reference_style: (board.member_reference_style ??
      "title_and_last_name") as MinutesRenderOptions["member_reference_style"],
    certification_format: (board.certification_format ??
      "prepared_by") as MinutesRenderOptions["certification_format"],
    is_draft: isDraft,
    // Absolute: Chromium fetches this while rendering the PDF, from a page
    // loaded with no base URL. See `absoluteSealUrl`.
    town_seal_url: absoluteSealUrl(town.seal_url),
  };
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular Meeting",
  special: "Special Meeting",
  public_hearing: "Public Hearing",
  emergency: "Emergency Meeting",
};

function renderMinutesHtml(
  meeting: MeetingRow,
  board: BoardRow,
  town: TownRow,
  contentJson: MinutesContentJson,
  options: MinutesRenderOptions,
): string {
  const formattedContent = formatMinutes(contentJson, options);
  const formattedDate = new Date(meeting.scheduled_date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return renderMinutes({
    isDraft: options.is_draft,
    sealUrl: absoluteSealUrl(town.seal_url),
    townName: town.name,
    boardName: board.name,
    meetingHeader: formattedContent.meeting_header as unknown as Record<string, unknown>,
    attendance: formattedContent.attendance as unknown as Record<string, unknown>,
    sections: formattedContent.sections as unknown as Array<Record<string, unknown>>,
    adjournmentText: formattedContent.adjournment_text,
    certification: formattedContent.certification as unknown as Record<string, unknown>,
    formattedDate,
    formattedMeetingType: MEETING_TYPE_LABELS[meeting.meeting_type] ?? meeting.meeting_type,
  });
}

/**
 * What a read-and-authorize transaction hands back.
 *
 * A refusal throws (`AuthorizationError` → 403) and a missing row throws
 * (`DocumentNotFoundError` → 404), so the only thing this has to express is
 * the LIFECYCLE refusals — "this meeting is not adjourned yet", "these minutes
 * are already approved" — which are 400s and 409s about state rather than
 * about the caller. Returned rather than thrown so the status code stays
 * visible at the route.
 */
type Prepared<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "badRequest" | "conflict"; message: string };

function refuse<T>(kind: "badRequest" | "conflict", message: string): Prepared<T> {
  return { ok: false, kind, message };
}

// ─── Route Registration ─────────────────────────────────────────

export async function minutesRoutes(fastify: FastifyInstance) {
  // ─── Generate Minutes Draft ─────────────────────────────────────
  //
  // R2 (`generate_ai_minutes`), board-scoped — see this file's header for why
  // it is here rather than in the preHandler.
  fastify.post<{ Params: MeetingParams; Body: GenerateBody }>(
    "/meetings/:meetingId/minutes/generate",
    async (request, reply) =>
      handleRouteErrors(request, reply, async () => {
        const { meetingId } = request.params;
        const { tenant, withTenant } = scopeOf(request);

        const prepared = await withTenant(
          async (
            tx,
          ): Promise<
            Prepared<{
              actor: Actor;
              meeting: MeetingRow;
              board: BoardRow;
              town: TownRow;
              minutesStyle: string;
              contentJson: MinutesContentJson;
            }>
          > => {
            const actor = await loadActor(tx, tenant);
            const meeting = await loadMeeting(tx, meetingId);
            assertCanGenerateMinutes(actor, { boardId: meeting.board_id });

            // Meeting must be adjourned or later in the lifecycle
            const validStatuses = ["adjourned", "minutes_draft", "approved"];
            if (!validStatuses.includes(meeting.status)) {
              return refuse(
                "badRequest",
                `Meeting status must be adjourned or later to generate minutes. Current status: ${meeting.status}`,
              );
            }

            const existing = rows<{ id: string }>(
              await tx.execute(
                sql`SELECT id FROM minutes_document WHERE meeting_id = ${meetingId}`,
              ),
              "existingMinutes",
            )[0];
            if (existing) {
              return refuse(
                "conflict",
                "Minutes already exist for this meeting. Use /regenerate to overwrite.",
              );
            }

            const context = await loadRenderContext(tx, meeting);
            if (!context) throw new DocumentNotFoundError("Board or town not found");

            // Resolve minutes style: request override > board override > town default
            const minutesStyle =
              request.body?.minutes_style_override ??
              context.board.minutes_style_override ??
              context.town.minutes_style ??
              "summary";

            return {
              ok: true,
              value: {
                actor,
                meeting,
                ...context,
                minutesStyle,
                contentJson: await assembleMinutesJson(tx, meetingId),
              },
            };
          },
        );

        if (!prepared.ok) return reply[prepared.kind](prepared.message);
        const { actor, meeting, board, town, minutesStyle, contentJson } = prepared.value;

        try {
          const html = renderMinutesHtml(
            meeting,
            board,
            town,
            contentJson,
            renderOptionsFor(board, town, minutesStyle, true),
          );

          // The id is generated HERE rather than by the insert below, because
          // the storage path contains it (Stage 1, Task D1e). One document,
          // one path — the owner's replace-not-versioned decision — so a
          // regeneration overwrites rather than accumulating orphaned drafts
          // in the authorized root.
          const minutesDocumentId = randomUUID();
          const pdfStoragePath = await generateMinutesPdf(
            html,
            meetingId,
            meeting.town_id,
            minutesDocumentId,
            {
              townName: town.name,
              boardName: board.name,
              meetingDate: meeting.scheduled_date,
              isDraft: true,
            },
          );

          const now = new Date().toISOString();
          const inserted = await withTenant(async (tx) => {
            const written = rows<WrittenMinutesRow>(
              await tx.execute(sql`
                INSERT INTO minutes_document
                  (id, meeting_id, board_id, town_id, status, content_json,
                   original_content_json, html_rendered, pdf_storage_path, minutes_style,
                   generated_by, created_by, created_at, updated_at)
                VALUES
                  (${minutesDocumentId}, ${meetingId}, ${meeting.board_id}, ${meeting.town_id},
                   'draft', ${JSON.stringify(contentJson)}::jsonb,
                   ${JSON.stringify(contentJson)}::jsonb, ${html}, ${pdfStoragePath},
                   ${minutesStyle}, 'manual', ${actor.userAccountId}, ${now}, ${now})
                RETURNING id, status::text AS status, minutes_style,
                          created_at::text AS created_at
              `),
              "insertMinutes",
            )[0];

            if (written && meeting.status === "adjourned") {
              await tx.execute(sql`
                UPDATE meeting SET status = 'minutes_draft', updated_at = ${now}
                 WHERE id = ${meetingId}
              `);
            }
            return written;
          });

          if (!inserted) {
            request.log.error({ meetingId }, "Failed to insert minutes_document");
            return reply.internalServerError("Failed to save minutes document");
          }

          return {
            id: inserted.id,
            status: inserted.status,
            minutes_style: inserted.minutes_style,
            pdf_url: minutesPdfUrl(inserted.id),
            created_at: inserted.created_at,
          };
        } catch (err) {
          request.log.error(err, "Minutes generation failed");
          return reply.internalServerError(
            `Minutes generation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
        }
      }),
  );

  // ─── Regenerate Minutes ────────────────────────────────────────
  //
  // R2 (`generate_ai_minutes`), board-scoped.
  fastify.post<{ Params: MeetingParams; Body: GenerateBody }>(
    "/meetings/:meetingId/minutes/regenerate",
    async (request, reply) =>
      handleRouteErrors(request, reply, async () => {
        const { meetingId } = request.params;
        const { tenant, withTenant } = scopeOf(request);

        const prepared = await withTenant(
          async (
            tx,
          ): Promise<
            Prepared<{
              meeting: MeetingRow;
              board: BoardRow;
              town: TownRow;
              minutesDocumentId: string;
              minutesStyle: string;
              contentJson: MinutesContentJson;
            }>
          > => {
            const actor = await loadActor(tx, tenant);
            const meeting = await loadMeeting(tx, meetingId);
            assertCanGenerateMinutes(actor, { boardId: meeting.board_id });

            const existing = rows<{ id: string; status: string }>(
              await tx.execute(sql`
                SELECT id, status::text AS status FROM minutes_document
                 WHERE meeting_id = ${meetingId}
              `),
              "existingMinutes",
            )[0];
            if (!existing) {
              throw new DocumentNotFoundError("No existing minutes found. Use /generate instead.");
            }
            if (existing.status === "approved" || existing.status === "published") {
              return refuse("badRequest", "Cannot regenerate approved or published minutes.");
            }

            const context = await loadRenderContext(tx, meeting);
            if (!context) throw new DocumentNotFoundError("Board or town not found");

            const minutesStyle =
              request.body?.minutes_style_override ??
              context.board.minutes_style_override ??
              context.town.minutes_style ??
              "summary";

            return {
              ok: true,
              value: {
                meeting,
                ...context,
                minutesDocumentId: existing.id,
                minutesStyle,
                contentJson: await assembleMinutesJson(tx, meetingId),
              },
            };
          },
        );

        if (!prepared.ok) return reply[prepared.kind](prepared.message);
        const { meeting, board, town, minutesDocumentId, minutesStyle, contentJson } =
          prepared.value;

        try {
          const html = renderMinutesHtml(
            meeting,
            board,
            town,
            contentJson,
            renderOptionsFor(board, town, minutesStyle, true),
          );

          const pdfStoragePath = await generateMinutesPdf(
            html,
            meetingId,
            meeting.town_id,
            minutesDocumentId,
            {
              townName: town.name,
              boardName: board.name,
              meetingDate: meeting.scheduled_date,
              isDraft: true,
            },
          );

          const now = new Date().toISOString();
          const [updated] = await withTenant(async (tx) =>
            rows<WrittenMinutesRow>(
              await tx.execute(sql`
                UPDATE minutes_document
                   SET status = 'draft',
                       content_json = ${JSON.stringify(contentJson)}::jsonb,
                       original_content_json = ${JSON.stringify(contentJson)}::jsonb,
                       html_rendered = ${html},
                       pdf_storage_path = ${pdfStoragePath},
                       minutes_style = ${minutesStyle},
                       generated_by = 'manual',
                       updated_at = ${now}
                 WHERE id = ${minutesDocumentId}
             RETURNING id, status::text AS status, minutes_style,
                       created_at::text AS created_at
              `),
              "updateMinutes",
            ),
          );

          if (!updated) {
            request.log.error({ minutesDocumentId }, "Failed to update minutes_document");
            return reply.internalServerError("Failed to update minutes document");
          }

          return {
            id: updated.id,
            status: updated.status,
            minutes_style: updated.minutes_style,
            pdf_url: minutesPdfUrl(updated.id),
            regenerated: true,
            created_at: updated.created_at,
          };
        } catch (err) {
          request.log.error(err, "Minutes regeneration failed");
          return reply.internalServerError(
            `Minutes regeneration failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
        }
      }),
  );

  // ─── Render Minutes (re-render HTML + PDF from existing content_json) ──
  //
  // R1 (`edit_draft_minutes`), board-scoped — the same code and the same board
  // the tRPC side reaches through `assertCanUpdateMinutesDocument`, which is
  // why this calls that rather than a second guard spelling the same thing.
  fastify.post<{ Params: MeetingParams; Body: RenderBody }>(
    "/meetings/:meetingId/minutes/render",
    async (request, reply) =>
      handleRouteErrors(request, reply, async () => {
        const { meetingId } = request.params;
        const { tenant, withTenant } = scopeOf(request);
        const isDraft = request.body?.is_draft ?? true;

        const prepared = await withTenant(
          async (
            tx,
          ): Promise<
            Prepared<{
              meeting: MeetingRow;
              board: BoardRow;
              town: TownRow;
              minutesDocumentId: string;
              minutesStyle: string;
              contentJson: MinutesContentJson;
            }>
          > => {
            const actor = await loadActor(tx, tenant);
            const meeting = await loadMeeting(tx, meetingId);
            assertCanUpdateMinutesDocument(actor, { boardId: meeting.board_id });

            const existing = rows<MinutesDocRow>(
              await tx.execute(sql`
                SELECT id, meeting_id, status::text AS status, content_json, minutes_style
                  FROM minutes_document WHERE meeting_id = ${meetingId}
              `),
              "existingMinutes",
            )[0];
            if (!existing) {
              throw new DocumentNotFoundError("No existing minutes found. Use /generate first.");
            }
            if (!existing.content_json) {
              return refuse("badRequest", "Minutes document has no content_json to render.");
            }

            const context = await loadRenderContext(tx, meeting);
            if (!context) throw new DocumentNotFoundError("Board or town not found");

            const minutesStyle =
              existing.minutes_style ??
              context.board.minutes_style_override ??
              context.town.minutes_style ??
              "summary";

            return {
              ok: true,
              value: {
                meeting,
                ...context,
                minutesDocumentId: existing.id,
                minutesStyle,
                contentJson: existing.content_json as MinutesContentJson,
              },
            };
          },
        );

        if (!prepared.ok) return reply[prepared.kind](prepared.message);
        const { meeting, board, town, minutesDocumentId, minutesStyle, contentJson } =
          prepared.value;

        try {
          const html = renderMinutesHtml(
            meeting,
            board,
            town,
            contentJson,
            renderOptionsFor(board, town, minutesStyle, isDraft),
          );

          const pdfStoragePath = await generateMinutesPdf(
            html,
            meetingId,
            meeting.town_id,
            minutesDocumentId,
            {
              townName: town.name,
              boardName: board.name,
              meetingDate: meeting.scheduled_date,
              isDraft,
            },
          );

          const now = new Date().toISOString();
          const [updated] = await withTenant(async (tx) =>
            rows<WrittenMinutesRow>(
              await tx.execute(sql`
                UPDATE minutes_document
                   SET html_rendered = ${html},
                       pdf_storage_path = ${pdfStoragePath},
                       updated_at = ${now}
                 WHERE id = ${minutesDocumentId}
             RETURNING id, status::text AS status, minutes_style,
                       created_at::text AS created_at
              `),
              "renderMinutes",
            ),
          );

          if (!updated) {
            request.log.error({ minutesDocumentId }, "Failed to update minutes_document");
            return reply.internalServerError("Failed to update minutes document");
          }

          return {
            id: updated.id,
            status: updated.status,
            minutes_style: updated.minutes_style,
            pdf_url: minutesPdfUrl(updated.id),
            rendered: true,
            is_draft: isDraft,
            created_at: updated.created_at,
          };
        } catch (err) {
          request.log.error(err, "Minutes render failed");
          return reply.internalServerError(
            `Minutes render failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
        }
      }),
  );

  // ─── Submit for Review ──────────────────────────────────────────
  //
  // R3 (`submit_minutes_review`), board-scoped.
  fastify.post<{ Params: MeetingParams }>(
    "/meetings/:meetingId/minutes/submit",
    async (request, reply) =>
      handleRouteErrors(request, reply, async () => {
        const { meetingId } = request.params;
        const { tenant, withTenant } = scopeOf(request);
        const now = new Date().toISOString();

        const prepared = await withTenant(
          async (tx): Promise<Prepared<{ minutesDocumentId: string }>> => {
            const actor = await loadActor(tx, tenant);
            const meeting = await loadMeeting(tx, meetingId);
            assertCanSubmitMinutesForReview(actor, { boardId: meeting.board_id });

            const doc = rows<{ id: string; status: string }>(
              await tx.execute(sql`
                SELECT id, status::text AS status FROM minutes_document
                 WHERE meeting_id = ${meetingId}
              `),
              "minutesDoc",
            )[0];
            if (!doc) throw new DocumentNotFoundError("No minutes document found");
            if (doc.status !== "draft") {
              return refuse("badRequest", `Cannot submit minutes with status "${doc.status}"`);
            }

            await tx.execute(sql`
              UPDATE minutes_document
                 SET status = 'review', submitted_for_review_at = ${now}, updated_at = ${now}
               WHERE id = ${doc.id}
            `);
            return { ok: true, value: { minutesDocumentId: doc.id } };
          },
        );

        if (!prepared.ok) return reply[prepared.kind](prepared.message);

        // Fire notification async — do not block response.
        //
        // Task D1f: `tenantJob(fastify.tenantDb, …)` rather than the
        // service-role client. This is the call D1c named as the finish
        // condition for `services/notification-triggers.ts`; with it, the
        // event is queued AND scheduled here, instead of waiting for the next
        // 60-second sweep in `server.ts`.
        const job = tenantJob(fastify.tenantDb, tenant.townId);
        setImmediate(() => {
          triggerMinutesReview(job, meetingId, prepared.value.minutesDocumentId).catch(
            (err: unknown) => {
              fastify.log.error({ err }, "triggerMinutesReview failed");
            },
          );
        });

        return reply.send({ ok: true, status: "review" });
      }),
  );

  // ─── Approve Minutes ────────────────────────────────────────────
  fastify.post<{ Params: MeetingParams }>(
    "/meetings/:meetingId/minutes/approve",
    {
      // Was `requirePermission("approve_minutes")`. There is no such governable
      // action — the thirty are in `shared/constants/permissions.ts` — so the
      // matrix lookup could never return true and only the admin short-circuit
      // inside `requirePermission` ever let anyone through. This is therefore
      // BEHAVIOUR-IDENTICAL, and says what the route has always actually done.
      // Whether minutes approval should instead be delegable (R5,
      // `publish_approved_minutes`, is the nearest existing action) is a
      // product decision for the owner, not a change to make while closing an
      // auth hole. Flagged in the G1 report, and re-flagged in D1f's: this is a
      // real gap, not a stale comment, and it is still open.
      //
      // Task D1f left this guard in the preHandler while moving the other four
      // routes' guards into their handlers. That is not an oversight: the other
      // four are board-scoped codes, which is exactly what a preHandler cannot
      // resolve. `requireAdmin` admits the town `admin` role and nothing else,
      // and no `board_override` can grant or revoke a role — so there is no
      // board to scope it to and nothing a handler would learn by waiting.
      preHandler: [fastify.verifyAuth, requireAdmin("approving minutes")],
    },
    async (request, reply) =>
      handleRouteErrors(request, reply, async () => {
        const { meetingId } = request.params;
        const { tenant, withTenant } = scopeOf(request);
        const now = new Date().toISOString();

        const prepared = await withTenant(
          async (tx): Promise<Prepared<{ minutesDocumentId: string }>> => {
            await loadMeeting(tx, meetingId);

            const doc = rows<{ id: string; status: string }>(
              await tx.execute(sql`
                SELECT id, status::text AS status FROM minutes_document
                 WHERE meeting_id = ${meetingId}
              `),
              "minutesDoc",
            )[0];
            if (!doc) throw new DocumentNotFoundError("No minutes document found");
            if (doc.status !== "review") {
              return refuse("badRequest", `Cannot approve minutes with status "${doc.status}"`);
            }

            await tx.execute(sql`
              UPDATE minutes_document
                 SET status = 'approved', approved_at = ${now}, updated_at = ${now}
               WHERE id = ${doc.id}
            `);
            return { ok: true, value: { minutesDocumentId: doc.id } };
          },
        );

        if (!prepared.ok) return reply[prepared.kind](prepared.message);

        const job = tenantJob(fastify.tenantDb, tenant.townId);
        setImmediate(() => {
          triggerMinutesApproved(job, meetingId, prepared.value.minutesDocumentId).catch(
            (err: unknown) => {
              fastify.log.error({ err }, "triggerMinutesApproved failed");
            },
          );
        });

        return reply.send({ ok: true, status: "approved" });
      }),
  );
}
