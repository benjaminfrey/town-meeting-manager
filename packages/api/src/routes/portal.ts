/**
 * Public portal routes — no authentication required.
 *
 * These endpoints serve the public-facing portal for towns,
 * providing access to meetings, agendas, minutes, boards, and calendars.
 *
 * All queries enforce town_id filtering for multi-tenant isolation.
 */

import type { FastifyInstance } from "fastify";

// ─── Types ───────────────────────────────────────────────────────

interface TownParams {
  townId: string;
}

interface MeetingParams extends TownParams {
  meetingId: string;
}

interface BoardParams extends TownParams {
  boardId: string;
}

interface ResolveQuery {
  subdomain: string;
}

interface MeetingsQuery {
  board?: string;
  page?: string;
}

interface CalendarQuery {
  start: string;
  end: string;
}

const EXCLUDED_STATUSES = ["draft", "cancelled"];
const PAGE_SIZE = 20;

// ─── Route Registration ─────────────────────────────────────────

export async function portalRoutes(fastify: FastifyInstance) {
  // ─── GET /resolve?subdomain=X ──────────────────────────────────
  fastify.get<{ Querystring: ResolveQuery }>(
    "/resolve",
    async (request, reply) => {
      const { subdomain } = request.query;

      if (!subdomain) {
        return reply.badRequest("subdomain query parameter is required");
      }

      const { data: town, error } = await fastify.supabase
        .from("town")
        .select("id, name, state, municipality_type, seal_url, contact_name, contact_role, subdomain")
        .eq("subdomain", subdomain)
        .single();

      if (error || !town) {
        return reply.notFound("Town not found");
      }

      return town;
    },
  );

  // ─── GET /:townId/meetings?board=X&page=N ─────────────────────
  fastify.get<{ Params: TownParams; Querystring: MeetingsQuery }>(
    "/:townId/meetings",
    async (request, _reply) => {
      const { townId } = request.params;
      const boardId = request.query.board;
      const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
      const offset = (page - 1) * PAGE_SIZE;

      // Get today's date for sorting
      const today = new Date().toISOString().split("T")[0];

      // Build base query for total count
      let countQuery = fastify.supabase
        .from("meeting")
        .select("id", { count: "exact", head: true })
        .eq("town_id", townId)
        .not("status", "in", `(${EXCLUDED_STATUSES.join(",")})`);

      if (boardId) {
        countQuery = countQuery.eq("board_id", boardId);
      }

      const { count: total } = await countQuery;

      // Fetch upcoming meetings (scheduled_date >= today), ascending
      let upcomingQuery = fastify.supabase
        .from("meeting")
        .select("id, title, board_id, scheduled_date, scheduled_time, location, meeting_type, status, agenda_status")
        .eq("town_id", townId)
        .not("status", "in", `(${EXCLUDED_STATUSES.join(",")})`)
        .gte("scheduled_date", today)
        .order("scheduled_date", { ascending: true });

      if (boardId) {
        upcomingQuery = upcomingQuery.eq("board_id", boardId);
      }

      const { data: upcoming } = await upcomingQuery;

      // Fetch past meetings (scheduled_date < today), descending
      let pastQuery = fastify.supabase
        .from("meeting")
        .select("id, title, board_id, scheduled_date, scheduled_time, location, meeting_type, status, agenda_status")
        .eq("town_id", townId)
        .not("status", "in", `(${EXCLUDED_STATUSES.join(",")})`)
        .lt("scheduled_date", today)
        .order("scheduled_date", { ascending: false });

      if (boardId) {
        pastQuery = pastQuery.eq("board_id", boardId);
      }

      const { data: past } = await pastQuery;

      // Combine: upcoming first, then past
      const allMeetings = [...(upcoming ?? []), ...(past ?? [])];
      const paginated = allMeetings.slice(offset, offset + PAGE_SIZE);

      // Batch-fetch board names for unique board_ids
      const uniqueBoardIds = [...new Set(paginated.map((m) => m.board_id))];
      const boardNameMap: Record<string, string> = {};

      if (uniqueBoardIds.length > 0) {
        const { data: boards } = await fastify.supabase
          .from("board")
          .select("id, name")
          .in("id", uniqueBoardIds);

        for (const b of boards ?? []) {
          boardNameMap[b.id] = b.name;
        }
      }

      // Check which meetings have published minutes
      const meetingIds = paginated.map((m) => m.id);
      const publishedMinutesSet = new Set<string>();

      if (meetingIds.length > 0) {
        const { data: minutesDocs } = await fastify.supabase
          .from("minutes_document")
          .select("meeting_id")
          .in("meeting_id", meetingIds)
          .eq("status", "published");

        for (const doc of minutesDocs ?? []) {
          publishedMinutesSet.add(doc.meeting_id);
        }
      }

      const meetings = paginated.map((m) => ({
        ...m,
        board_name: boardNameMap[m.board_id] ?? null,
        has_published_minutes: publishedMinutesSet.has(m.id),
      }));

      return { meetings, total: total ?? 0, page };
    },
  );

  // ─── GET /:townId/meetings/:meetingId ──────────────────────────
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId",
    async (request, reply) => {
      const { townId, meetingId } = request.params;

      const { data: meeting, error } = await fastify.supabase
        .from("meeting")
        .select("id, title, board_id, scheduled_date, scheduled_time, location, meeting_type, status, agenda_status")
        .eq("id", meetingId)
        .eq("town_id", townId)
        .not("status", "in", `(${EXCLUDED_STATUSES.join(",")})`)
        .single();

      if (error || !meeting) {
        return reply.notFound("Meeting not found");
      }

      // Fetch board name
      const { data: board } = await fastify.supabase
        .from("board")
        .select("name")
        .eq("id", meeting.board_id)
        .single();

      // Check for published minutes
      const { data: minutesDoc } = await fastify.supabase
        .from("minutes_document")
        .select("id")
        .eq("meeting_id", meetingId)
        .eq("town_id", townId)
        .eq("status", "published")
        .maybeSingle();

      return {
        ...meeting,
        board_name: board?.name ?? null,
        has_published_agenda: meeting.agenda_status === "published",
        has_published_minutes: !!minutesDoc,
      };
    },
  );

  // ─── GET /:townId/meetings/:meetingId/agenda ───────────────────
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId/agenda",
    async (request, reply) => {
      const { townId, meetingId } = request.params;

      // Verify meeting exists and agenda is published
      const { data: meeting, error } = await fastify.supabase
        .from("meeting")
        .select("id, title, board_id, scheduled_date, scheduled_time, location, meeting_type, agenda_status")
        .eq("id", meetingId)
        .eq("town_id", townId)
        .single();

      if (error || !meeting) {
        return reply.notFound("Meeting not found");
      }

      if (meeting.agenda_status !== "published") {
        return reply.notFound("Agenda is not published");
      }

      // Fetch board name
      const { data: board } = await fastify.supabase
        .from("board")
        .select("name")
        .eq("id", meeting.board_id)
        .single();

      // Fetch agenda items ordered by sort_order
      const { data: items } = await fastify.supabase
        .from("agenda_item")
        .select("id, title, description, item_type, sort_order, parent_item_id, duration_minutes, presenter")
        .eq("meeting_id", meetingId)
        .eq("town_id", townId)
        .order("sort_order", { ascending: true });

      const allItems = items ?? [];

      // Fetch public exhibits for all agenda items
      const itemIds = allItems.map((i) => i.id);
      const exhibitMap: Record<string, Array<{ id: string; title: string; file_url: string; file_type: string }>> = {};

      if (itemIds.length > 0) {
        const { data: exhibits } = await fastify.supabase
          .from("exhibit")
          .select("id, title, file_url, file_type, agenda_item_id")
          .in("agenda_item_id", itemIds)
          .eq("visibility", "public");

        for (const ex of exhibits ?? []) {
          const key = ex.agenda_item_id as string;
          if (!exhibitMap[key]) exhibitMap[key] = [];
          exhibitMap[key].push({
            id: ex.id,
            title: ex.title,
            file_url: ex.file_url,
            file_type: ex.file_type,
          });
        }
      }

      // Build hierarchy: parent items with nested children
      const parentItems = allItems.filter((i) => !i.parent_item_id);
      const childrenByParent: Record<string, typeof allItems> = {};

      for (const item of allItems) {
        if (item.parent_item_id) {
          if (!childrenByParent[item.parent_item_id]) {
            childrenByParent[item.parent_item_id] = [];
          }
          childrenByParent[item.parent_item_id]!.push(item);
        }
      }

      const sections = parentItems.map((parent) => ({
        ...parent,
        exhibits: exhibitMap[parent.id] ?? [],
        children: (childrenByParent[parent.id] ?? []).map((child) => ({
          ...child,
          exhibits: exhibitMap[child.id] ?? [],
        })),
      }));

      return {
        meeting: {
          id: meeting.id,
          title: meeting.title,
          board_name: board?.name ?? null,
          scheduled_date: meeting.scheduled_date,
          scheduled_time: meeting.scheduled_time,
          location: meeting.location,
          meeting_type: meeting.meeting_type,
        },
        sections,
      };
    },
  );

  // ─── GET /:townId/meetings/:meetingId/minutes ──────────────────
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId/minutes",
    async (request, reply) => {
      const { townId, meetingId } = request.params;

      const { data: minutesDoc, error } = await fastify.supabase
        .from("minutes_document")
        .select("id, html_rendered, approved_at, published_at, pdf_storage_path")
        .eq("meeting_id", meetingId)
        .eq("town_id", townId)
        .eq("status", "published")
        .maybeSingle();

      if (error || !minutesDoc) {
        return reply.notFound("Published minutes not found");
      }

      // Fetch meeting date and board name
      const { data: meeting } = await fastify.supabase
        .from("meeting")
        .select("scheduled_date, board_id")
        .eq("id", meetingId)
        .eq("town_id", townId)
        .single();

      let boardName: string | null = null;
      if (meeting?.board_id) {
        const { data: board } = await fastify.supabase
          .from("board")
          .select("name")
          .eq("id", meeting.board_id)
          .single();
        boardName = board?.name ?? null;
      }

      reply.header("Cache-Control", "public, max-age=3600");

      return {
        html_rendered: minutesDoc.html_rendered,
        approved_at: minutesDoc.approved_at,
        published_at: minutesDoc.published_at,
        meeting_date: meeting?.scheduled_date ?? null,
        board_name: boardName,
        pdf_storage_path: minutesDoc.pdf_storage_path,
      };
    },
  );

  // ─── GET /:townId/meetings/:meetingId/minutes/pdf ──────────────
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId/minutes/pdf",
    async (request, reply) => {
      const { townId, meetingId } = request.params;

      const { data: minutesDoc, error } = await fastify.supabase
        .from("minutes_document")
        .select("pdf_storage_path")
        .eq("meeting_id", meetingId)
        .eq("town_id", townId)
        .eq("status", "published")
        .maybeSingle();

      if (error || !minutesDoc?.pdf_storage_path) {
        return reply.notFound("Published minutes PDF not found");
      }

      const { data: signedUrlData, error: signError } = await fastify.supabase.storage
        .from("minutes")
        .createSignedUrl(minutesDoc.pdf_storage_path, 3600);

      if (signError || !signedUrlData?.signedUrl) {
        return reply.internalServerError("Failed to generate PDF URL");
      }

      reply.header("Cache-Control", "public, max-age=3600");
      return reply.redirect(signedUrlData.signedUrl);
    },
  );

  // ─── GET /:townId/meetings/:meetingId/agenda/pdf ───────────────
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId/agenda/pdf",
    async (request, reply) => {
      const { townId, meetingId } = request.params;

      const { data: meeting, error } = await fastify.supabase
        .from("meeting")
        .select("agenda_packet_url, agenda_status")
        .eq("id", meetingId)
        .eq("town_id", townId)
        .single();

      if (error || !meeting) {
        return reply.notFound("Meeting not found");
      }

      if (meeting.agenda_status !== "published") {
        return reply.notFound("Agenda is not published");
      }

      if (!meeting.agenda_packet_url) {
        return reply.notFound("Agenda PDF not available");
      }

      const { data: signedUrlData, error: signError } = await fastify.supabase.storage
        .from("minutes")
        .createSignedUrl(meeting.agenda_packet_url, 3600);

      if (signError || !signedUrlData?.signedUrl) {
        return reply.internalServerError("Failed to generate PDF URL");
      }

      reply.header("Cache-Control", "public, max-age=3600");
      return reply.redirect(signedUrlData.signedUrl);
    },
  );

  // ─── GET /:townId/boards ───────────────────────────────────────
  fastify.get<{ Params: TownParams }>(
    "/:townId/boards",
    async (request, reply) => {
      const { townId } = request.params;

      const { data: boards, error } = await fastify.supabase
        .from("board")
        .select("id, name, board_type, elected_or_appointed, member_count")
        .eq("town_id", townId)
        .is("archived_at", null)
        .order("name", { ascending: true });

      if (error) {
        return reply.internalServerError("Failed to fetch boards");
      }

      return boards ?? [];
    },
  );

  // ─── GET /:townId/boards/:boardId ──────────────────────────────
  fastify.get<{ Params: BoardParams }>(
    "/:townId/boards/:boardId",
    async (request, reply) => {
      const { townId, boardId } = request.params;

      const { data: board, error } = await fastify.supabase
        .from("board")
        .select("id, name, board_type, elected_or_appointed, member_count, meeting_schedule, quorum_type, quorum_custom_value")
        .eq("id", boardId)
        .eq("town_id", townId)
        .is("archived_at", null)
        .single();

      if (error || !board) {
        return reply.notFound("Board not found");
      }

      // Fetch active members
      const { data: members } = await fastify.supabase
        .from("board_member")
        .select("id, person_id, seat_title, term_start, term_end")
        .eq("board_id", boardId)
        .eq("town_id", townId)
        .eq("status", "active");

      // Fetch person names for members
      const personIds = (members ?? []).map((m) => m.person_id).filter(Boolean);
      const personNameMap: Record<string, string> = {};

      if (personIds.length > 0) {
        const { data: persons } = await fastify.supabase
          .from("person")
          .select("id, first_name, last_name")
          .in("id", personIds);

        for (const p of persons ?? []) {
          personNameMap[p.id] = `${p.first_name} ${p.last_name}`;
        }
      }

      const memberList = (members ?? []).map((m) => ({
        name: personNameMap[m.person_id] ?? "Unknown",
        seat_title: m.seat_title,
        term_start: m.term_start,
        term_end: m.term_end,
      }));

      return {
        ...board,
        members: memberList,
      };
    },
  );

  // ─── GET /:townId/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD ────
  fastify.get<{ Params: TownParams; Querystring: CalendarQuery }>(
    "/:townId/calendar",
    async (request, reply) => {
      const { townId } = request.params;
      const { start, end } = request.query;

      if (!start || !end) {
        return reply.badRequest("start and end query parameters are required");
      }

      const { data: meetings, error } = await fastify.supabase
        .from("meeting")
        .select("id, title, board_id, scheduled_date, scheduled_time, location, meeting_type")
        .eq("town_id", townId)
        .gte("scheduled_date", start)
        .lte("scheduled_date", end)
        .not("status", "in", `(${EXCLUDED_STATUSES.join(",")})`)
        .order("scheduled_date", { ascending: true });

      if (error) {
        return reply.internalServerError("Failed to fetch calendar");
      }

      // Batch-fetch board names
      const uniqueBoardIds = [...new Set((meetings ?? []).map((m) => m.board_id))];
      const boardNameMap: Record<string, string> = {};

      if (uniqueBoardIds.length > 0) {
        const { data: boards } = await fastify.supabase
          .from("board")
          .select("id, name")
          .in("id", uniqueBoardIds);

        for (const b of boards ?? []) {
          boardNameMap[b.id] = b.name;
        }
      }

      return (meetings ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        board_name: boardNameMap[m.board_id] ?? null,
        board_id: m.board_id,
        scheduled_date: m.scheduled_date,
        scheduled_time: m.scheduled_time,
        location: m.location,
        meeting_type: m.meeting_type,
      }));
    },
  );
}
