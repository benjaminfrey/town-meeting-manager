/**
 * Post-Meeting Review Page — /meetings/:meetingId/review
 *
 * Read-only summary of a completed (adjourned) meeting. Shows:
 * - Meeting header (board, date, times, duration, officers)
 * - Attendance table
 * - Agenda coverage (items with status, time spent)
 * - Motions & votes (grouped by item, with vote summaries)
 * - Executive sessions (citation, timestamps, post-session actions)
 * - Recusals (member, item, reason)
 * - Future items queue (tabled/deferred items for next meeting)
 * - Export button for structured meeting data JSON
 *
 * ─── Phase E, wave 6, Task 4 ──────────────────────────────────────────────
 *
 * Sixteen raw `select("*")` reads, zero writes — the largest single read
 * surface in the phase. Fourteen are now tRPC procedures; two are gone
 * outright (see below). Every row type comes from `RouterOutputs`, never
 * `Record<string, unknown>`: conventions item 10, and the bag type is what
 * let this screen's siblings read columns that do not exist.
 *
 * **`POST /api/meetings/:id/minutes/generate` (and `/regenerate`) STAY on
 * Fastify.** They are not an oversight and not a gap. Minutes generation
 * holds a Chromium process and a pooled connection for seconds; it was
 * deliberately kept off the transaction path, and moving it behind a tRPC
 * resolver would put a Puppeteer render inside `ctx.withTenant`.
 *
 * ─── The column audit ─────────────────────────────────────────────────────
 *
 * Task 3 migrated `components/minutes/SourceDataPanel.tsx`, which reads
 * `motion`, `vote_record` and `agenda_item_transition` — three of the same
 * tables — and found SEVEN keys that are not columns: the "Moved:" line, all
 * three vote badges and every voter name had never rendered there.
 *
 * Every column this screen reads was checked the same way, against
 * `packages/api/drizzle/0000_baseline.sql`'s own `CREATE TABLE` statements,
 * across all sixteen tables and including the ones only reached as props
 * (`lib/meeting/buildStructuredMeetingRecord.ts`, `FutureItemsQueue`).
 * **All of them exist.** This screen reads `motion.moved_by` /
 * `seconded_by` (the real uuid FKs) through a `board_member.id → name` map,
 * reads the tally out of `motion.vote_summary`, and never reads
 * `transition_type` at all — it had, independently, the three things its
 * sibling got wrong. The one column that is not what its consumer claims is
 * `meeting_attendance.is_recording_secretary`, and that is a TYPE mismatch
 * rather than a phantom: see "One dead conversion" below.
 *
 * ─── Two reads deleted, not migrated ──────────────────────────────────────
 *
 *   - `person` by town, which existed only to turn `board_member.person_id`
 *     into a name. `boardMember.roster` already JOINs `person` and returns
 *     `name` per seat, so the whole `personMap`/`personRows` pair is gone.
 *     `SourceDataPanel` reaches the identical mapping the identical way.
 *   - `town_id` as a local. It fed exactly three things: the `town` read
 *     (`town.detail` takes no input — it reads `ctx.tenant.townId`), the
 *     `person` read (deleted), and the `exhibit` read's own `town_id` filter
 *     (replaced, see below). Nothing renders it.
 *
 * ─── Behaviour changes, stated (conventions item 1) ───────────────────────
 *
 * The query being replaced is a specification, so every dropped or added
 * clause is named here:
 *
 *   - **The exhibit read NARROWS, twice.** It was
 *     `.eq("town_id", townId)` — every exhibit in the town, for a screen that
 *     only ever groups them by THIS meeting's agenda item ids. The extra rows
 *     were inert in the exported JSON and are gone. `exhibit.byMeeting` also
 *     applies rule 14, so a caller who may not see a `board_only` or
 *     `admin_only` attachment no longer gets its title in the export. Both
 *     are tightenings; the second is a real visibility change.
 *   - **Member ordering is ADDED.** `boardMember.roster` is
 *     `ORDER BY p.name`; the raw `board_member` read had no ORDER BY, so the
 *     attendance table rendered in whatever order Postgres returned. It is
 *     alphabetical now. No status filter is added — the raw read had none
 *     and `roster` has none, so a resigned seat still appears exactly as it
 *     did.
 *   - **Three more ORDER BYs are ADDED**, all the procedures' own (waves
 *     3–5): `motion.byMeeting` orders by `created_at, id`,
 *     `guestSpeaker.byMeeting` by `created_at, id`, `futureItem.byMeeting`
 *     by `created_at, id`. `agendaItem.byMeeting` keeps this screen's
 *     `sort_order` and adds an `id` tiebreak. `voteRecord.byMeeting` and
 *     `executiveSession.byMeeting` still have none, matching the raw reads.
 *   - **A missing meeting is NOT_FOUND, not `null`.** The loader lets that
 *     reject into `RouteErrorBoundary`; the old `.single()` on a foreign id
 *     left this screen on "Loading meeting data..." forever.
 *   - **The vote line's gate is `voteTallyOf`, not `Boolean(vote_summary)`.**
 *     A `vote_summary` object carrying neither a numeric `yeas` nor a numeric
 *     `nays` used to render "Yeas: 0, Nays: 0, Abstentions: 0" beside the
 *     Result badge; it now renders nothing. `voteRecord.recordForMotion`
 *     always writes all three, so this reaches only a malformed or
 *     hand-written row — and rendering three invented zeros for one is worse
 *     than saying nothing.
 *   - **`canGenerateMinutes` gains a board and a role.** It was
 *     `hasPermission(permissions, "generate_ai_minutes")` with neither, which
 *     is a DIFFERENT question from the one the server answers:
 *     `routes/minutes.ts` resolves R2 against `meeting.board_id` (see that
 *     file's header — the board-scoped fix is the confirmed defect it
 *     closed), so the browser was ignoring this board's overrides. A clerk
 *     granted R2 on this board only now sees the button, and one whose town
 *     REVOKED it for this board no longer does. The explicit
 *     `admin`/`sys_admin` short-circuit stays: it predates this and `role`
 *     does not subsume it (`hasPermission` short-circuits `admin` alone).
 *
 * ─── One dead conversion, removed ─────────────────────────────────────────
 *
 * `meeting_attendance.is_recording_secretary` is a `boolean` column. This
 * screen normalised it to `0`/`1` and `buildStructuredMeetingRecord`
 * compared `=== 1` — a round trip that produced the right answer through two
 * wrong types. Wave 5, Task 5 named exactly this pair as surviving in these
 * two wave-6 files. The builder's input is `boolean` now, the `normalizeBool`
 * helper is gone, and the exported JSON is byte-identical.
 *
 * ─── Cache keys ───────────────────────────────────────────────────────────
 *
 * Every legacy `queryKeys.*` read this screen carried is gone, and it was the
 * LAST reader of THIRTEEN of them — `meetings.detail`, `towns.detail`,
 * `members.byBoard`, `attendance.byMeeting`, `agendaItems.*`, `motions.*`,
 * `voteRecords.*`, `executiveSessions.*`, `agendaItemTransitions.*`,
 * `guestSpeakers.*`, `exhibits.*`, `futureItemQueues.*` and
 * `minutesDocuments.*`. Every one of those namespaces' writers already
 * carried the matching `trpc.<router>.pathFilter()` call, so nothing had to
 * be added and nothing was deleted — see `cache-key-parity.test.ts`'s "Why a
 * dead legacy line is not removed on sight" for why the now-dead
 * invalidations stay. The exception, and the one real gap this migration
 * opened: `future_item_queue` had NO client writer invalidating it and is not
 * a `LIVE_MEETING_TOPICS` entry, so the two adjournment call sites that
 * create its rows (`live.tsx`'s `adjournMutation`, `VotePanel.tsx`'s
 * `data.adjourned` branch) now call `trpc.futureItem.pathFilter()`, each
 * pinned.
 */

