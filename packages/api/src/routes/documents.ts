/**
 * Document generation routes.
 *
 * POST /api/meetings/:meetingId/agenda-packet  — Puppeteer PDF
 * POST /api/meetings/:meetingId/meeting-notice  — pdf-lib PDF
 */

import type { FastifyInstance } from "fastify";
import { requirePermission } from "../plugins/auth.js";
import { generatePdf } from "../services/puppeteer.js";
import {
  renderAgendaPacket,
  type AgendaPacketSection,
  type AgendaPacketItem,
  type AgendaPacketExhibit,
  type AgendaPacketSubItem,
} from "../services/templates.js";
import { generateMeetingNotice } from "../services/pdf-lib.js";

// ─── Types ───────────────────────────────────────────────────────────

interface MeetingParams {
  meetingId: string;
}

// DB row types (from Supabase query results)
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

// ─── Route Registration ──────────────────────────────────────────────

export async function documentRoutes(fastify: FastifyInstance) {
  // ─── Agenda Packet ───────────────────────────────────────────────
  fastify.post<{ Params: MeetingParams }>(
    "/meetings/:meetingId/agenda-packet",
    {
      preHandler: [
        fastify.verifyAuth,
        requirePermission("generate_agenda_packet"),
      ],
    },
    async (request, reply) => {
      const { meetingId } = request.params;
      const user = request.user!;

      // 1. Fetch meeting
      const { data: meeting, error: meetingErr } = await fastify.supabase
        .from("meeting")
        .select("*")
        .eq("id", meetingId)
        .single<MeetingRow>();

      if (meetingErr || !meeting) {
        return reply.notFound("Meeting not found");
      }

      if (meeting.town_id !== user.townId) {
        return reply.forbidden("Meeting belongs to a different town");
      }

      // 2. Fetch related data
      const [itemsResult, boardResult, townResult] = await Promise.all([
        fastify.supabase
          .from("agenda_item")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("sort_order", { ascending: true })
          .returns<AgendaItemRow[]>(),
        fastify.supabase
          .from("board")
          .select("id, name")
          .eq("id", meeting.board_id)
          .single<BoardRow>(),
        fastify.supabase
          .from("town")
          .select("id, name, seal_url")
          .eq("id", meeting.town_id)
          .single<TownRow>(),
      ]);

      const items = itemsResult.data ?? [];
      const board = boardResult.data;
      const town = townResult.data;

      if (!board || !town) {
        return reply.notFound("Board or town not found");
      }

      // Fetch exhibits for all agenda items
      const itemIds = items.map((i) => i.id);
      const { data: exhibits } = itemIds.length
        ? await fastify.supabase
            .from("exhibit")
            .select("*")
            .in("agenda_item_id", itemIds)
            .order("sort_order", { ascending: true })
            .returns<ExhibitRow[]>()
        : { data: [] as ExhibitRow[] };

      const allExhibits = exhibits ?? [];

      // 3. Build template data — group into sections with children
      const sections = items.filter((i) => !i.parent_item_id);
      const templateSections: AgendaPacketSection[] = sections.map(
        (section) => {
          const children = items
            .filter((i) => i.parent_item_id === section.id)
            .sort((a, b) => a.sort_order - b.sort_order);

          const sectionItems: AgendaPacketItem[] = children.map((item) => {
            const itemExhibits: AgendaPacketExhibit[] = allExhibits
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
        },
      );

      // 4. Render HTML (hasExhibits computed inside renderAgendaPacket)
      const html = renderAgendaPacket({
        townName: town.name,
        boardName: board.name,
        meetingTitle: meeting.title,
        meetingType: meeting.meeting_type,
        scheduledDate: meeting.scheduled_date,
        scheduledTime: meeting.scheduled_time,
        location: meeting.location,
        sealUrl: town.seal_url,
        sections: templateSections,
      });

      // 5. Generate PDF
      const formattedDate = meeting.scheduled_date
        ? new Date(meeting.scheduled_date + "T00:00:00").toLocaleDateString(
            "en-US",
            { month: "long", day: "numeric", year: "numeric" },
          )
        : "";

      let pdf: Buffer;
      try {
        pdf = await generatePdf(html, {
            headerTemplate: `<div style="font-size:9px; text-align:center; width:100%; color:#666;">${board.name} — ${formattedDate}</div>`,
            footerTemplate:
              '<div style="font-size:9px; text-align:center; width:100%; color:#666;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
          },
        );
      } catch (err) {
        request.log.error(err, "PDF generation failed");
        return reply.internalServerError("PDF generation failed");
      }

      // 6. Upload to Supabase Storage
      const timestamp = Date.now();
      const storagePath = `${meeting.town_id}/meetings/${meetingId}/agenda-packet-${timestamp}.pdf`;

      const { error: uploadErr } = await fastify.supabase.storage
        .from("documents")
        .upload(storagePath, pdf, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadErr) {
        request.log.error(uploadErr, "Storage upload failed");
        return reply.internalServerError("Failed to upload PDF");
      }

      const {
        data: { publicUrl },
      } = fastify.supabase.storage
        .from("documents")
        .getPublicUrl(storagePath);

      // 7. Update meeting record
      const now = new Date().toISOString();
      await fastify.supabase
        .from("meeting")
        .update({
          agenda_packet_url: publicUrl,
          agenda_packet_generated_at: now,
        })
        .eq("id", meetingId);

      return {
        url: publicUrl,
        fileSize: pdf.length,
        generatedAt: now,
      };
    },
  );

  // ─── Meeting Notice ─────────────────────────────────────────────
  fastify.post<{ Params: MeetingParams }>(
    "/meetings/:meetingId/meeting-notice",
    {
      preHandler: [
        fastify.verifyAuth,
        requirePermission("generate_agenda_packet"),
      ],
    },
    async (request, reply) => {
      const { meetingId } = request.params;
      const user = request.user!;

      // Fetch meeting, board, town
      const { data: meeting, error: meetingErr } = await fastify.supabase
        .from("meeting")
        .select("*")
        .eq("id", meetingId)
        .single<MeetingRow>();

      if (meetingErr || !meeting) {
        return reply.notFound("Meeting not found");
      }

      if (meeting.town_id !== user.townId) {
        return reply.forbidden("Meeting belongs to a different town");
      }

      const [boardResult, townResult] = await Promise.all([
        fastify.supabase
          .from("board")
          .select("id, name")
          .eq("id", meeting.board_id)
          .single<BoardRow>(),
        fastify.supabase
          .from("town")
          .select("id, name")
          .eq("id", meeting.town_id)
          .single<TownRow>(),
      ]);

      const board = boardResult.data;
      const town = townResult.data;

      if (!board || !town) {
        return reply.notFound("Board or town not found");
      }

      // Generate PDF
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

      // Upload to Storage
      const timestamp = Date.now();
      const storagePath = `${meeting.town_id}/meetings/${meetingId}/meeting-notice-${timestamp}.pdf`;

      const { error: uploadErr } = await fastify.supabase.storage
        .from("documents")
        .upload(storagePath, pdf, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadErr) {
        request.log.error(uploadErr, "Storage upload failed");
        return reply.internalServerError("Failed to upload PDF");
      }

      const {
        data: { publicUrl },
      } = fastify.supabase.storage
        .from("documents")
        .getPublicUrl(storagePath);

      // Update meeting record
      const now = new Date().toISOString();
      await fastify.supabase
        .from("meeting")
        .update({
          meeting_notice_url: publicUrl,
          meeting_notice_generated_at: now,
        })
        .eq("id", meetingId);

      return {
        url: publicUrl,
        fileSize: pdf.length,
        generatedAt: now,
      };
    },
  );
}
