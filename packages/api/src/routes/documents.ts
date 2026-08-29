/**
 * Document generation routes.
 *
 * POST /api/meetings/:meetingId/agenda-packet  — Puppeteer PDF
 * POST /api/meetings/:meetingId/meeting-notice  — pdf-lib PDF
 *
 * ─── Stage 1, Task D1f: what changed here, and why ────────────────────────
 *
 * Both routes ran on `fastify.supabase` — the service-role client, which
 * bypasses row level security. Fourteen calls: four reads whose tenancy was
 * one hand-written `meeting.town_id !== user.townId` comparison in TypeScript,
 * four storage calls against a bucket declared `public = true`, and two writes
 * back to `meeting`.
 *
 * Three separate things are now different.
 *
 * **Tenancy is the database's.** Every read and write below happens inside
 * `request.withTenant`, so a meeting id belonging to another town returns no
 * row rather than that town's agenda. The `town_id !== user.townId` check is
 * gone — not because it was wrong, but because it was the only thing standing
 * there, and a cross-tenant check settled by a comparison a future edit can
 * delete is not a boundary.
 *
 * **Authorization is board-scoped.** This is the confirmed defect this task
 * exists to close. Both routes were guarded by
 * `requirePermission("generate_agenda_packet")` in the preHandler, and that
 * guard resolves A6 with NO board — a Fastify preHandler runs before any body
 * parsing and has no meeting to resolve one from. A6 is granted PER BOARD by
 * `TEMPLATE_BOARD_SPECIFIC_STAFF` and globally by neither shipped template, so
 * the global check was wrong in both directions: it refused every
 * board-designated clerk, and it ALLOWED a clerk whose town had explicitly
 * revoked A6 for this board. The guard is therefore no longer in the
 * preHandler; the handler resolves the meeting, and `rules.ts` is asked about
 * `meeting.board_id`. See `assertCanGenerateMeetingDocument`.
 *
 * **The bytes are in the authorized root.** They used to be uploaded to the
 * Supabase `documents` bucket at
 * `${townId}/meetings/${meetingId}/agenda-packet-${Date.now()}.pdf`, and the
 * resulting PUBLIC url was written into `meeting.agenda_packet_url`. The
 * portal publishes both ids, so the only secret in that path was a millisecond
 * timestamp. They now go into the document root nginx marks `internal`, at a
 * path derived from the two ids, and the column holds
 * `/api/files/agenda-packet/<meetingId>` — a route that applies rule 9b on
 * every fetch. The column still holds a URL because that is what every
 * consumer of it already does with it (the web client opens it in a tab;
 * `shared/types/portal.ts` ships it to the portal), so no client changes.
 *
 * ─── Why the PDF is rendered OUTSIDE the transaction ──────────────────────
 *
 * Two transactions per request, not one: read-and-authorize, then render, then
 * write. Puppeteer takes seconds and holds a Chromium process; a transaction
 * spanning it would hold a pooled connection open for that whole time, which
 * is the same reasoning `jobs/tenant-job.ts` gives for running one unit of
 * work per transaction rather than one per job.
 *
 * The cost is that authorization is decided a moment before the write. That is
 * acceptable here and would not be for a state change: nothing this route
 * writes depends on a permission that could plausibly be revoked inside the
 * render, and the write itself is scoped by RLS regardless.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { loadActor, type Actor } from "../trpc/authorization/actor.js";
import { AuthorizationError } from "../trpc/authorization/permission.js";
import { assertCanGenerateMeetingDocument } from "../trpc/authorization/rules.js";
import { toRows } from "../db/rows.js";
import type { TenantTx } from "../db/with-tenant.js";
import { DocumentNotFoundError } from "../storage/documents.js";
import { handleRouteErrors } from "./error-status.js";
import { generatePdf } from "../services/puppeteer.js";
import {
  renderAgendaPacket,
  type AgendaPacketSection,
  type AgendaPacketItem,
  type AgendaPacketExhibit,
  type AgendaPacketSubItem,
} from "../services/templates.js";
import { generateMeetingNotice } from "../services/pdf-lib.js";
import {
  absoluteSealUrl,
  agendaPacketRelativePath,
  documentRoot,
  meetingNoticeRelativePath,
} from "../storage/paths.js";
import { withWrittenFile } from "../storage/store.js";

// ─── Types ───────────────────────────────────────────────────────────

interface MeetingParams {
  meetingId: string;
}

interface MeetingRow {
  id: string;
  board_id: string;
  town_id: string;
  title: string;
  meeting_type: string;
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
  status: string;
  agenda_status: string;
}

interface AgendaItemRow {
  id: string;
  meeting_id: string;
  section_type: string;
  sort_order: number;
  title: string;
  description: string | null;
  presenter: string | null;
  estimated_duration: number | null;
  parent_item_id: string | null;
  status: string;
  staff_resource: string | null;
  background: string | null;
  recommendation: string | null;
  suggested_motion: string | null;
}

interface ExhibitRow {
  id: string;
  agenda_item_id: string;
  title: string;
  file_name: string | null;
  exhibit_type: string | null;
  sort_order: number;
}

interface BoardRow {
  id: string;
  name: string;
}

interface TownRow {
  id: string;
  name: string;
  seal_url: string | null;
}

function rows<T>(result: unknown, what: string): T[] {
  return toRows<T>(result, (message) => new Error(`documents.${what}: ${message}`));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refuse a non-UUID meeting id with the SAME error a missing row produces.
 *
 * Without it the value goes into `WHERE id = $1` against a `uuid` column,
 * Postgres raises a type error, and the route answers 500 — so a scanner
 * produces a page of driver errors rather than a 404. Same reasoning, same
 * shape, as `requireLookupId` in `storage/documents.ts`.
 */