import { useMemo, useCallback, useState } from "react";
import { useNavigate, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Calendar,
  MapPin,
  Users,
  Gavel,
  Lock,
  Download,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  ArrowRightCircle,
  Circle,
  ShieldOff,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { Route } from "./+types/meetings.$meetingId.review";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FutureItemsQueue } from "@/components/meeting/FutureItemsQueue";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { hasPermission } from "@town-meeting/shared";
import {
  buildStructuredMeetingRecord,
  downloadMeetingRecord,
  type StructuredMeetingRecordInput,
} from "@/lib/meeting/buildStructuredMeetingRecord";
import { voteTallyOf } from "@/lib/meeting/voteTally";
import { isTRPCClientError } from "@trpc/client";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { apiJson } from "@/lib/api-client";
import { queryClient } from "@/lib/queryClient";

// ─── Row types, bound to the procedures that produce them ─────────

type AgendaItem = RouterOutputs["agendaItem"]["byMeeting"][number];
type Motion = RouterOutputs["motion"]["byMeeting"][number];
type VoteRecord = RouterOutputs["voteRecord"]["byMeeting"][number];
type ExecutiveSession = RouterOutputs["executiveSession"]["byMeeting"][number];
type Transition = RouterOutputs["agendaItemTransition"]["byMeeting"][number];

