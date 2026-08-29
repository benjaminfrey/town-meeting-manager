/**
 * Public portal routes — no authentication required.
 *
 * These endpoints serve the public-facing portal for towns, providing access
 * to meetings, agendas, minutes, boards and calendars.
 *
 * ─── Task G1: why every route here says `PUBLIC` out loud ─────────────────
 *
 * These routes were unauthenticated because nothing required them to be
 * authenticated, which is the same reason ten routes in
 * `routes/notifications.ts` were — and those were a hole. Under
 * deny-by-default (`auth/route-access.ts`) the two cases stop looking alike:
 * this file's routes are public because each one says `config: { ...PUBLIC }`,
 * and a route that says nothing is refused.
 *
 * ─── Task D1b: what changed, and why both halves were needed ──────────────
 *
 * Until D1b every route in this file ran on `fastify.supabase` — the
 * SERVICE-ROLE client, which bypasses row level security entirely. Tenancy was
 * a hand-written `.eq("town_id", townId)` on each query, against a `townId`
 * taken from the URL, and publication was a second hand-written filter next to
 * it. Fifteen routes, roughly forty queries, and every one of them one
 * forgotten `.eq()` away from publishing another town's rows or this town's
 * drafts. `/:townId/meetings/:meetingId/agenda` had already lost one: it
 * checked `agenda_status = 'published'` and never excluded `draft` or
 * `cancelled` meetings the way its siblings did, so a cancelled meeting's
 * agenda was still served.
 *
 * Two separate things now hold, and NEITHER is sufficient alone:
 *
 *   1. **Tenancy is RLS.** An `onRequest` hook in this file's own encapsulated
 *      scope resolves `X-Town-Subdomain` to exactly one town and binds
 *      `request.withTenant`, so every query below runs inside a transaction
 *      with `app.town_id` set. A row of another town is not filtered out — it
 *      is not visible. See `auth/portal-tenant.ts`, including its statement of
 *      what the header is and is not trusted to be.
 *
 *   2. **Publication is the `portalCanSelect*` predicates.** RLS says nothing
 *      about drafts: within one town it would hand the public every
 *      unpublished agenda and every unadopted set of minutes. So the rules in
 *      `trpc/authorization/rules.ts` do that filtering, in TypeScript, in one
 *      place, and this file calls them.
 *
 * The filtering is deliberately NOT also written into the SQL. A duplicated
 * `WHERE status <> 'draft'` would keep the routes correct while making the
 * predicate untestable — `packages/api/scripts/mutate-authorization.py` replaces each
 * predicate's body with `return true` and expects a test to go red, and a
 * belt-and-braces SQL filter would keep those tests green against a rule that
 * no longer decides anything. One owner per rule, and the tests prove it is
 * the owner.
 *
 * ─── What did NOT move, and why ───────────────────────────────────────────
 *
 * The two PDF routes (`…/minutes/pdf`, `…/agenda/pdf`) still reach
 * `fastify.supabase` for ONE call each: `storage.from("minutes")
 * .createSignedUrl(...)`. Their database reads moved with everything else, so
 * no read here bypasses RLS; the storage call did not, because nothing in this
 * repository replaces Supabase Storage yet and a concurrent task owns that
 * decision.
 *
 * Both routes are, in any case, already dead: there has never been a
 * `"minutes"` storage bucket, so `createSignedUrl` fails and both answer 500
 * on every input that gets past their publication check. That is stated here
 * rather than fixed, and nothing in this change pretends otherwise.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sql } from "drizzle-orm";
import { PUBLIC_ROUTE as PUBLIC } from "../auth/route-access.js";
import { bindPortalTenant, portalTownIdFrom } from "../auth/portal-tenant.js";
import type { TenantTx } from "../db/with-tenant.js";
import { toRows as normaliseRows } from "../db/rows.js";
import {
  PORTAL_HIDDEN_MEETING_STATUSES,
  portalCanSelectAgenda,
  portalCanSelectBoard,
  portalCanSelectBoardMember,
  portalCanSelectMeeting,
  portalCanSelectMinutesDocument,
  portalVisibleExhibits,
  type ExhibitVisibility,
  type MinutesStatus,
} from "../trpc/authorization/rules.js";

/** Every route in this file is public; see the header for the review. */
const publicRoute = { config: { ...PUBLIC } };

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

