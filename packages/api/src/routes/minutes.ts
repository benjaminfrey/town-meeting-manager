/**
 * Minutes generation routes.
 *
 * POST /api/meetings/:meetingId/minutes/generate
 *   — Generate a minutes draft (JSON → HTML → PDF)
 *
 * POST /api/meetings/:meetingId/minutes/regenerate
 *   — Overwrite an existing minutes draft
 */

import type { FastifyInstance } from "fastify";
import { requirePermission } from "../plugins/auth.js";
import { assembleMinutesJson } from "../services/minutes-assembler.js";
import { formatMinutes } from "../services/minutes-formatters.js";
import { renderMinutes } from "../services/templates.js";
import { generateMinutesPdf } from "../services/minutes-pdf.js";
import type { MinutesRenderOptions } from "@town-meeting/shared";

// ─── Types ───────────────────────────────────────────────────────

interface MeetingParams {
  meetingId: string;
}

interface GenerateBody {
  minutes_style_override?: string;
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
}

// ─── Route Registration ─────────────────────────────────────────

export async function minutesRoutes(fastify: FastifyInstance) {

  // ─── Generate Minutes Draft ─────────────────────────────────────
  fastify.post<{ Params: MeetingParams; Body: GenerateBody }>(
    "/meetings/:meetingId/minutes/generate",
    {
      preHandler: [
        fastify.verifyAuth,
        requirePermission("generate_ai_minutes"),
      ],
    },
    async (request, reply) => {
      const { meetingId } = request.params;
      const user = request.user!;

      // 1. Fetch meeting
      const { data: meeting, error: meetingErr } = await fastify.supabase
        .from("meeting")
        .select("id, board_id, town_id, title, meeting_type, scheduled_date, status")
        .eq("id", meetingId)
        .single<MeetingRow>();

      if (meetingErr || !meeting) {
        return reply.notFound("Meeting not found");
      }

      if (meeting.town_id !== user.townId) {
        return reply.forbidden("Meeting belongs to a different town");
      }

      // Meeting must be adjourned or later in the lifecycle
      const validStatuses = ["adjourned", "minutes_draft", "approved"];
      if (!validStatuses.includes(meeting.status)) {
        return reply.badRequest(
          `Meeting status must be adjourned or later to generate minutes. Current status: ${meeting.status}`,
        );
      }

      // 2. Check for existing minutes
      const { data: existingMinutes } = await fastify.supabase
        .from("minutes_document")
        .select("id, meeting_id, status")
        .eq("meeting_id", meetingId)
        .single<MinutesDocRow>();

      if (existingMinutes) {
        return reply.conflict(
          "Minutes already exist for this meeting. Use /regenerate to overwrite.",
        );
      }

      // 3. Fetch board and town for render options
      const [boardResult, townResult] = await Promise.all([
        fastify.supabase
          .from("board")
          .select("id, name, motion_display_format, certification_format, member_reference_style, minutes_style_override")
          .eq("id", meeting.board_id)
          .single<BoardRow>(),
        fastify.supabase
          .from("town")
          .select("id, name, minutes_style, seal_url")
          .eq("id", meeting.town_id)
          .single<TownRow>(),
      ]);

      const board = boardResult.data;
      const town = townResult.data;
      if (!board || !town) {
        return reply.notFound("Board or town not found");
      }

      // Resolve minutes style: override from request > board override > town default
      const minutesStyle =
        request.body?.minutes_style_override ??
        board.minutes_style_override ??
        town.minutes_style ??
        "summary";

      const renderOptions: MinutesRenderOptions = {
        minutes_style: minutesStyle as MinutesRenderOptions["minutes_style"],
        motion_display_format: (board.motion_display_format ?? "inline_narrative") as MinutesRenderOptions["motion_display_format"],
        member_reference_style: (board.member_reference_style ?? "title_and_last_name") as MinutesRenderOptions["member_reference_style"],
        certification_format: (board.certification_format ?? "prepared_by") as MinutesRenderOptions["certification_format"],
        is_draft: true,
        town_seal_url: town.seal_url,
      };

      try {
        // 4. Assemble structured JSON
        const contentJson = await assembleMinutesJson(fastify.supabase, meetingId);

        // 5. Format content by style
        const formattedContent = formatMinutes(contentJson, renderOptions);

        // 6. Render HTML
        const meetingTypeLabels: Record<string, string> = {
          regular: "Regular Meeting",
          special: "Special Meeting",
          public_hearing: "Public Hearing",
          emergency: "Emergency Meeting",
        };
        const formattedDate = new Date(meeting.scheduled_date + "T00:00:00")
          .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

        const html = renderMinutes({
          isDraft: true,
          sealUrl: town.seal_url,
          townName: town.name,
          boardName: board.name,
          meetingHeader: formattedContent.meeting_header as unknown as Record<string, unknown>,
          attendance: formattedContent.attendance as unknown as Record<string, unknown>,
          sections: formattedContent.sections as unknown as Array<Record<string, unknown>>,
          adjournmentText: formattedContent.adjournment_text,
          certification: formattedContent.certification as unknown as Record<string, unknown>,
          formattedDate,
          formattedMeetingType: meetingTypeLabels[meeting.meeting_type] ?? meeting.meeting_type,
        });

        // 7. Generate PDF
        const pdfStoragePath = await generateMinutesPdf(
          fastify.supabase,
          html,
          meetingId,
          meeting.town_id,
          meeting.board_id,
          {
            townName: town.name,
            boardName: board.name,
            meetingDate: meeting.scheduled_date,
            isDraft: true,
          },
        );

        // 8. Create minutes_document record
        const now = new Date().toISOString();
        const { data: minutesDoc, error: insertErr } = await fastify.supabase
          .from("minutes_document")
          .insert({
            meeting_id: meetingId,
            board_id: meeting.board_id,
            town_id: meeting.town_id,
            status: "draft",
            content_json: contentJson,
            html_rendered: html,
            pdf_storage_path: pdfStoragePath,
            minutes_style: minutesStyle,
            generated_by: "ai",
            created_by: user.id,
            created_at: now,
            updated_at: now,
          })
          .select("id, status, minutes_style, pdf_storage_path, created_at")
          .single();

        if (insertErr) {
          request.log.error(insertErr, "Failed to insert minutes_document");
          return reply.internalServerError("Failed to save minutes document");
        }

        // 9. Update meeting status to minutes_draft
        if (meeting.status === "adjourned") {
          await fastify.supabase
            .from("meeting")
            .update({ status: "minutes_draft", updated_at: now })
            .eq("id", meetingId);
        }

        // Get public URL for the PDF
        const { data: { publicUrl } } = fastify.supabase.storage
          .from("documents")
          .getPublicUrl(pdfStoragePath);

        return {
          id: minutesDoc.id,
          status: minutesDoc.status,
          minutes_style: minutesDoc.minutes_style,
          pdf_url: publicUrl,
          created_at: minutesDoc.created_at,
        };
      } catch (err) {
        request.log.error(err, "Minutes generation failed");
        return reply.internalServerError(
          `Minutes generation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  );

  // ─── Regenerate Minutes ────────────────────────────────────────
  fastify.post<{ Params: MeetingParams; Body: GenerateBody }>(
    "/meetings/:meetingId/minutes/regenerate",
    {
      preHandler: [
        fastify.verifyAuth,
        requirePermission("generate_ai_minutes"),
      ],
    },
    async (request, reply) => {
      const { meetingId } = request.params;
      const user = request.user!;

      // 1. Fetch meeting
      const { data: meeting, error: meetingErr } = await fastify.supabase
        .from("meeting")
        .select("id, board_id, town_id, title, meeting_type, scheduled_date, status")
        .eq("id", meetingId)
        .single<MeetingRow>();

      if (meetingErr || !meeting) {
        return reply.notFound("Meeting not found");
      }

      if (meeting.town_id !== user.townId) {
        return reply.forbidden("Meeting belongs to a different town");
      }

      // 2. Verify existing minutes exist
      const { data: existingMinutes } = await fastify.supabase
        .from("minutes_document")
        .select("id, status")
        .eq("meeting_id", meetingId)
        .single<MinutesDocRow>();

      if (!existingMinutes) {
        return reply.notFound("No existing minutes found. Use /generate instead.");
      }

      // Cannot regenerate approved or published minutes
      if (existingMinutes.status === "approved" || existingMinutes.status === "published") {
        return reply.badRequest("Cannot regenerate approved or published minutes.");
      }

      // 3. Fetch board and town
      const [boardResult, townResult] = await Promise.all([
        fastify.supabase
          .from("board")
          .select("id, name, motion_display_format, certification_format, member_reference_style, minutes_style_override")
          .eq("id", meeting.board_id)
          .single<BoardRow>(),
        fastify.supabase
          .from("town")
          .select("id, name, minutes_style, seal_url")
          .eq("id", meeting.town_id)
          .single<TownRow>(),
      ]);

      const board = boardResult.data;
      const town = townResult.data;
      if (!board || !town) {
        return reply.notFound("Board or town not found");
      }

      const minutesStyle =
        request.body?.minutes_style_override ??
        board.minutes_style_override ??
        town.minutes_style ??
        "summary";

      const renderOptions: MinutesRenderOptions = {
        minutes_style: minutesStyle as MinutesRenderOptions["minutes_style"],
        motion_display_format: (board.motion_display_format ?? "inline_narrative") as MinutesRenderOptions["motion_display_format"],
        member_reference_style: (board.member_reference_style ?? "title_and_last_name") as MinutesRenderOptions["member_reference_style"],
        certification_format: (board.certification_format ?? "prepared_by") as MinutesRenderOptions["certification_format"],
        is_draft: true,
        town_seal_url: town.seal_url,
      };

      try {
        const contentJson = await assembleMinutesJson(fastify.supabase, meetingId);
        const formattedContent = formatMinutes(contentJson, renderOptions);

        const meetingTypeLabels: Record<string, string> = {
          regular: "Regular Meeting",
          special: "Special Meeting",
          public_hearing: "Public Hearing",
          emergency: "Emergency Meeting",
        };
        const formattedDate = new Date(meeting.scheduled_date + "T00:00:00")
          .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

        const html = renderMinutes({
          isDraft: true,
          sealUrl: town.seal_url,
          townName: town.name,
          boardName: board.name,
          meetingHeader: formattedContent.meeting_header as unknown as Record<string, unknown>,
          attendance: formattedContent.attendance as unknown as Record<string, unknown>,
          sections: formattedContent.sections as unknown as Array<Record<string, unknown>>,
          adjournmentText: formattedContent.adjournment_text,
          certification: formattedContent.certification as unknown as Record<string, unknown>,
          formattedDate,
          formattedMeetingType: meetingTypeLabels[meeting.meeting_type] ?? meeting.meeting_type,
        });

        const pdfStoragePath = await generateMinutesPdf(
          fastify.supabase,
          html,
          meetingId,
          meeting.town_id,
          meeting.board_id,
          {
            townName: town.name,
            boardName: board.name,
            meetingDate: meeting.scheduled_date,
            isDraft: true,
          },
        );

        // Update existing record
        const now = new Date().toISOString();
        const { data: updated, error: updateErr } = await fastify.supabase
          .from("minutes_document")
          .update({
            status: "draft",
            content_json: contentJson,
            html_rendered: html,
            pdf_storage_path: pdfStoragePath,
            minutes_style: minutesStyle,
            generated_by: "ai",
            updated_at: now,
          })
          .eq("id", existingMinutes.id)
          .select("id, status, minutes_style, pdf_storage_path, created_at")
          .single();

        if (updateErr) {
          request.log.error(updateErr, "Failed to update minutes_document");
          return reply.internalServerError("Failed to update minutes document");
        }

        const { data: { publicUrl } } = fastify.supabase.storage
          .from("documents")
          .getPublicUrl(pdfStoragePath);

        return {
          id: updated.id,
          status: updated.status,
          minutes_style: updated.minutes_style,
          pdf_url: publicUrl,
          regenerated: true,
          created_at: updated.created_at,
        };
      } catch (err) {
        request.log.error(err, "Minutes regeneration failed");
        return reply.internalServerError(
          `Minutes regeneration failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  );
}