// ─── Route Loader ─────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const meetingId = params.meetingId;

  // Not wrapped in try/catch: a nonexistent or foreign meeting answers
  // NOT_FOUND and letting that reject routes to `RouteErrorBoundary` below
  // (conventions item 12), rather than the indefinite "Loading meeting
  // data..." the old `select("*").single()` produced.
  await queryClient.ensureQueryData(trpc.meeting.detail.queryOptions({ meetingId }));

  return { meetingId };
}

// ─── Component ────────────────────────────────────────────────────

const MINUTES_STYLE_LABELS: Record<string, string> = {
  action: "Action Minutes",
  summary: "Summary Minutes",
  narrative: "Narrative Minutes",
};

/**
 * `meeting.adjournment` is JSONB, declared `unknown` by `meeting.detail`.
 *
 * The `JSON.parse` fallback this replaces was there because PostgREST could
 * hand back either shape; `meeting.detail` cannot — `meeting.test.ts`'s
 * "returns the adjournment JSONB, parsed, not as text" pins that it arrives
 * as an object. Its five keys are documented on `meeting.adjourn`, including
 * the `adjourned_by` misattribution this screen does not read.
 */
function adjournmentOf(stored: unknown): Record<string, unknown> | null {
  if (typeof stored !== "object" || stored === null) return null;
  return stored as Record<string, unknown>;
}