interface MeetingsQuery {
  board?: string;
  page?: string;
}

interface CalendarQuery {
  start: string;
  end: string;
}

interface SearchQuery {
  q: string;
  type?: string;
  board?: string;
  from?: string;
  to?: string;
  page?: string;
}

const PAGE_SIZE = 20;

function rows<T>(result: unknown, where: string): T[] {
  return normaliseRows<T>(result, (message) => new Error(`portal ${where}: ${message}`));
}

/** A meeting as every route here reads it. `status` drives the portal rules. */
interface MeetingRow {
  id: string;
  title: string;
  board_id: string;
  board_name: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
  meeting_type: string;
  status: string;
  agenda_status: string | null;
}

const MEETING_COLUMNS = sql`
  m.id, m.title, m.board_id, b.name AS board_name, m.scheduled_date,
  m.scheduled_time, m.location, m.meeting_type, m.status, m.agenda_status
`;

/** What a handler is given once the tenant hook and the `:townId` check agree. */
interface PortalScope {
  townId: string;
  withTenant: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
}

/**
 * Resolve the scope for a `:townId` route, or answer 404.
 *
 * Two failures collapse into one answer: no resolvable subdomain (which the
 * hook has already refused, so this is belt and braces), and a `:townId` in
 * the URL that names a different town from the host it was requested through.
 * Both mean "there is nothing at this address for you", and neither should
 * tell the caller which.
 */
function scopeFor(
  request: FastifyRequest,
  reply: FastifyReply,
  paramTownId: string | undefined,
): PortalScope | null {
  const townId = portalTownIdFrom(request, paramTownId);
  const withTenant = request.withTenant;
  if (townId === null || !withTenant) {
    reply.notFound("No town is published at this address.");
    return null;
  }
  return { townId, withTenant };
}

// ─── Route Registration ─────────────────────────────────────────