function requireMeetingId(value: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new DocumentNotFoundError("Meeting not found");
  }
  return value;
}

/**
 * A parameterised list of uuids — see `services/notification-service.ts` for
 * why an array cannot simply be cast to `uuid[]` here.
 */
function uuidList(ids: readonly string[]) {
  return sql`(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`;
}

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
 * Load the meeting, its board and its town, and decide A6 AGAINST THAT BOARD.
 *
 * The order is the whole point: the board comes out of the database before the
 * permission is resolved, so a `board_override` that revokes A6 for this board
 * is consulted. Nothing the client sent reaches the check.
 */
async function loadAndAuthorize(
  tx: TenantTx,
  tenant: { townId: string; personId: string; userAccountId: string },
  meetingId: string,
): Promise<{ actor: Actor; meeting: MeetingRow; board: BoardRow; town: TownRow }> {
  const actor = await loadActor(tx, tenant);

  const meeting = rows<MeetingRow>(
    await tx.execute(sql`SELECT * FROM meeting WHERE id = ${requireMeetingId(meetingId)}`),
    "meeting",
  )[0];
  // Not found and "belongs to another town" are the same answer, and must be:
  // RLS made the second one invisible before any rule ran, and a 403 for one
  // with a 404 for the other would confirm another town's meeting ids.
  if (!meeting) throw new DocumentNotFoundError("Meeting not found");

  assertCanGenerateMeetingDocument(actor, { boardId: meeting.board_id });

  const board = rows<BoardRow>(
    await tx.execute(sql`SELECT id, name FROM board WHERE id = ${meeting.board_id}`),
    "board",
  )[0];
  const town = rows<TownRow>(
    await tx.execute(sql`SELECT id, name, seal_url FROM town WHERE id = ${meeting.town_id}`),
    "town",
  )[0];
  if (!board || !town) throw new DocumentNotFoundError("Board or town not found");

  return { actor, meeting, board, town };
}

// ─── Route Registration ──────────────────────────────────────────────