export default function PostMeetingReviewPage({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const navigate = useNavigate();
  const currentUser = useCurrentUser();

  // Minutes generation state
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [styleOverride, setStyleOverride] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // ─── Reactive queries ───────────────────────────────────────────
  const {
    data: meeting,
    isLoading: isMeetingLoading,
    isError: isMeetingError,
    error: meetingError,
  } = useQuery(trpc.meeting.detail.queryOptions({ meetingId }));

  const boardId = meeting?.board_id ?? "";

  // `enabled: !!boardId` on the three board-scoped reads: every input below
  // is `z.string().uuid()`, so an empty id is a BAD_REQUEST rather than a
  // query that quietly returns nothing.
  const { data: board } = useQuery({
    ...trpc.board.detail.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  const { data: town } = useQuery(trpc.town.detail.queryOptions());

  const { data: roster = [] } = useQuery({
    ...trpc.boardMember.roster.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  const { data: attendanceRows = [] } = useQuery(
    trpc.meetingAttendance.byMeeting.queryOptions({ meetingId }),
  );

  const { data: itemRows = [] } = useQuery(trpc.agendaItem.byMeeting.queryOptions({ meetingId }));

  const { data: motionRows = [] } = useQuery(trpc.motion.byMeeting.queryOptions({ meetingId }));

  const { data: voteRecordRows = [] } = useQuery(
    trpc.voteRecord.byMeeting.queryOptions({ meetingId }),
  );

  const { data: execSessionRows = [] } = useQuery(
    trpc.executiveSession.byMeeting.queryOptions({ meetingId }),
  );

  const { data: transitionRows = [] } = useQuery(
    trpc.agendaItemTransition.byMeeting.queryOptions({ meetingId }),
  );

  const { data: speakerRows = [] } = useQuery(
    trpc.guestSpeaker.byMeeting.queryOptions({ meetingId }),
  );

  const { data: exhibitRows = [] } = useQuery(trpc.exhibit.byMeeting.queryOptions({ meetingId }));

  const { data: futureItems = [] } = useQuery(
    trpc.futureItem.byMeeting.queryOptions({ meetingId }),
  );

  // The status pill's row, and the existence check behind "Generate" vs
  // "View / Regenerate". `byMeeting`, not `detail`: this screen needs the
  // status and nothing else, and `detail` applies rule 9 — a caller who may
  // not read a DRAFT's text can still be told one exists.
  const { data: minutesDoc } = useQuery(trpc.minutesDocument.byMeeting.queryOptions({ meetingId }));
  const hasMinutes = !!minutesDoc;

  // ─── Permissions ────────────────────────────────────────────────
  //
  // `boardId` and `role` are ADDED arguments — see this file's header for
  // which question the browser used to ask and which one the server answers.
  const canGenerateMinutes = useMemo(() => {
    if (!currentUser) return false;
    const role = currentUser.role;
    if (role === "admin" || role === "sys_admin") return true;
    return hasPermission(
      currentUser.permissions,
      "generate_ai_minutes",
      boardId || undefined,
      role ?? undefined,
    );
  }, [currentUser, boardId]);

  // ─── Data merging ─────────────────────────────────────────────

  /** `board_member.id` → the seat, with the person's name already joined. */
  const members = useMemo(
    () =>
      roster.map((seat) => ({
        boardMemberId: seat.id,
        personId: seat.person_id,
        name: seat.name,
        seatTitle: seat.seat_title,
      })),
    [roster],
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.boardMemberId, m.name));
    return map;
  }, [members]);

  const allItems = itemRows;

  // Build sections with child items
  const sections = useMemo(() => {
    const parents = allItems.filter((item) => !item.parent_item_id);
    return parents.map((section) => {
      const children = allItems
        .filter((item) => item.parent_item_id === section.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      return { section, children };
    });
  }, [allItems]);

  // Motions by item for display
  const motionsByItem = useMemo(() => {
    const map = new Map<string, Motion[]>();
    motionRows.forEach((m) => {
      if (!map.has(m.agenda_item_id)) map.set(m.agenda_item_id, []);
      map.get(m.agenda_item_id)!.push(m);
    });
    return map;
  }, [motionRows]);

  // Votes by motion
  const votesByMotion = useMemo(() => {
    const map = new Map<string, VoteRecord[]>();
    voteRecordRows.forEach((v) => {
      if (!map.has(v.motion_id)) map.set(v.motion_id, []);
      map.get(v.motion_id)!.push(v);
    });
    return map;
  }, [voteRecordRows]);

  // Transitions by item (for time tracking)
  const transitionsByItem = useMemo(() => {
    const map = new Map<string, Transition[]>();
    transitionRows.forEach((t) => {
      if (!map.has(t.agenda_item_id)) map.set(t.agenda_item_id, []);
      map.get(t.agenda_item_id)!.push(t);
    });
    return map;
  }, [transitionRows]);

  // Presiding officer and recording secretary names
  const presidingOfficerName = useMemo(() => {
    const id = meeting?.presiding_officer_id ?? null;
    return id ? (memberNameMap.get(id) ?? null) : null;
  }, [meeting, memberNameMap]);

  const recordingSecretaryName = useMemo(() => {
    const id = meeting?.recording_secretary_id ?? null;
    return id ? (memberNameMap.get(id) ?? null) : null;
  }, [meeting, memberNameMap]);

  const adjournment = useMemo(() => adjournmentOf(meeting?.adjournment), [meeting]);

  // Duration
  const duration = useMemo(() => {
    if (!meeting?.started_at || !meeting?.ended_at) return null;
    const start = new Date(meeting.started_at);
    const end = new Date(meeting.ended_at);
    const mins = Math.round((end.getTime() - start.getTime()) / 60000);
    const hours = Math.floor(mins / 60);
    const remaining = mins % 60;
    return hours > 0 ? `${hours}h ${remaining}m` : `${remaining}m`;
  }, [meeting]);

  // All recusals across the meeting
  const recusals = useMemo(() => {
    return voteRecordRows
      .filter((v) => v.vote === "recusal")
      .map((v) => {
        const motion = motionRows.find((m) => m.id === v.motion_id);
        const item = allItems.find((i) => i.id === motion?.agenda_item_id);
        return {
          member: memberNameMap.get(v.board_member_id) ?? "Unknown",
          item: item?.title ?? "Unknown item",
          reason: v.recusal_reason ?? "Not specified",
        };
      });
  }, [voteRecordRows, motionRows, allItems, memberNameMap]);

  // Effective minutes style for the board
  const effectiveMinutesStyle = useMemo(() => {
    const boardOverride = board?.minutes_style_override ?? null;
    const townDefault = town?.minutes_style ?? "summary";
    return boardOverride ?? townDefault;
  }, [board, town]);

  // ─── Minutes generation handlers ────────────────────────────────

  const handleGenerateMinutes = useCallback(
    async (isRegenerate: boolean) => {
      setGenerating(true);
      setGenerateError(null);

      const endpoint = isRegenerate
        ? `/api/meetings/${meetingId}/minutes/regenerate`
        : `/api/meetings/${meetingId}/minutes/generate`;

      try {
        const body: Record<string, string> = {};
        if (styleOverride && styleOverride !== effectiveMinutesStyle) {
          body.minutes_style_override = styleOverride;
        }

        await apiJson(endpoint, { method: "POST", json: body });

        // Success — close dialogs and invalidate the minutes router.
        setGenerateDialogOpen(false);
        setRegenerateDialogOpen(false);
        setStyleOverride("");
        // Generation/regeneration creates or replaces the meeting's
        // `minutes_document`, which is this screen's own "Generate" vs
        // "View / Regenerate" branch AND the status pill
        // `routes/meetings.$meetingId.tsx`'s shell renders from
        // `trpc.minutesDocument.byMeeting`. One `pathFilter()` reaches both;
        // the legacy `queryKeys.minutesDocuments.byMeeting` line that used to
        // sit beside it is gone with this screen's own read of that key.
        await queryClient.invalidateQueries(trpc.minutesDocument.pathFilter());
      } catch (err) {
        setGenerateError(
          err instanceof Error ? err.message : "An error occurred during generation.",
        );
      } finally {
        setGenerating(false);
      }
    },
    [meetingId, styleOverride, effectiveMinutesStyle],
  );

  // ─── Export handler ────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (!meeting || !board || !town) return;

    // `adjournment`, `vote_summary` and `post_session_action_motion_ids` are
    // JSONB, and `buildStructuredMeetingRecord` takes them as TEXT (it
    // `JSON.parse`s them itself). `normalizeBool` used to sit beside this and
    // does not any more — see this file's header.
    const normalizeJsonString = (val: unknown): string | null => {
      if (val == null) return null;
      if (typeof val === "string") return val;
      return JSON.stringify(val);
    };

    const input: StructuredMeetingRecordInput = {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        scheduled_date: meeting.scheduled_date,
        scheduled_time: meeting.scheduled_time,
        location: meeting.location,
        meeting_type: meeting.meeting_type,
        started_at: meeting.started_at,
        ended_at: meeting.ended_at,
        adjournment: normalizeJsonString(meeting.adjournment),
      },
      board: {
        id: board.id,
        name: board.name,
        board_type: board.board_type,
        motion_display_format: board.motion_display_format,
      },
      town: {
        name: town.name,
        meeting_formality: town.meeting_formality,
        minutes_style: town.minutes_style,
      },
      presidingOfficerName,
      recordingSecretaryName,
      members,
      attendance: attendanceRows.map((a) => ({
        board_member_id: a.board_member_id,
        person_id: a.person_id,
        status: a.status,
        arrived_at: a.arrived_at,
        departed_at: a.departed_at,
        is_recording_secretary: a.is_recording_secretary,
      })),
      agendaItems: allItems.map((i) => ({
        id: i.id,
        meeting_id: meetingId,
        section_type: i.section_type,
        sort_order: i.sort_order,
        title: i.title,
        description: i.description,
        presenter: i.presenter,
        estimated_duration: i.estimated_duration,
        parent_item_id: i.parent_item_id,
        status: i.status,
        staff_resource: i.staff_resource,
        background: i.background,
        recommendation: i.recommendation,
        suggested_motion: i.suggested_motion,
        operator_notes: i.operator_notes,
      })),
      motions: motionRows.map((m) => ({
        id: m.id,
        agenda_item_id: m.agenda_item_id,
        motion_text: m.motion_text,
        motion_type: m.motion_type,
        moved_by: m.moved_by,
        seconded_by: m.seconded_by,
        status: m.status,
        parent_motion_id: m.parent_motion_id,
        vote_summary: normalizeJsonString(m.vote_summary),
      })),
      voteRecords: voteRecordRows.map((v) => ({
        id: v.id,
        motion_id: v.motion_id,
        board_member_id: v.board_member_id,
        vote: v.vote,
        recusal_reason: v.recusal_reason,
      })),
      executiveSessions: execSessionRows.map((es) => ({
        id: es.id,
        agenda_item_id: es.agenda_item_id,
        statutory_basis: es.statutory_basis,
        entered_at: es.entered_at,
        exited_at: es.exited_at,
        entry_motion_id: es.entry_motion_id,
        post_session_action_motion_ids: normalizeJsonString(es.post_session_action_motion_ids),
      })),
      transitions: transitionRows.map((t) => ({
        agenda_item_id: t.agenda_item_id,
        started_at: t.started_at,
        ended_at: t.ended_at,
      })),
      // `file_name` is nullable on the column and `agenda_item_id` is
      // nullable on `guest_speaker`; both `?? ""` exactly as they did when
      // every row was a `Record<string, unknown>`.
      exhibits: exhibitRows.map((e) => ({
        id: e.id,
        agenda_item_id: e.agenda_item_id,
        title: e.title,
        file_name: e.file_name ?? "",
      })),
      speakers: speakerRows.map((s) => ({
        id: s.id,
        agenda_item_id: s.agenda_item_id ?? "",
        name: s.name,
        topic: s.topic,
      })),
    };

    const record = buildStructuredMeetingRecord(input);
    downloadMeetingRecord(record, board.name, meeting.scheduled_date);
  }, [
    meeting,
    board,
    town,
    presidingOfficerName,
    recordingSecretaryName,
    members,
    attendanceRows,
    allItems,
    motionRows,
    voteRecordRows,
    execSessionRows,
    transitionRows,
    exhibitRows,
    speakerRows,
    meetingId,
  ]);

  // ─── Error state ───────────────────────────────────────────────
  //
  // A failure AFTER mount — a refetch or a `staleTime` expiry. The loader
  // covers the before-mount case through `RouteErrorBoundary`; conventions
  // item 12 requires both, and neither substitutes for the other.

  if (isMeetingError) {
    const notFound = isTRPCClientError(meetingError) && meetingError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This meeting could not be found."
              : "Something went wrong loading this meeting."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {notFound
              ? "It may have been deleted, or it belongs to another town."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
          <Link to="/meetings" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to Meetings
          </Link>
        </div>
      </div>
    );
  }

  // ─── Loading state ─────────────────────────────────────────────

  if (isMeetingLoading || !meeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading meeting data...</p>
      </div>
    );
  }

  const boardName = board?.name ?? "";
  const meetingDate = meeting.scheduled_date;

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" onClick={() => void navigate("/boards")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Boards
          </Button>
        </div>
        <h1 className="mt-3 text-2xl font-bold">{meeting.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {boardName && (
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {boardName}
            </span>
          )}
          {meetingDate && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {new Date(meetingDate + "T00:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          )}
          {meeting.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {meeting.location}
            </span>
          )}
          {duration && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {duration}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {presidingOfficerName && (
            <span>
              <span className="text-muted-foreground">Presiding:</span> {presidingOfficerName}
            </span>
          )}
          {recordingSecretaryName && (
            <span>
              <span className="text-muted-foreground">Secretary:</span> {recordingSecretaryName}
            </span>
          )}
          {adjournment && (
            <Badge variant="secondary" className="text-xs">
              Adjourned {adjournment.method === "motion" ? "by motion" : "without objection"}
            </Badge>
          )}
        </div>
      </div>

      {/* Attendance */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Attendance</h2>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium">Member</th>
                <th className="px-4 py-2 text-left font-medium">Seat</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const att = attendanceRows.find((a) => a.board_member_id === m.boardMemberId);
                const status = att?.status ?? "absent";
                const isRecSec = att?.is_recording_secretary === true;
                const isPresiding = meeting.presiding_officer_id === m.boardMemberId;

                return (
                  <tr key={m.boardMemberId} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{m.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{m.seatTitle ?? "—"}</td>
                    <td className="px-4 py-2">
                      <AttendanceBadge status={status} />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {isPresiding && "Presiding Officer"}
                      {isRecSec && "Recording Secretary"}
                      {!isPresiding && !isRecSec && "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Agenda Coverage */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Agenda Coverage</h2>
        <div className="space-y-4">
          {sections.map(({ section, children }, sIdx) => (
            <div key={section.id}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {sIdx + 1}. {section.title}
              </h3>
              {children.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No items in this section.</p>
              ) : (
                <div className="space-y-1">
                  {children.map((item: AgendaItem, iIdx: number) => {
                    const itemTransitions = transitionsByItem.get(item.id) ?? [];
                    const timeSpent = computeTimeSpent(itemTransitions);
                    const letter = String.fromCharCode(65 + iIdx);
                    const itemMotions = motionsByItem.get(item.id) ?? [];

                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-md border px-4 py-2"
                      >
                        <ItemStatusIcon status={item.status} />
                        <span className="min-w-0 flex-1 text-sm">
                          {letter}. {item.title}
                        </span>
                        {timeSpent && (
                          <span className="text-xs text-muted-foreground">{timeSpent}</span>
                        )}
                        {itemMotions.length > 0 && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Gavel className="h-3 w-3" />
                            {itemMotions.length}
                          </Badge>
                        )}
                        <Badge
                          variant={
                            item.status === "completed"
                              ? "default"
                              : item.status === "tabled"
                                ? "secondary"
                                : item.status === "deferred"
                                  ? "outline"
                                  : "secondary"
                          }
                          className="text-xs"
                        >
                          {item.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Motions & Votes */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Motions & Votes</h2>
        {motionRows.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No motions were recorded during this meeting.
          </p>
        ) : (
          <div className="space-y-4">
            {sections.map(({ children }) =>
              children
                .filter((item) => motionsByItem.has(item.id))
                .map((item) => {
                  const itemMotions = motionsByItem.get(item.id) ?? [];
                  return (
                    <div key={item.id}>
                      <h4 className="mb-2 text-sm font-medium">{item.title}</h4>
                      <div className="space-y-2 pl-4">
                        {itemMotions.map((m) => {
                          const votes = votesByMotion.get(m.id) ?? [];
                          const tally = voteTallyOf(m.vote_summary);

                          return (
                            <div key={m.id} className="rounded-md border px-4 py-3">
                              <div className="flex items-start gap-2">
                                <Gavel className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm">{m.motion_text}</p>
                                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    {!!m.moved_by && (
                                      <span>
                                        Moved: {memberNameMap.get(m.moved_by) ?? m.moved_by}
                                      </span>
                                    )}
                                    {!!m.seconded_by && (
                                      <span>
                                        Seconded:{" "}
                                        {memberNameMap.get(m.seconded_by) ?? m.seconded_by}
                                      </span>
                                    )}
                                    {!!m.motion_type && m.motion_type !== "main" && (
                                      <Badge variant="outline" className="text-xs">
                                        {m.motion_type.replace(/_/g, " ")}
                                      </Badge>
                                    )}
                                  </div>
                                  {tally && (
                                    <div className="mt-2 text-xs">
                                      <span className="font-medium">Result: </span>
                                      <Badge
                                        variant={m.status === "passed" ? "default" : "secondary"}
                                        className="text-xs"
                                      >
                                        {m.status}
                                      </Badge>
                                      <span className="ml-2">
                                        Yeas: {tally.yeas}, Nays: {tally.nays}, Abstentions:{" "}
                                        {tally.abstentions}
                                      </span>
                                    </div>
                                  )}
                                  {votes.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {votes.map((v) => (
                                        <span
                                          key={v.id}
                                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                                            v.vote === "yea"
                                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                              : v.vote === "nay"
                                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                : v.vote === "recusal"
                                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                  : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
                                          }`}
                                        >
                                          {memberNameMap.get(v.board_member_id) ?? "?"}: {v.vote}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }),
            )}
          </div>
        )}
      </section>

      {/* Executive Sessions */}
      {execSessionRows.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Executive Sessions</h2>
          <div className="space-y-3">
            {execSessionRows.map((es: ExecutiveSession) => (
              <div
                key={es.id}
                className="rounded-md border border-red-200 bg-red-50/50 px-4 py-3 dark:border-red-900 dark:bg-red-950/20"
              >
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">{es.statutory_basis}</span>
                </div>
                <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                  {!!es.entered_at && (
                    <span>Entered: {new Date(es.entered_at).toLocaleTimeString()}</span>
                  )}
                  {!!es.exited_at && (
                    <span>Returned: {new Date(es.exited_at).toLocaleTimeString()}</span>
                  )}
                  {!!es.entered_at && !!es.exited_at && (
                    <span>Duration: {computeDuration(es.entered_at, es.exited_at)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recusals */}
      {recusals.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Recusals</h2>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Member</th>
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-4 py-2 text-left font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {recusals.map((r, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">
                      <span className="flex items-center gap-1.5">
                        <ShieldOff className="h-3.5 w-3.5 text-amber-500" />
                        {r.member}
                      </span>
                    </td>
                    <td className="px-4 py-2">{r.item}</td>
                    <td className="px-4 py-2 text-muted-foreground">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Future Items Queue */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Future Items Queue</h2>
        <FutureItemsQueue items={futureItems} />
      </section>

      {/* Action bar */}
      <div className="flex items-center justify-between border-t pt-6">
        <Button variant="outline" onClick={() => void navigate("/boards")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Return to Meeting List
        </Button>
        <div className="flex gap-2">
          {canGenerateMinutes && !hasMinutes && (
            <Button onClick={() => setGenerateDialogOpen(true)}>
              <FileText className="mr-1 h-4 w-4" />
              Generate Minutes Draft
            </Button>
          )}
          {hasMinutes && (
            <>
              <Button
                variant="outline"
                onClick={() => void navigate(`/meetings/${meetingId}/minutes`)}
              >
                <FileText className="mr-1 h-4 w-4" />
                View Minutes Draft
              </Button>
              {canGenerateMinutes &&
                minutesDoc?.status !== "approved" &&
                minutesDoc?.status !== "published" && (
                  <Button variant="outline" size="sm" onClick={() => setRegenerateDialogOpen(true)}>
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Regenerate
                  </Button>
                )}
            </>
          )}
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" />
            Export Meeting Data
          </Button>
        </div>
      </div>

      {/* Generate Minutes Dialog */}
      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Minutes Draft</DialogTitle>
            <DialogDescription>
              Generate minutes draft for {boardName} meeting on{" "}
              {meetingDate
                ? new Date(meetingDate + "T00:00:00").toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                : ""}
              .
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Minutes Style</label>
              <Select
                value={styleOverride || effectiveMinutesStyle}
                onValueChange={setStyleOverride}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="action">
                    Action Minutes — Decisions and motions only
                  </SelectItem>
                  <SelectItem value="summary">
                    Summary Minutes — Brief discussion summaries + decisions
                  </SelectItem>
                  <SelectItem value="narrative">
                    Narrative Minutes — Detailed discussion record
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Board default:{" "}
                {MINUTES_STYLE_LABELS[effectiveMinutesStyle] ?? effectiveMinutesStyle}
              </p>
            </div>
          </div>

          {generateError && (
            <p className="text-sm text-destructive" role="alert">
              {generateError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setGenerateDialogOpen(false);
                setStyleOverride("");
                setGenerateError(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleGenerateMinutes(false)} disabled={generating}>
              {generating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {generating ? "Generating..." : "Generate Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Minutes Dialog */}
      <Dialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Minutes Draft</DialogTitle>
            <DialogDescription>
              This will overwrite the existing minutes draft. The current draft will be replaced
              with a freshly generated version.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Minutes Style</label>
              <Select
                value={styleOverride || effectiveMinutesStyle}
                onValueChange={setStyleOverride}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="action">Action Minutes</SelectItem>
                  <SelectItem value="summary">Summary Minutes</SelectItem>
                  <SelectItem value="narrative">Narrative Minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {generateError && (
            <p className="text-sm text-destructive" role="alert">
              {generateError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRegenerateDialogOpen(false);
                setStyleOverride("");
                setGenerateError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleGenerateMinutes(true)}
              disabled={generating}
            >
              {generating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {generating ? "Regenerating..." : "Overwrite & Regenerate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helper Components ──────────────────────────────────────────────

function AttendanceBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
  > = {
    present: { label: "Present", variant: "default" },
    remote: { label: "Remote", variant: "secondary" },
    late_arrival: { label: "Late Arrival", variant: "secondary" },
    absent: { label: "Absent", variant: "outline" },
    departed_early: { label: "Departed Early", variant: "outline" },
  };
  const c = config[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={c.variant} className="text-xs">
      {c.label}
    </Badge>
  );
}

function ItemStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "tabled":
      return <PauseCircle className="h-4 w-4 text-amber-500" />;
    case "deferred":
      return <ArrowRightCircle className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

function computeTimeSpent(transitions: Transition[]): string | null {
  let totalMs = 0;
  transitions.forEach((t) => {
    if (t.started_at && t.ended_at) {
      totalMs += new Date(t.ended_at).getTime() - new Date(t.started_at).getTime();
    }
  });
  if (totalMs === 0) return null;
  const mins = Math.round(totalMs / 60000);
  return mins < 1 ? "<1m" : `${mins}m`;
}

function computeDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  return mins < 1 ? "<1m" : `${mins}m`;
}

export { RouteErrorBoundary as ErrorBoundary };