export async function portalRoutes(fastify: FastifyInstance) {
  // ─── The portal's tenant gate ────────────────────────────────────────
  //
  // Registered on THIS instance, which `server.ts` creates as an encapsulated
  // child (`register(portalRoutes, { prefix: "/api/portal" })`). So it runs for
  // every route in this file and for nothing else — the binding cannot leak
  // onto an authenticated route by someone adding a file next door.
  //
  // It runs AFTER the root gate in `auth/fastify.ts`, which returns early for
  // a public route without looking for a session. Fastify runs parent hooks
  // before child hooks, so the ordering is structural rather than a matter of
  // registration order in `server.ts`.
  //
  // The hook RETURNS what `bindPortalTenant` returns. In an async Fastify
  // hook, sending a reply is not by itself enough to stop the request — the
  // reply object has to be returned, or the router carries on to the handler
  // with a response already sent. Every refusal in this file depends on that
  // one `return`.
  fastify.addHook("onRequest", async (request, reply) =>
    bindPortalTenant(fastify.tenantDb, request, reply),
  );

  // ─── GET /resolve ──────────────────────────────────────────────
  //
  // The subdomain comes from the header the hook already resolved, NOT from
  // the query parameter this route used to read. A route whose whole job is
  // "which town is this?" answering from a value the caller typed is how the
  // rest of the portal ended up trusting a `:townId` in a URL.
  fastify.get("/resolve", publicRoute, async (request, reply) => {
    const scope = scopeFor(request, reply, undefined);
    if (!scope) return;

    const [town] = await scope.withTenant(async (tx) =>
      rows<{
        id: string;
        name: string;
        state: string;
        municipality_type: string;
        seal_url: string | null;
        contact_name: string | null;
        contact_role: string | null;
        subdomain: string | null;
      }>(
        await tx.execute(sql`
          SELECT id, name, state, municipality_type, seal_url,
                 contact_name, contact_role, subdomain
          FROM town WHERE id = ${scope.townId}
        `),
        "resolve",
      ),
    );

    if (!town) return reply.notFound("Town not found");
    return town;
  });

  // ─── GET /:townId/meetings?board=X&page=N ─────────────────────
  fastify.get<{ Params: TownParams; Querystring: MeetingsQuery }>(
    "/:townId/meetings",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;

      const boardId = request.query.board;
      const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
      const offset = (page - 1) * PAGE_SIZE;
      const today = new Date().toISOString().split("T")[0]!;

      const { all, published } = await scope.withTenant(async (tx) => {
        // Upcoming ascending, then past descending — the order the portal
        // renders. Sorting in SQL and slicing in JS is what this route always
        // did; the publication filter is what moved.
        const all = rows<MeetingRow>(
          await tx.execute(sql`
            SELECT ${MEETING_COLUMNS}
            FROM meeting m
            LEFT JOIN board b ON b.id = m.board_id
            WHERE ${boardId ? sql`m.board_id = ${boardId}` : sql`true`}
            ORDER BY
              (m.scheduled_date < ${today}) ASC,
              CASE WHEN m.scheduled_date >= ${today} THEN m.scheduled_date END ASC,
              CASE WHEN m.scheduled_date <  ${today} THEN m.scheduled_date END DESC
          `),
          "meetings",
        );

        const published = rows<{ meeting_id: string; status: MinutesStatus }>(
          await tx.execute(sql`SELECT meeting_id, status FROM minutes_document`),
          "meetings.minutes",
        );

        return { all, published };
      });

      const visible = all.filter((m) => portalCanSelectMeeting({ status: m.status }));
      const publishedMinutes = new Set(
        published
          .filter((d) => portalCanSelectMinutesDocument({ status: d.status }))
          .map((d) => String(d.meeting_id)),
      );

      const meetings = visible.slice(offset, offset + PAGE_SIZE).map((m) => ({
        ...m,
        has_published_minutes: publishedMinutes.has(m.id),
      }));

      // The total counts what the PUBLIC can see, not what the table holds.
      // Paginating over a total that includes hidden rows leaks their
      // existence and hands the client empty pages.
      return { meetings, total: visible.length, page };
    },
  );

  // ─── GET /:townId/meetings/:meetingId ──────────────────────────
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;
      const { meetingId } = request.params;

      const result = await scope.withTenant(async (tx) => {
        const [meeting] = rows<MeetingRow>(
          await tx.execute(sql`
            SELECT ${MEETING_COLUMNS}
            FROM meeting m
            LEFT JOIN board b ON b.id = m.board_id
            WHERE m.id = ${meetingId}
          `),
          "meeting",
        );
        if (!meeting) return null;

        const minutes = rows<{ status: MinutesStatus }>(
          await tx.execute(
            sql`SELECT status FROM minutes_document WHERE meeting_id = ${meetingId}`,
          ),
          "meeting.minutes",
        );
        return { meeting, minutes };
      });

      if (!result || !portalCanSelectMeeting({ status: result.meeting.status })) {
        return reply.notFound("Meeting not found");
      }

      const { meeting, minutes } = result;
      return {
        ...meeting,
        has_published_agenda: portalCanSelectAgenda({
          agendaStatus: meeting.agenda_status,
          meetingStatus: meeting.status,
        }),
        has_published_minutes: minutes.some((d) => portalCanSelectMinutesDocument(d)),
      };
    },
  );

  // ─── GET /:townId/meetings/:meetingId/agenda ───────────────────
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId/agenda",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;
      const { meetingId } = request.params;

      const result = await scope.withTenant(async (tx) => {
        const [meeting] = rows<MeetingRow>(
          await tx.execute(sql`
            SELECT ${MEETING_COLUMNS}
            FROM meeting m
            LEFT JOIN board b ON b.id = m.board_id
            WHERE m.id = ${meetingId}
          `),
          "agenda.meeting",
        );
        if (!meeting) return null;

        const items = rows<{
          id: string;
          title: string;
          description: string | null;
          section_type: string;
          sort_order: number;
          parent_item_id: string | null;
          estimated_duration: number | null;
          presenter: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, title, description, section_type, sort_order,
                   parent_item_id, estimated_duration, presenter
            FROM agenda_item
            WHERE meeting_id = ${meetingId}
            ORDER BY sort_order ASC
          `),
          "agenda.items",
        );

        // `file_storage_path`, not `file_url`. This route used to select
        // `file_url`, `item_type` and `duration_minutes` — three columns that
        // do not exist on this schema, so PostgREST answered with an error the
        // handler discarded and the agenda came back with no exhibits at all,
        // silently, on every meeting. Reading through Drizzle means a wrong
        // column name is a failed query rather than an empty list.
        const exhibits = rows<{
          id: string;
          title: string;
          file_storage_path: string;
          file_type: string;
          file_size: string | number | null;
          exhibit_type: string | null;
          visibility: ExhibitVisibility;
          agenda_item_id: string | null;
        }>(
          await tx.execute(sql`
            SELECT e.id, e.title, e.file_storage_path, e.file_type, e.file_size,
                   e.exhibit_type, e.visibility, e.agenda_item_id
            FROM exhibit e
            JOIN agenda_item ai ON ai.id = e.agenda_item_id
            WHERE ai.meeting_id = ${meetingId}
            ORDER BY e.sort_order ASC
          `),
          "agenda.exhibits",
        );

        return { meeting, items, exhibits };
      });

      if (!result) return reply.notFound("Meeting not found");

      const { meeting, items, exhibits } = result;

      // BOTH conditions — the agenda is published AND the meeting is one the
      // portal may list. The second half is the fix: this route used to check
      // `agenda_status` alone, so a cancelled meeting whose agenda had been
      // published stayed readable after the cancellation.
      if (
        !portalCanSelectAgenda({
          agendaStatus: meeting.agenda_status,
          meetingStatus: meeting.status,
        })
      ) {
        return reply.notFound("Agenda is not published");
      }

      // No `download_url`. `PortalExhibit` in `@town-meeting/shared` declares
      // one and `portal/pages/AgendaView.tsx` renders it as an `href`, but
      // there has never been a route that produces it — the storage decision
      // this repository has not made yet. Emitting the raw storage path under
      // its own name says that plainly, rather than shipping a field named
      // `download_url` that nothing can download.
      const exhibitMap: Record<
        string,
        Array<{
          id: string;
          title: string;
          file_type: string;
          file_size: string | number | null;
          exhibit_type: string | null;
          file_storage_path: string;
        }>
      > = {};
      for (const ex of portalVisibleExhibits(exhibits)) {
        const key = ex.agenda_item_id;
        if (key === null) continue;
        (exhibitMap[key] ??= []).push({
          id: ex.id,
          title: ex.title,
          file_type: ex.file_type,
          file_size: ex.file_size,
          exhibit_type: ex.exhibit_type,
          file_storage_path: ex.file_storage_path,
        });
      }

      const childrenByParent: Record<string, typeof items> = {};
      for (const item of items) {
        if (item.parent_item_id) (childrenByParent[item.parent_item_id] ??= []).push(item);
      }

      const sections = items
        .filter((i) => !i.parent_item_id)
        .map((parent) => ({
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
          board_name: meeting.board_name,
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
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;
      const { meetingId } = request.params;

      const result = await scope.withTenant(async (tx) => {
        const [meeting] = rows<MeetingRow>(
          await tx.execute(sql`
            SELECT ${MEETING_COLUMNS}
            FROM meeting m
            LEFT JOIN board b ON b.id = m.board_id
            WHERE m.id = ${meetingId}
          `),
          "minutes.meeting",
        );
        if (!meeting) return null;

        const docs = rows<{
          status: MinutesStatus;
          html_rendered: string | null;
          approved_at: string | null;
          published_at: string | null;
          pdf_storage_path: string | null;
        }>(
          await tx.execute(sql`
            SELECT status, html_rendered, approved_at, published_at, pdf_storage_path
            FROM minutes_document WHERE meeting_id = ${meetingId}
          `),
          "minutes",
        );
        return { meeting, docs };
      });

      // The meeting rule first: minutes attached to a meeting the portal does
      // not list are not published records of anything the public was told
      // about.
      if (!result || !portalCanSelectMeeting({ status: result.meeting.status })) {
        return reply.notFound("Published minutes not found");
      }

      const doc = result.docs.find((d) => portalCanSelectMinutesDocument(d));
      if (!doc) return reply.notFound("Published minutes not found");

      reply.header("Cache-Control", "public, max-age=3600");
      return {
        html_rendered: doc.html_rendered,
        approved_at: doc.approved_at,
        published_at: doc.published_at,
        meeting_date: result.meeting.scheduled_date,
        board_name: result.meeting.board_name,
        pdf_storage_path: doc.pdf_storage_path,
      };
    },
  );

  // ─── GET /:townId/meetings/:meetingId/minutes/pdf ──────────────
  //
  // DEAD, and left dead deliberately. `storage.from("minutes")` names a bucket
  // that has never existed in this project, so `createSignedUrl` errors and
  // this route answers 500 for every meeting whose minutes ARE published. The
  // read below moved onto the tenant path with everything else, so nothing
  // here bypasses RLS; replacing the storage call is a concurrent task's, and
  // guessing at it would only make a broken route look fixed.
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId/minutes/pdf",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;
      const { meetingId } = request.params;

      const result = await scope.withTenant(async (tx) => {
        const [meeting] = rows<{ status: string }>(
          await tx.execute(sql`SELECT status FROM meeting WHERE id = ${meetingId}`),
          "minutes-pdf.meeting",
        );
        if (!meeting) return null;
        const docs = rows<{ status: MinutesStatus; pdf_storage_path: string | null }>(
          await tx.execute(
            sql`SELECT status, pdf_storage_path FROM minutes_document WHERE meeting_id = ${meetingId}`,
          ),
          "minutes-pdf",
        );
        return { meeting, docs };
      });

      if (!result || !portalCanSelectMeeting({ status: result.meeting.status })) {
        return reply.notFound("Published minutes PDF not found");
      }
      const doc = result.docs.find((d) => portalCanSelectMinutesDocument(d) && d.pdf_storage_path);
      if (!doc?.pdf_storage_path) return reply.notFound("Published minutes PDF not found");

      const { data: signedUrlData, error: signError } = await fastify.supabase.storage
        .from("minutes")
        .createSignedUrl(doc.pdf_storage_path, 3600);

      if (signError || !signedUrlData?.signedUrl) {
        return reply.internalServerError("Failed to generate PDF URL");
      }

      reply.header("Cache-Control", "public, max-age=3600");
      return reply.redirect(signedUrlData.signedUrl);
    },
  );

  // ─── GET /:townId/meetings/:meetingId/agenda/pdf ───────────────
  //
  // Dead for the same reason as the route above — same nonexistent bucket.
  fastify.get<{ Params: MeetingParams }>(
    "/:townId/meetings/:meetingId/agenda/pdf",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;
      const { meetingId } = request.params;

      const [meeting] = await scope.withTenant(async (tx) =>
        rows<{ agenda_packet_url: string | null; agenda_status: string | null; status: string }>(
          await tx.execute(sql`
            SELECT agenda_packet_url, agenda_status, status FROM meeting WHERE id = ${meetingId}
          `),
          "agenda-pdf",
        ),
      );

      if (!meeting) return reply.notFound("Meeting not found");
      if (
        !portalCanSelectAgenda({
          agendaStatus: meeting.agenda_status,
          meetingStatus: meeting.status,
        })
      ) {
        return reply.notFound("Agenda is not published");
      }
      if (!meeting.agenda_packet_url) return reply.notFound("Agenda PDF not available");

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
  fastify.get<{ Params: TownParams }>("/:townId/boards", publicRoute, async (request, reply) => {
    const scope = scopeFor(request, reply, request.params.townId);
    if (!scope) return;

    const boards = await scope.withTenant(async (tx) =>
      rows<{
        id: string;
        name: string;
        board_type: string;
        elected_or_appointed: string | null;
        member_count: number | null;
        archived_at: string | null;
      }>(
        await tx.execute(sql`
          SELECT id, name, board_type, elected_or_appointed, member_count, archived_at
          FROM board ORDER BY name ASC
        `),
        "boards",
      ),
    );

    return boards
      .filter((b) => portalCanSelectBoard({ archivedAt: b.archived_at }))
      .map(({ archived_at: _archived, ...b }) => b);
  });

  // ─── GET /:townId/boards/:boardId ──────────────────────────────
  fastify.get<{ Params: BoardParams }>(
    "/:townId/boards/:boardId",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;
      const { boardId } = request.params;

      const result = await scope.withTenant(async (tx) => {
        const [board] = rows<{
          id: string;
          name: string;
          board_type: string;
          elected_or_appointed: string | null;
          member_count: number | null;
          quorum_type: string | null;
          quorum_value: number | null;
          archived_at: string | null;
        }>(
          // `quorum_value`, and no `meeting_schedule`. This route used to ask
          // PostgREST for `meeting_schedule` and `quorum_custom_value`, neither
          // of which is a column on `board`; the request errored and the
          // handler's `if (error || !board)` turned that into "Board not
          // found", so every board detail page on the portal was a 404.
          await tx.execute(sql`
            SELECT id, name, board_type, elected_or_appointed, member_count,
                   quorum_type, quorum_value, archived_at
            FROM board WHERE id = ${boardId}
          `),
          "board",
        );
        if (!board) return null;

        const members = rows<{
          status: string;
          name: string;
          seat_title: string | null;
          term_start: string | null;
          term_end: string | null;
        }>(
          await tx.execute(sql`
            SELECT bm.status, p.name, bm.seat_title, bm.term_start, bm.term_end
            FROM board_member bm
            JOIN person p ON p.id = bm.person_id
            WHERE bm.board_id = ${boardId}
          `),
          "board.members",
        );

        return { board, members };
      });

      if (!result || !portalCanSelectBoard({ archivedAt: result.board.archived_at })) {
        return reply.notFound("Board not found");
      }

      const { archived_at: _archived, ...board } = result.board;
      return {
        ...board,
        // The one piece of personal data on this surface. An expired or
        // resigned seat is not a public record of who currently serves, so a
        // former member drops off when their seat does.
        members: result.members.filter(portalCanSelectBoardMember).map((m) => ({
          name: m.name,
          seat_title: m.seat_title,
          term_start: m.term_start,
          term_end: m.term_end,
        })),
      };
    },
  );

  // ─── GET /:townId/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD ────
  fastify.get<{ Params: TownParams; Querystring: CalendarQuery }>(
    "/:townId/calendar",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;

      const { start, end } = request.query;
      if (!start || !end) {
        return reply.badRequest("start and end query parameters are required");
      }

      const meetings = await scope.withTenant(async (tx) =>
        rows<MeetingRow>(
          await tx.execute(sql`
            SELECT ${MEETING_COLUMNS}
            FROM meeting m
            LEFT JOIN board b ON b.id = m.board_id
            WHERE m.scheduled_date >= ${start} AND m.scheduled_date <= ${end}
            ORDER BY m.scheduled_date ASC
          `),
          "calendar",
        ),
      );

      return meetings
        .filter((m) => portalCanSelectMeeting({ status: m.status }))
        .map((m) => ({
          id: m.id,
          title: m.title,
          board_name: m.board_name,
          board_id: m.board_id,
          scheduled_date: m.scheduled_date,
          scheduled_time: m.scheduled_time,
          location: m.location,
          meeting_type: m.meeting_type,
        }));
    },
  );

  // ─── GET /:townId/search?q=X&type=&board=&from=&to=&page= ────
  //
  // The one portal read whose publication filtering is NOT applied in
  // TypeScript, because it cannot be: `portal_search` returns a windowed
  // `total_count`, and filtering its rows afterwards would report a total that
  // does not match what was returned and hand out short pages. So the
  // exclusion is inside the function — but as a PARAMETER, passed from
  // `PORTAL_HIDDEN_MEETING_STATUSES`, so `portalCanSelectMeeting` and search
  // still read the same list. See `drizzle/0003_portal_tenant.sql` § 2 for
  // what the unparameterised version disclosed.
  fastify.get<{ Params: TownParams; Querystring: SearchQuery }>(
    "/:townId/search",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;

      const { q, type, board, from, to, page: pageStr } = request.query;
      if (!q || q.trim().length === 0) {
        return reply.badRequest("q query parameter is required");
      }
      if (q.length > 200) {
        return reply.badRequest("Search query too long (max 200 characters)");
      }

      const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
      const offset = (page - 1) * PAGE_SIZE;

      const results = await scope.withTenant(async (tx) =>
        rows<{
          result_type: string;
          meeting_id: string;
          meeting_date: string;
          board_name: string;
          title: string;
          snippet: string;
          rank: number;
          total_count: string | number;
        }>(
          await tx.execute(sql`
            SELECT * FROM portal_search(
              ${scope.townId}::uuid, ${q.trim()}, ${type ?? "all"},
              ${board ?? null}::uuid, ${from ?? null}::date, ${to ?? null}::date,
              ${PAGE_SIZE}, ${offset},
              ${sql.raw(pgTextArrayLiteral(PORTAL_HIDDEN_MEETING_STATUSES))}::text[]
            )
          `),
          "search",
        ),
      );

      const total = results.length > 0 ? Number(results[0]!.total_count) : 0;

      return {
        results: results.map((r) => ({
          result_type: r.result_type,
          meeting_id: r.meeting_id,
          meeting_date: r.meeting_date,
          board_name: r.board_name,
          title: r.title,
          snippet: r.snippet,
          rank: r.rank,
        })),
        total,
        page,
        pages: Math.ceil(total / PAGE_SIZE),
      };
    },
  );

  // ─── GET /:townId/sitemap.xml ───────────────────────────────
  fastify.get<{ Params: TownParams }>(
    "/:townId/sitemap.xml",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;

      const { boards, meetings, minutes } = await scope.withTenant(async (tx) => ({
        boards: rows<{ id: string; archived_at: string | null }>(
          await tx.execute(sql`SELECT id, archived_at FROM board`),
          "sitemap.boards",
        ),
        meetings: rows<{
          id: string;
          scheduled_date: string;
          status: string;
          agenda_status: string | null;
        }>(
          await tx.execute(sql`
            SELECT id, scheduled_date, status, agenda_status
            FROM meeting ORDER BY scheduled_date DESC
          `),
          "sitemap.meetings",
        ),
        minutes: rows<{ meeting_id: string; status: MinutesStatus }>(
          await tx.execute(sql`SELECT meeting_id, status FROM minutes_document`),
          "sitemap.minutes",
        ),
      }));

      const baseUrl = `https://${request.portalTenant!.subdomain}.townmeetingmanager.com`;
      const publishedMinutes = new Set(
        minutes.filter(portalCanSelectMinutesDocument).map((d) => String(d.meeting_id)),
      );

      const urls: Array<{ loc: string; lastmod?: string; changefreq: string; priority: string }> = [
        { loc: baseUrl, changefreq: "daily", priority: "1.0" },
      ];

      for (const board of boards.filter((b) =>
        portalCanSelectBoard({ archivedAt: b.archived_at }),
      )) {
        urls.push({ loc: `${baseUrl}/boards/${board.id}`, changefreq: "weekly", priority: "0.7" });
      }

      for (const meeting of meetings) {
        if (!portalCanSelectMeeting({ status: meeting.status })) continue;
        const hasAgenda = portalCanSelectAgenda({
          agendaStatus: meeting.agenda_status,
          meetingStatus: meeting.status,
        });
        const hasMinutes = publishedMinutes.has(meeting.id);
        if (!hasAgenda && !hasMinutes) continue;

        urls.push({
          loc: `${baseUrl}/meetings/${meeting.id}`,
          lastmod: meeting.scheduled_date,
          changefreq: "monthly",
          priority: "0.6",
        });
        if (hasAgenda) {
          urls.push({
            loc: `${baseUrl}/meetings/${meeting.id}/agenda`,
            lastmod: meeting.scheduled_date,
            changefreq: "monthly",
            priority: "0.5",
          });
        }
        if (hasMinutes) {
          urls.push({
            loc: `${baseUrl}/meetings/${meeting.id}/minutes`,
            lastmod: meeting.scheduled_date,
            changefreq: "yearly",
            priority: "0.5",
          });
        }
      }

      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map((u) => {
          let entry = `  <url>\n    <loc>${escapeXml(u.loc)}</loc>`;
          if (u.lastmod) entry += `\n    <lastmod>${u.lastmod}</lastmod>`;
          entry += `\n    <changefreq>${u.changefreq}</changefreq>`;
          entry += `\n    <priority>${u.priority}</priority>`;
          entry += "\n  </url>";
          return entry;
        }),
        "</urlset>",
      ].join("\n");

      reply.header("Cache-Control", "public, max-age=3600");
      return reply.type("application/xml").send(xml);
    },
  );

  // ─── GET /:townId/robots.txt ────────────────────────────────
  fastify.get<{ Params: TownParams }>(
    "/:townId/robots.txt",
    publicRoute,
    async (request, reply) => {
      const scope = scopeFor(request, reply, request.params.townId);
      if (!scope) return;

      const baseUrl = `https://${request.portalTenant!.subdomain}.townmeetingmanager.com`;
      const text = ["User-agent: *", "Allow: /", "", `Sitemap: ${baseUrl}/sitemap.xml`, ""].join(
        "\n",
      );

      reply.header("Cache-Control", "public, max-age=86400");
      return reply.type("text/plain").send(text);
    },
  );

  // ─── Subdomain-based sitemap/robots (used by the nginx proxy) ──
  //
  // nginx proxies `/sitemap.xml` and `/robots.txt` on a town's portal host to
  // these two paths, which carry no `:townId`. They used to do their own
  // `town` lookup on the service-role client; the tenant hook has now already
  // done it, so they are a redirect to the canonical path and nothing else.
  //
  // `fastify.inject()` is gone with them. It re-entered the whole hook chain
  // with the ORIGINAL request's headers, which happened to work and would have
  // stopped working the moment the two disagreed about anything.
  fastify.get("/sitemap", publicRoute, async (request, reply) => {
    const scope = scopeFor(request, reply, undefined);
    if (!scope) return;
    return reply.redirect(`/api/portal/${scope.townId}/sitemap.xml`, 302);
  });

  fastify.get("/robots", publicRoute, async (request, reply) => {
    const scope = scopeFor(request, reply, undefined);
    if (!scope) return;
    return reply.redirect(`/api/portal/${scope.townId}/robots.txt`, 302);
  });
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * A `text[]` literal for a list of statuses that never comes from a request.
 *
 * `PORTAL_HIDDEN_MEETING_STATUSES` is a module constant, so this is not a
 * parameterisation decision about user input — but it is still built by
 * escaping rather than by concatenation, so that it stays safe if the list
 * ever becomes configurable.
 */
function pgTextArrayLiteral(values: readonly string[]): string {
  return `ARRAY[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")}]`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