export async function documentRoutes(fastify: FastifyInstance) {
  // ─── Agenda Packet ───────────────────────────────────────────────
  fastify.post<{ Params: MeetingParams }>(
    "/meetings/:meetingId/agenda-packet",
    async (request, reply) =>
      handleRouteErrors(request, reply, async () => {
        const { meetingId } = request.params;
        const { tenant, withTenant } = scopeOf(request);

        // 1. Everything the render needs, read and authorized in one
        //    transaction.
        const { meeting, board, town, items, exhibits } = await withTenant(async (tx) => {
          const base = await loadAndAuthorize(tx, tenant, meetingId);

          const found = rows<AgendaItemRow>(
            await tx.execute(
              sql`SELECT * FROM agenda_item WHERE meeting_id = ${meetingId} ORDER BY sort_order ASC`,
            ),
            "agenda_items",
          );

          const itemIds = found.map((i) => i.id);
          const attached = itemIds.length
            ? rows<ExhibitRow>(
                await tx.execute(sql`
                  SELECT * FROM exhibit
                   WHERE agenda_item_id IN ${uuidList(itemIds)}
                   ORDER BY sort_order ASC
                `),
                "exhibits",
              )
            : [];

          return { ...base, items: found, exhibits: attached };
        });

        // 2. Build template data — group into sections with children
        const sections = items.filter((i) => !i.parent_item_id);
        const templateSections: AgendaPacketSection[] = sections.map((section) => {
          const children = items
            .filter((i) => i.parent_item_id === section.id)
            .sort((a, b) => a.sort_order - b.sort_order);

          const sectionItems: AgendaPacketItem[] = children.map((item) => {
            const itemExhibits: AgendaPacketExhibit[] = exhibits
              .filter((e) => e.agenda_item_id === item.id)
              .map((e) => ({
                title: e.title,
                fileName: e.file_name,
                exhibitType: e.exhibit_type,
              }));

            // Sub-items are not currently nested deeper, but support them
            return {
              title: item.title,
              description: item.description,
              presenter: item.presenter,
              estimatedDuration: item.estimated_duration,
              staffResource: item.staff_resource,
              background: item.background,
              recommendation: item.recommendation,
              suggestedMotion: item.suggested_motion,
              exhibits: itemExhibits,
              subItems: [] as AgendaPacketSubItem[],
            };
          });

          return {
            title: section.title,
            sectionType: section.section_type,
            items: sectionItems,
          };
        });

        // 3. Render HTML (hasExhibits computed inside renderAgendaPacket)
        const html = renderAgendaPacket({
          townName: town.name,
          boardName: board.name,
          meetingTitle: meeting.title,
          meetingType: meeting.meeting_type,
          scheduledDate: meeting.scheduled_date,
          scheduledTime: meeting.scheduled_time,
          location: meeting.location,
          // Absolute: Chromium fetches it during PDF rendering, from a page
          // loaded with no base URL. See `absoluteSealUrl`.
          sealUrl: absoluteSealUrl(town.seal_url),
          sections: templateSections,
        });

        // 4. Generate PDF
        const formattedDate = meeting.scheduled_date
          ? new Date(meeting.scheduled_date + "T00:00:00").toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : "";

        let pdf: Buffer;
        try {
          pdf = await generatePdf(html, {
            headerTemplate: `<div style="font-size:9px; text-align:center; width:100%; color:#666;">${board.name} — ${formattedDate}</div>`,
            footerTemplate:
              '<div style="font-size:9px; text-align:center; width:100%; color:#666;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
          });
        } catch (err) {
          request.log.error(err, "PDF generation failed");
          return reply.internalServerError("PDF generation failed");
        }

        // 5. File first, row second — see `storage/store.ts` for the ordering
        //    argument. One path per meeting, so a regeneration supersedes its
        //    predecessor rather than leaving an orphan nothing points at.
        const now = new Date().toISOString();
        const url = meetingDocumentUrl("agenda-packet", meetingId);
        await withWrittenFile(
          documentRoot(),
          agendaPacketRelativePath(meeting.town_id, meetingId),
          pdf,
          async () => {
            await withTenant(async (tx) => {
              await tx.execute(sql`
                UPDATE meeting
                   SET agenda_packet_url = ${url},
                       agenda_packet_generated_at = ${now}
                 WHERE id = ${meetingId}
              `);
            });
          },
          {
            onCleanupError: (err) =>
              request.log.error({ err }, "failed to remove an agenda packet after a failed update"),
          },
        );

        return { url, fileSize: pdf.length, generatedAt: now };
      }),
  );

  // ─── Meeting Notice ─────────────────────────────────────────────
  fastify.post<{ Params: MeetingParams }>(
    "/meetings/:meetingId/meeting-notice",
    async (request, reply) =>
      handleRouteErrors(request, reply, async () => {
        const { meetingId } = request.params;
        const { tenant, withTenant } = scopeOf(request);

        const { meeting, board, town } = await withTenant((tx) =>
          loadAndAuthorize(tx, tenant, meetingId),
        );

        let pdf: Buffer;
        try {
          pdf = await generateMeetingNotice({
            townName: town.name,
            boardName: board.name,
            meetingType: meeting.meeting_type,
            meetingDate: meeting.scheduled_date,
            meetingTime: meeting.scheduled_time,
            location: meeting.location,
          });
        } catch (err) {
          request.log.error(err, "Meeting notice generation failed");
          return reply.internalServerError("Meeting notice generation failed");
        }

        const now = new Date().toISOString();
        const url = meetingDocumentUrl("meeting-notice", meetingId);
        await withWrittenFile(
          documentRoot(),
          meetingNoticeRelativePath(meeting.town_id, meetingId),
          pdf,
          async () => {
            await withTenant(async (tx) => {
              await tx.execute(sql`
                UPDATE meeting
                   SET meeting_notice_url = ${url},
                       meeting_notice_generated_at = ${now}
                 WHERE id = ${meetingId}
              `);
            });
          },
          {
            onCleanupError: (err) =>
              request.log.error({ err }, "failed to remove a meeting notice after a failed update"),
          },
        );

        return { url, fileSize: pdf.length, generatedAt: now };
      }),
  );
}

/**
 * Where a client fetches a generated meeting document.
 *
 * Stage 1, Task D1f — the same move `routes/minutes.ts` records for minutes
 * PDFs. This used to be `supabase.storage.from("documents").getPublicUrl(path)`:
 * a URL into a bucket declared `public = true`, handed back to the caller,
 * stored in `meeting.agenda_packet_url`, and fetchable by anyone holding the
 * string. It is now a route on this API, and rule 9b runs on every fetch.
 */
function meetingDocumentUrl(kind: "agenda-packet" | "meeting-notice", meetingId: string): string {
  return `/api/files/${kind}/${meetingId}`;
}
