/**
 * Live Meeting Page — /meetings/:meetingId/live
 *
 * Real-time operator interface for running board meetings. Provides a
 * three-panel layout: agenda navigation (left), item detail (center),
 * and attendance/timer (right).
 *
 * Status routing:
 * - draft/cancelled → redirect to boards
 * - noticed → MeetingStartFlow overlay
 * - open → three-panel live interface
 * - adjourned+ → redirect to review page
 *
 * Executive session & adjournment:
 * - Reactive detection of exec session entry/adjourn motions via useQuery
 * - Executive session banner with timer during closed session
 * - Dual adjournment: formal motion or without objection
 * - Meeting end flow: close transitions, defer unreached items, navigate to review
 *
 * ─── Phase E, wave 5, Task 4: the reads and the transport ────────────────
 *
 * Every read on this screen is tRPC now — nine of them, replacing nine raw
 * Supabase queries, and the eight `useRealtimeSubscription` channels that kept
 * them fresh are one SSE subscription (`hooks/useLiveMeetingEvents.ts`). See
 * that file for why it is one stream and not eight, and for the topic →
 * query-key mapping the multiplexing costs.
 *
 * Two reads split where a Supabase embed used to join them, and both are
 * behaviour-preserving rather than a redesign:
 *
 *   - `select("*, board(*)")` is now `meeting.detail` + `board.detail`. The
 *     board is fetched by `meeting.board_id`, which is `NOT NULL`, so the
 *     `boardId ? [...] : []` branch the loader used to carry is gone.
 *   - `select("*, exhibit(*)")` is now `agendaItem.byMeeting` +
 *     `exhibit.byMeeting`. The exhibit read is rule-14 filtered where the
 *     embed was not, which is a real, intended narrowing — see the
 *     `exhibitsByItem` comment below.
 *
 * **`town_id` is NOT read off the meeting row any more, and that is the point
 * of conventions item 10.** `meeting.detail` does not select it; it comes from
 * `useCurrentUser().townId`, the caller's own town. Reading it off a payload
 * that no longer carries it is exactly the `ArchiveBoardDialog` regression
 * that item exists to record — an empty string, compiling cleanly, silently
 * writing rows into no town at all.
 *
 * TODO(phase-e-wave-5): this file's WRITES are still raw Supabase — the
 * adjournment handler (`meeting` status 'adjourned', `agenda_item`,
 * `future_item_queue`), `navigateToItem` (`agenda_item`, `meeting`,
 * `agenda_item_transition`) and the three reactive effects
 * (`executive_session`, `minutes_document`, `notification_event`). NOT a
 * completeness gap alone for the `meeting` write: `meeting_tenant_isolation`
 * is tenancy-only, so this `.update({status: "adjourned", ...})` has no
 * authorization check of any kind today, the identical shape Phase E wave 3
 * Task 2 closed for `meeting.cancel`/`meeting.updateStatus` (see
 * `packages/api/src/trpc/routers/meeting.ts`). Task 5 owns all of them —
 * `meeting.adjourn`, `meeting.navigateToAgendaItem` and the
 * `executiveSession.*` procedures already exist and are tested, unwired.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { toast } from "sonner";
import { ErrorBoundary } from "react-error-boundary";
import { Clock, AlertTriangle } from "lucide-react";
import type { Route } from "./+types/meetings.$meetingId.live";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQuorumCheck } from "@/hooks/useQuorumCheck";
import { useSupabase } from "@/hooks/useSupabase";
import { useLiveMeetingEvents } from "@/hooks/useLiveMeetingEvents";
import { ConnectionStatusBar } from "@/components/ConnectionStatusBar";
import { ConnectionStatusBarErrorBoundary } from "@/components/FeatureErrorBoundaries";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { apiFetch } from "@/lib/api-client";
import { queryClient as sharedQueryClient } from "@/lib/queryClient";
import { MeetingTimer } from "@/components/meeting/MeetingTimer";
import { MeetingStartFlow } from "@/components/meeting/MeetingStartFlow";
import { AgendaNavigationPanel } from "@/components/meeting/AgendaNavigationPanel";
import { AgendaItemDetailPanel } from "@/components/meeting/AgendaItemDetailPanel";
import { AttendancePanel } from "@/components/meeting/AttendancePanel";
import { ExecutiveSessionDialog } from "@/components/meeting/ExecutiveSessionDialog";
import { ExecSessionBanner } from "@/components/meeting/ExecSessionBanner";
import { ExitExecutiveSessionDialog } from "@/components/meeting/ExitExecutiveSessionDialog";
import { AdjournmentControls } from "@/components/meeting/AdjournmentControls";
import { MotionCaptureDialog } from "@/components/meeting/MotionCaptureDialog";
import { hasPermission } from "@town-meeting/shared";

// ─── Row types ────────────────────────────────────────────────────
//
// Named from the procedures rather than restated, and NOT
// `Record<string, unknown>` — conventions item 10. Every one of these used to
// be that bag type, and the casts it required are what made a dropped column
// a runtime `undefined` instead of a compile error.

type MotionRow = RouterOutputs["motion"]["byMeeting"][number];
type VoteRecordRow = RouterOutputs["voteRecord"]["byMeeting"][number];
type ExhibitRow = RouterOutputs["exhibit"]["byMeeting"][number];
type GuestSpeakerRow = RouterOutputs["guestSpeaker"]["byMeeting"][number];
type TransitionRow = RouterOutputs["agendaItemTransition"]["byMeeting"][number];

// ─── Route Loader ─────────────────────────────────────────────────

/**
 * Not wrapped in try/catch, per conventions item 12: a nonexistent or foreign
 * meeting answers NOT_FOUND and letting that reject routes to
 * `RouteErrorBoundary` — visible, rather than the indefinite "Loading meeting
 * data..." the old `.single()` produced.
 *
 * Primes the same five reads the component makes; the other four
 * (`voteRecord`, `guestSpeaker`, `agendaItemTransition`, `executiveSession`,
 * `exhibit`) were not primed before this task either and still are not — the
 * panels that render them tolerate an empty first paint, which is what the
 * pre-migration loader's own choice of four already asserted.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const meetingId = params.meetingId!;

  const meeting = await sharedQueryClient.ensureQueryData(
    trpc.meeting.detail.queryOptions({ meetingId }),
  );

  // `board_id` is `NOT NULL` on `meeting`, so the `boardId ? [...] : []`
  // branch the Supabase version carried was unreachable — it existed because
  // `select("*, board(*)")` typed the id as possibly-absent, not because a
  // meeting can lack a board.
  const boardId = meeting.board_id;

  await Promise.all([
    sharedQueryClient.ensureQueryData(trpc.agendaItem.byMeeting.queryOptions({ meetingId })),
    sharedQueryClient.ensureQueryData(trpc.meetingAttendance.byMeeting.queryOptions({ meetingId })),
    sharedQueryClient.ensureQueryData(trpc.motion.byMeeting.queryOptions({ meetingId })),
    sharedQueryClient.ensureQueryData(trpc.board.detail.queryOptions({ boardId })),
    sharedQueryClient.ensureQueryData(trpc.boardMember.roster.queryOptions({ boardId })),
  ]);

  return { meetingId };
}

// ─── Component ────────────────────────────────────────────────────

export default function LiveMeetingPage({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const navigate = useNavigate();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [agendaCollapsed, setAgendaCollapsed] = useState(false);
  const [recusalMemberFromAttendance, setRecusalMemberFromAttendance] = useState<{
    boardMemberId: string;
    personId: string;
    name: string;
    seatTitle: string | null;
  } | null>(null);

  // ─── Executive session state ────────────────────────────────────
  const [execSessionDialogOpen, setExecSessionDialogOpen] = useState(false);
  const [exitExecDialogOpen, setExitExecDialogOpen] = useState(false);
  const [pendingExecCitation, setPendingExecCitation] = useState<{
    citation: string;
    citationLetter: string;
    motionText: string;
  } | null>(null);
  const [execMotionDialogOpen, setExecMotionDialogOpen] = useState(false);
  const [isPostExecSession, setIsPostExecSession] = useState(false);
  const [postExecSessionId, setPostExecSessionId] = useState<string | null>(null);

  // ─── Adjournment state ──────────────────────────────────────────
  const [adjournMotionDialogOpen, setAdjournMotionDialogOpen] = useState(false);

  // Track which motions we've already processed to avoid re-processing
  const processedMotionIds = useRef<Set<string>>(new Set());

  // ─── Permission check ─────────────────────────────────────────
  // `role` is `null` for an identity that has signed in but has no town yet
  // (Task C2 — it comes from `user_account`, which only exists inside a town).
  // `hasPermission` takes `undefined` for "no role known", and both mean deny.
  const canRunMeeting = currentUser
    ? hasPermission(
        currentUser.permissions,
        "start_run_meeting",
        undefined,
        currentUser.role ?? undefined,
      )
    : false;

  // ─── Reactive queries ─────────────────────────────────────────
  //
  // The `staleTime` each of these carries is the one its Supabase predecessor
  // carried — 10s for the meeting row, 5s for everything else. Kept rather
  // than dropped to the 60s global default: the SSE stream below makes the
  // window matter far less, but shortening or lengthening it is a behaviour
  // change this migration is not entitled to make on the way past.

  const {
    data: meeting,
    isError: isMeetingError,
    error: meetingError,
  } = useQuery({
    ...trpc.meeting.detail.queryOptions({ meetingId }),
    staleTime: 10_000,
  });

  const boardId = meeting?.board_id ?? "";
  const status = meeting?.status ?? "";
  // The CALLER'S town, not the meeting's — `meeting.detail` does not select
  // `town_id`. See this file's header, and conventions item 10.
  const townId = currentUser?.townId ?? "";

  const { data: board } = useQuery({
    ...trpc.board.detail.queryOptions({ boardId }),
    enabled: !!boardId,
    staleTime: 10_000,
  });

  // The roster is every seat on the board, of any status; the query this
  // replaces filtered `.eq("status", "active")` server-side. The filter moved
  // client-side rather than gaining a procedure of its own — `roster` is the
  // board-membership read the app already shares, and it carries `status`
  // precisely so a caller can ask this question.
  const { data: rosterRows = [] } = useQuery({
    ...trpc.boardMember.roster.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  const { data: attendanceRows = [] } = useQuery({
    ...trpc.meetingAttendance.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { data: itemRows = [] } = useQuery({
    ...trpc.agendaItem.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { data: exhibitRows = [] } = useQuery({
    ...trpc.exhibit.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { data: motionRows = [] } = useQuery({
    ...trpc.motion.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { data: voteRecordRows = [] } = useQuery({
    ...trpc.voteRecord.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { data: speakerRows = [] } = useQuery({
    ...trpc.guestSpeaker.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { data: transitionRows = [] } = useQuery({
    ...trpc.agendaItemTransition.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { data: execSessionRows = [] } = useQuery({
    ...trpc.executiveSession.byMeeting.queryOptions({ meetingId }),
    staleTime: 5_000,
  });

  const { quorum } = useQuorumCheck(meetingId, boardId);

  // ─── Realtime ──────────────────────────────────────────────────
  //
  // One SSE subscription in place of eight Supabase Realtime channels. The
  // topic → query-key mapping lives in the hook, not here, because the server
  // publishes topics and knows nothing about this screen's cache.
  useLiveMeetingEvents(meetingId);

  // ─── Data merging ─────────────────────────────────────────────

  const members = useMemo(
    () =>
      rosterRows
        .filter((m) => m.status === "active")
        .map((m) => ({
          boardMemberId: m.id,
          personId: m.person_id,
          name: m.name,
          seatTitle: m.seat_title,
          isDefaultRecSec: m.is_default_rec_sec,
        })),
    [rosterRows],
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.boardMemberId, m.name));
    return map;
  }, [members]);

  const motionsByItem = useMemo(() => {
    const map = new Map<string, MotionRow[]>();
    motionRows.forEach((m) => {
      if (!map.has(m.agenda_item_id)) map.set(m.agenda_item_id, []);
      map.get(m.agenda_item_id)!.push(m);
    });
    return map;
  }, [motionRows]);

  const votesByMotion = useMemo(() => {
    const map = new Map<string, VoteRecordRow[]>();
    voteRecordRows.forEach((v) => {
      if (!map.has(v.motion_id)) map.set(v.motion_id, []);
      map.get(v.motion_id)!.push(v);
    });
    return map;
  }, [voteRecordRows]);

  /**
   * Exhibits used to arrive embedded in the agenda read
   * (`select("*, exhibit(*)")`); they are their own procedure now.
   *
   * **That is a narrowing, and an intended one.** `exhibit.byMeeting` applies
   * rule 14 per row (`rules.ts`), so a caller who may not see an `admin_only`
   * or `board_only` attachment no longer receives its title here — where the
   * PostgREST embed handed back every row RLS allowed, with no
   * visibility rule at all. Wave 4, Task 3 made the same change on the agenda
   * builder and pinned the degradation there ("degrades to zero exhibits, not
   * to a broken screen"); this screen lists exhibit titles only, with no count
   * beside them to disagree with, so there is nothing here that could read "3
   * exhibits" above an empty list.
   */
  const exhibitsByItem = useMemo(() => {
    const map = new Map<string, ExhibitRow[]>();
    exhibitRows.forEach((e) => {
      if (!map.has(e.agenda_item_id)) map.set(e.agenda_item_id, []);
      map.get(e.agenda_item_id)!.push(e);
    });
    return map;
  }, [exhibitRows]);

  const speakersByItem = useMemo(() => {
    const map = new Map<string, GuestSpeakerRow[]>();
    speakerRows.forEach((s) => {
      if (s.agenda_item_id === null) return;
      const itemId = s.agenda_item_id;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(s);
    });
    return map;
  }, [speakerRows]);

  // Build sections → items tree
  const allItems = itemRows;

  const sections = useMemo(() => {
    const parents = allItems.filter((item) => !item.parent_item_id);
    return parents.map((section) => {
      const children = allItems
        .filter((item) => item.parent_item_id === section.id)
        .map((item) => {
          const subItems = allItems
            .filter((sub) => sub.parent_item_id === item.id)
            .map((sub) => ({
              id: sub.id,
              title: sub.title,
              sortOrder: sub.sort_order,
            }));

          return {
            id: item.id,
            title: item.title,
            sortOrder: item.sort_order,
            status: item.status,
            estimatedDuration: item.estimated_duration,
            hasMotions: motionsByItem.has(item.id),
            subItems,
          };
        });

      return {
        id: section.id,
        title: section.title,
        sectionType: section.section_type,
        sortOrder: section.sort_order,
        status: section.status,
        items: children,
      };
    });
  }, [allItems, motionsByItem]);

  // Flat ordered item list for navigation
  const flatItems = useMemo(() => {
    const items: Array<{
      id: string;
      sectionTitle: string;
      sectionType: string;
      sectionIdx: number;
      itemIdx: number;
    }> = [];
    sections.forEach((section, sIdx) => {
      section.items.forEach((item, iIdx) => {
        items.push({
          id: item.id,
          sectionTitle: section.title,
          sectionType: section.sectionType,
          sectionIdx: sIdx,
          itemIdx: iIdx,
        });
      });
    });
    return items;
  }, [sections]);

  const currentItemId = meeting?.current_agenda_item_id ?? null;
  const currentFlatIdx = flatItems.findIndex((i) => i.id === currentItemId);
  const firstItemId = flatItems[0]?.id ?? null;

  // Current item's transition for per-item timer
  const currentTransition = useMemo<TransitionRow | null>(() => {
    if (!currentItemId) return null;
    const transitions = transitionRows.filter(
      (t) => t.agenda_item_id === currentItemId && !t.ended_at,
    );
    return transitions[transitions.length - 1] ?? null;
  }, [transitionRows, currentItemId]);

  // Build current item detail
  const currentItemDetail = useMemo(() => {
    if (!currentItemId) return null;
    const raw = allItems.find((i) => i.id === currentItemId);
    if (!raw) return null;

    const flatInfo = flatItems.find((i) => i.id === currentItemId);
    const letter = flatInfo ? String.fromCharCode(65 + flatInfo.itemIdx) : "";
    const sectionRef = flatInfo ? `${flatInfo.sectionIdx + 1}${letter}` : "";

    const itemMotions = (motionsByItem.get(currentItemId) ?? []).map((m) => ({
      id: m.id,
      motionText: m.motion_text,
      motionType: m.motion_type,
      movedBy: m.moved_by,
      secondedBy: m.seconded_by,
      status: m.status,
      parentMotionId: m.parent_motion_id,
      voteSummary: m.vote_summary,
    }));

    const itemExhibits = (exhibitsByItem.get(currentItemId) ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      fileName: e.file_name ?? "",
    }));

    const itemSpeakers = (speakersByItem.get(currentItemId) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      topic: s.topic,
      created_at: s.created_at,
    }));

    const subItems = allItems
      .filter((sub) => sub.parent_item_id === currentItemId)
      .map((sub) => ({
        id: sub.id,
        title: sub.title,
        sortOrder: sub.sort_order,
      }));

    // Find the section this item belongs to
    const section = allItems.find((i) => i.id === raw.parent_item_id);

    return {
      id: currentItemId,
      title: raw.title,
      sectionTitle: section?.title ?? "",
      sectionType: section?.section_type ?? raw.section_type,
      sectionRef,
      description: raw.description,
      presenter: raw.presenter,
      staffResource: raw.staff_resource,
      background: raw.background,
      recommendation: raw.recommendation,
      suggestedMotion: raw.suggested_motion,
      operatorNotes: raw.operator_notes,
      estimatedDuration: raw.estimated_duration,
      status: raw.status,
      exhibits: itemExhibits,
      subItems,
      speakers: itemSpeakers,
      motions: itemMotions,
    };
  }, [currentItemId, allItems, flatItems, motionsByItem, exhibitsByItem, speakersByItem]);

  // Present members for motion forms
  const presentMembers = useMemo(
    () =>
      members.filter((m) =>
        attendanceRows.some(
          (a) =>
            a.board_member_id === m.boardMemberId &&
            (a.status === "present" || a.status === "remote" || a.status === "late_arrival"),
        ),
      ),
    [members, attendanceRows],
  );

  // ─── Executive session detection ────────────────────────────────

  const activeExecSession = useMemo(
    () => execSessionRows.find((es) => es.entered_at && !es.exited_at) ?? null,
    [execSessionRows],
  );

  const isInExecSession = !!activeExecSession;

  const pendingExecSession = useMemo(
    () =>
      execSessionRows.find((es) => es.entry_motion_id && !es.entered_at && !es.exited_at) ?? null,
    [execSessionRows],
  );

  // Reactive: when entry motion for exec session passes → set entered_at
  // When entry motion fails → delete the pending exec session record
  useEffect(() => {
    if (!pendingExecSession || !motionRows.length) return;
    const entryMotionId = pendingExecSession.entry_motion_id;
    const entryMotion = motionRows.find((m) => m.id === entryMotionId);
    if (!entryMotion || entryMotionId === null) return;

    const motionStatus = entryMotion.status;
    const esId = pendingExecSession.id;

    if (processedMotionIds.current.has(entryMotionId)) return;

    if (motionStatus === "passed") {
      processedMotionIds.current.add(entryMotionId);
      const now = new Date().toISOString();
      void (async () => {
        await supabase.from("executive_session").update({ entered_at: now }).eq("id", esId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
        });
        void queryClient.invalidateQueries(trpc.executiveSession.pathFilter());
      })();
    } else if (motionStatus === "failed") {
      processedMotionIds.current.add(entryMotionId);
      void (async () => {
        await supabase.from("executive_session").delete().eq("id", esId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
        });
        void queryClient.invalidateQueries(trpc.executiveSession.pathFilter());
      })();
    }
  }, [pendingExecSession, motionRows, supabase, queryClient, meetingId]);

  // Reactive: when adjourn motion passes → trigger meeting end
  useEffect(() => {
    if (!motionRows.length || status !== "open") return;
    const adjournMotion = motionRows.find(
      (m) => m.motion_type === "adjourn" && m.status === "passed",
    );
    if (!adjournMotion) return;
    const motionId = adjournMotion.id;
    if (processedMotionIds.current.has(`adjourn_${motionId}`)) return;
    processedMotionIds.current.add(`adjourn_${motionId}`);
    void handleMeetingEnd("motion", motionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionRows, status]);

  // Reactive: when a minutes-approval motion passes → auto-approve minutes
  useEffect(() => {
    if (!motionRows.length || !itemRows.length) return;

    const approvalItems = itemRows.filter((item) => item.source_minutes_document_id !== null);
    if (approvalItems.length === 0) return;

    for (const item of approvalItems) {
      const itemMotions = motionRows.filter(
        (m) => m.agenda_item_id === item.id && m.status === "passed",
      );

      for (const motion of itemMotions) {
        const key = `minutes_approve_${motion.id}`;
        if (processedMotionIds.current.has(key)) continue;
        processedMotionIds.current.add(key);

        const docId = item.source_minutes_document_id!;
        const now = new Date().toISOString();
        const motionText = motion.motion_text.toLowerCase();
        const asAmended =
          motionText.includes("as amended") || motionText.includes("with corrections");

        void (async () => {
          // Update minutes_document status to approved
          await supabase
            .from("minutes_document")
            .update({
              status: "approved",
              approved_at: now,
              approved_by_motion_id: motion.id,
              approved_as_amended: asAmended,
              updated_at: now,
            })
            .eq("id", docId);

          void queryClient.invalidateQueries({
            queryKey: queryKeys.minutesDocuments.byMeeting(meetingId),
          });
          // Moves `minutes_document.status` to `approved` — exactly the pill
          // `routes/meetings.$meetingId.tsx`'s shell renders from
          // `trpc.minutesDocument.byMeeting`. Note the legacy key above is
          // keyed by the LIVE meeting's id while `docId` belongs to the
          // EARLIER meeting whose minutes are being approved here (it comes
          // off `item.source_minutes_document_id`), so that key never
          // reaches the shell that actually shows this document. The
          // router-level filter does — one more reason item 7 prefers it.
          void queryClient.invalidateQueries(trpc.minutesDocument.pathFilter());

          // Fire notification event (fire-and-forget)
          await supabase.from("notification_event").insert({
            id: crypto.randomUUID(),
            town_id: townId,
            event_type: "minutes_approved",
            payload: {
              minutes_document_id: docId,
              meeting_id: meetingId,
              approved_by_motion_id: motion.id,
            },
            status: "pending",
            created_at: now,
          });

          // Regenerate the PDF without the DRAFT watermark (fire-and-forget).
          await apiFetch(`/api/meetings/${meetingId}/minutes/render`, {
            method: "POST",
            json: { is_draft: false },
          }).catch(() => {
            // Non-critical — the minutes screen can re-render on demand.
          });
        })();
      }
    }
  }, [motionRows, itemRows, supabase, queryClient, townId, meetingId]);

  // Track post-session action motions: any motion created after returning
  // from exec session gets linked to the exec session record
  useEffect(() => {
    if (!isPostExecSession || !postExecSessionId || !motionRows.length) return;
    const execSession = execSessionRows.find((es) => es.id === postExecSessionId);
    if (!execSession) return;

    // `post_session_action_motion_ids` is a JSONB array, so the procedure
    // declares it `unknown` — the runtime narrowing below is what it always
    // was, now doing real work rather than sitting under a cast.
    const existingIds: string[] = Array.isArray(execSession.post_session_action_motion_ids)
      ? (execSession.post_session_action_motion_ids as string[])
      : [];

    const exitedAt = execSession.exited_at;
    if (!exitedAt) return;

    const postMotions = motionRows.filter(
      (m) => m.created_at > exitedAt && !existingIds.includes(m.id),
    );

    if (postMotions.length > 0) {
      const newIds = [...existingIds, ...postMotions.map((m) => m.id)];
      void (async () => {
        await supabase
          .from("executive_session")
          .update({ post_session_action_motion_ids: newIds })
          .eq("id", postExecSessionId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
        });
        void queryClient.invalidateQueries(trpc.executiveSession.pathFilter());
      })();
    }
  }, [
    isPostExecSession,
    postExecSessionId,
    motionRows,
    execSessionRows,
    supabase,
    queryClient,
    meetingId,
  ]);

  // Find the item that belongs to the executive session section (for lock icon)
  const execSessionItemId = useMemo(
    () => activeExecSession?.agenda_item_id ?? null,
    [activeExecSession],
  );

  // Presiding officer name for adjournment controls
  const presidingOfficerName = useMemo(() => {
    const presidingId = meeting?.presiding_officer_id ?? null;
    if (!presidingId) return "Chair";
    return memberNameMap.get(presidingId) ?? "Chair";
  }, [meeting?.presiding_officer_id, memberNameMap]);

  // ─── Navigation ───────────────────────────────────────────────

  const navigateToItem = useCallback(
    async (itemId: string) => {
      const now = new Date().toISOString();

      // End current transition
      if (currentItemId && currentTransition) {
        await supabase
          .from("agenda_item_transition")
          .update({ ended_at: now })
          .eq("id", currentTransition.id);
      }

      // Set current item to active
      await supabase
        .from("agenda_item")
        .update({ status: "active", updated_at: now })
        .eq("id", itemId);

      // Update meeting's current item
      await supabase
        .from("meeting")
        .update({ current_agenda_item_id: itemId, updated_at: now })
        .eq("id", meetingId);

      // Create new transition
      const transId = crypto.randomUUID();
      await supabase.from("agenda_item_transition").insert({
        id: transId,
        meeting_id: meetingId,
        agenda_item_id: itemId,
        town_id: townId,
        started_at: now,
        ended_at: null,
      });

      // Invalidate affected queries
      void queryClient.invalidateQueries({
        queryKey: queryKeys.meetings.detail(meetingId),
      });
      // Writes `meeting.current_agenda_item_id`, which THIS screen reads
      // through `trpc.meeting.detail` and the kanban through
      // `trpc.meeting.byTown`. The legacy key above reached neither once this
      // screen's meeting read moved (wave 5, Task 4).
      void queryClient.invalidateQueries(trpc.meeting.pathFilter());
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agendaItems.byMeeting(meetingId),
      });
      // Sets the ARRIVED item to `active` — one `agenda_item` row, invalidated
      // at the router.
      //
      // This comment used to say it also set the DEPARTED item to
      // `completed`. It does not, and never did: the only `agenda_item` write
      // above is `.eq("id", itemId)` for the item being navigated TO. The
      // departed item keeps whatever status it had — which is the behaviour
      // `meeting.navigateToAgendaItem` (wave 5, Task 3) preserved deliberately
      // and pinned with a test asserting the departed item stays `active`.
      // Corrected rather than carried across this migration.
      void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId),
      });
      // Closes one transition row and opens another — the read behind this
      // screen's per-item timer, now `trpc.agendaItemTransition.byMeeting`.
      void queryClient.invalidateQueries(trpc.agendaItemTransition.pathFilter());
    },
    [currentItemId, currentTransition, meetingId, townId, supabase, queryClient],
  );

  const navigateNext = useCallback(() => {
    if (currentFlatIdx < flatItems.length - 1) {
      void navigateToItem(flatItems[currentFlatIdx + 1]!.id);
    }
  }, [currentFlatIdx, flatItems, navigateToItem]);

  const navigatePrev = useCallback(() => {
    if (currentFlatIdx > 0) {
      void navigateToItem(flatItems[currentFlatIdx - 1]!.id);
    }
  }, [currentFlatIdx, flatItems, navigateToItem]);

  // ─── Executive session handlers ─────────────────────────────────

  const handleExecSessionProceed = useCallback(
    (citation: string, citationLetter: string, motionText: string) => {
      setPendingExecCitation({ citation, citationLetter, motionText });
      setExecMotionDialogOpen(true);
    },
    [],
  );

  // Called after exec session entry motion is filed — create the pending
  // exec session record linked to the motion
  const handleExecMotionFiled = useCallback(async () => {
    if (!pendingExecCitation || !currentItemId) return;

    const itemMotions = motionsByItem.get(currentItemId) ?? [];
    const entryMotion = [...itemMotions]
      .reverse()
      .find((m) => m.motion_text.includes("Executive Session"));

    if (!entryMotion) return;

    const esId = crypto.randomUUID();
    const now = new Date().toISOString();
    await supabase.from("executive_session").insert({
      id: esId,
      meeting_id: meetingId,
      agenda_item_id: currentItemId,
      town_id: townId,
      statutory_basis: pendingExecCitation.citation,
      entered_at: null,
      exited_at: null,
      entry_motion_id: entryMotion.id,
      post_session_action_motion_ids: [],
      created_at: now,
    });

    void queryClient.invalidateQueries({
      queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
    });
    void queryClient.invalidateQueries(trpc.executiveSession.pathFilter());

    setPendingExecCitation(null);
  }, [pendingExecCitation, currentItemId, motionsByItem, meetingId, townId, supabase, queryClient]);

  const handleExecMotionDialogClose = useCallback(
    (open: boolean) => {
      setExecMotionDialogOpen(open);
      if (!open && pendingExecCitation) {
        void handleExecMotionFiled();
      }
    },
    [pendingExecCitation, handleExecMotionFiled],
  );

  const handleReturnToPublic = useCallback(() => {
    setExitExecDialogOpen(true);
  }, []);

  const handleExitExecWithActions = useCallback(() => {
    if (activeExecSession) {
      setIsPostExecSession(true);
      setPostExecSessionId(activeExecSession.id);
    }
  }, [activeExecSession]);

  const handleExitExecNoActions = useCallback(() => {
    setIsPostExecSession(false);
    setPostExecSessionId(null);
  }, []);

  const handleDonePostExecActions = useCallback(() => {
    setIsPostExecSession(false);
    setPostExecSessionId(null);
  }, []);

  // ─── Meeting end flow ───────────────────────────────────────────

  const handleMeetingEnd = useCallback(
    async (method: "motion" | "without_objection", adjournMotionId?: string) => {
      const now = new Date().toISOString();

      // 1. End current transition
      if (currentTransition) {
        await supabase
          .from("agenda_item_transition")
          .update({ ended_at: now })
          .eq("id", currentTransition.id);
      }

      // 2. Mark pending/active items as "deferred" and create future_item_queue entries
      const unreachedItems = allItems.filter(
        (item) =>
          item.parent_item_id !== null &&
          (item.status === "pending" || item.status === "active") &&
          item.id !== currentItemId,
      );

      for (const item of unreachedItems) {
        await supabase
          .from("agenda_item")
          .update({ status: "deferred", updated_at: now })
          .eq("id", item.id);

        await supabase.from("future_item_queue").insert({
          id: crypto.randomUUID(),
          board_id: boardId,
          town_id: townId,
          source_meeting_id: meetingId,
          source_agenda_item_id: item.id,
          title: item.title,
          description: item.description,
          source: "deferred",
          status: "pending",
          created_at: now,
        });
      }

      // 3. Also add tabled items to future queue
      const tabledItems = allItems.filter((item) => {
        if (!item.parent_item_id) return false;
        const itemMotions = motionsByItem.get(item.id) ?? [];
        return itemMotions.some((m) => m.motion_type === "table" && m.status === "passed");
      });

      for (const item of tabledItems) {
        await supabase.from("future_item_queue").insert({
          id: crypto.randomUUID(),
          board_id: boardId,
          town_id: townId,
          source_meeting_id: meetingId,
          source_agenda_item_id: item.id,
          title: item.title,
          description: item.description,
          source: "tabled",
          status: "pending",
          created_at: now,
        });
      }

      // 4. Build adjournment JSONB (Supabase handles native objects)
      const adjournment = {
        method,
        adjourned_by: currentUser?.personId ?? null,
        adjourned_by_name: presidingOfficerName,
        motion_id: adjournMotionId ?? null,
        timestamp: now,
      };

      // 5. Update meeting: status=adjourned, ended_at, adjournment, clear current item
      await supabase
        .from("meeting")
        .update({
          status: "adjourned",
          ended_at: now,
          adjournment,
          current_agenda_item_id: null,
          updated_at: now,
        })
        .eq("id", meetingId);

      // Invalidate affected queries
      void queryClient.invalidateQueries({
        queryKey: queryKeys.meetings.detail(meetingId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agendaItems.byMeeting(meetingId),
      });
      // Adjournment marks the unreached items `deferred` and copies both the
      // unreached and the tabled ones into `future_item_queue` —
      // `agenda_item` writes, invalidated at the router.
      //
      // This comment used to say `completed` and `future_agenda_item`. Both
      // are wrong against the code directly above it: step 2 writes
      // `status: "deferred"`, and the table is `future_item_queue` (there is
      // no `future_agenda_item` table in this schema). Corrected here rather
      // than carried across the migration; `meeting.adjourn` (wave 5, Task 3)
      // writes exactly what this code does and names it correctly.
      void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
      // The kanban (routes/meetings.tsx) and board Meetings tab
      // (routes/boards.$boardId.meetings.tsx) both read this meeting's
      // status via trpc.meeting.byTown/byBoard — this write moves it open
      // → adjourned, which both screens render.
      void queryClient.invalidateQueries(trpc.meeting.pathFilter());
      // Step 1 closes the open `agenda_item_transition` row.
      void queryClient.invalidateQueries(trpc.agendaItemTransition.pathFilter());

      toast.success("Meeting adjourned");

      // 6. Navigate to review page
      void navigate(`/meetings/${meetingId}/review`);
    },
    [
      currentTransition,
      allItems,
      currentItemId,
      motionsByItem,
      boardId,
      townId,
      meetingId,
      currentUser,
      presidingOfficerName,
      supabase,
      queryClient,
      navigate,
    ],
  );

  const handleAdjournMotion = useCallback(() => {
    setAdjournMotionDialogOpen(true);
  }, []);

  const handleAdjournWithoutObjection = useCallback(() => {
    void handleMeetingEnd("without_objection");
  }, [handleMeetingEnd]);

  // ─── Keyboard shortcuts ───────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (status !== "open") return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigatePrev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [status, navigateNext, navigatePrev]);

  // ─── Status routing ───────────────────────────────────────────

  // Conventions item 5. The loader's `ensureQueryData` rejection is handled by
  // `RouteErrorBoundary` (item 12, exported at the bottom of this module), but
  // that boundary is not re-entered for a failure AFTER mount — a refetch, a
  // `staleTime` expiry, or the stream's own invalidation landing on a server
  // that has since gone away. Without this branch the screen sat on "Loading
  // meeting data..." indefinitely, which is precisely the silent failure Phase
  // E exists to end.
  if (isMeetingError) {
    const notFound = isTRPCClientError(meetingError) && meetingError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" aria-hidden="true" />
          <p className="text-sm font-medium">
            {notFound
              ? "This meeting could not be found."
              : "Something went wrong loading this meeting."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {notFound
              ? "It may have been deleted, or it belongs to another town."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading meeting data...</p>
      </div>
    );
  }

  if (status === "draft" || status === "cancelled") {
    void navigate("/boards", { replace: true });
    return null;
  }

  if (status === "adjourned" || status === "minutes_draft" || status === "approved") {
    void navigate(`/meetings/${meetingId}/review`, { replace: true });
    return null;
  }

  if (!canRunMeeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <h2 className="text-lg font-semibold">Permission Required</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You need the "Start/Run Meeting" permission to access the live meeting interface.
          </p>
        </div>
      </div>
    );
  }

  const readOnly = false;
  const meetingStartedAt = meeting.started_at;

  // ─── Noticed → Show start flow ─────────────────────────────

  if (status === "noticed") {
    return (
      <MeetingStartFlow
        meetingId={meetingId}
        townId={townId}
        boardId={boardId}
        members={members}
        attendance={attendanceRows}
        quorumRequired={quorum?.required ?? 0}
        quorumPresent={quorum?.present ?? 0}
        quorumTotal={quorum?.total ?? 0}
        hasQuorum={quorum?.hasQuorum ?? false}
        firstItemId={firstItemId}
      />
    );
  }

  // ─── Open → Three-panel layout ────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Connection status banner (prominent in live meeting context)
          Wrapped in error boundary — must never crash and take the whole meeting view */}
      <ConnectionStatusBarErrorBoundary>
        <ConnectionStatusBar prominent={true} />
      </ConnectionStatusBarErrorBoundary>

      {/* Header bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{meeting.title}</h1>
          <Badge variant="default">In Progress</Badge>
          {board && <span className="text-sm text-muted-foreground">{board.name}</span>}
        </div>
        <div className="flex items-center gap-4">
          {meetingStartedAt && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <MeetingTimer startedAt={meetingStartedAt} />
            </div>
          )}
          {quorum && !quorum.hasQuorum && (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400"
            >
              <AlertTriangle className="mr-1 h-3 w-3" />
              No quorum
            </Badge>
          )}
          {isPostExecSession && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
              Post-Session Actions
            </Badge>
          )}
          {!isInExecSession && (
            <AdjournmentControls
              presidingOfficerName={presidingOfficerName}
              onAdjournMotion={handleAdjournMotion}
              onAdjournWithoutObjection={handleAdjournWithoutObjection}
            />
          )}
        </div>
      </div>

      {/* Executive session banner */}
      {isInExecSession && activeExecSession && (
        <ExecSessionBanner
          citation={activeExecSession.statutory_basis}
          enteredAt={activeExecSession.entered_at ?? ""}
          onReturnToPublic={handleReturnToPublic}
        />
      )}

      {/* Post-exec session action bar */}
      {isPostExecSession && !isInExecSession && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-6 py-2 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Recording post-executive-session actions. File any motions resulting from executive
            session discussion.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-700"
            onClick={handleDonePostExecActions}
          >
            Done with Post-Session Actions
          </Button>
        </div>
      )}

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        <ErrorBoundary FallbackComponent={PanelErrorFallback}>
          <AgendaNavigationPanel
            sections={sections}
            currentItemId={currentItemId}
            onNavigate={(id) => void navigateToItem(id)}
            readOnly={readOnly}
            collapsed={agendaCollapsed}
            onToggleCollapse={() => setAgendaCollapsed((c) => !c)}
            execSessionItemId={isInExecSession ? execSessionItemId : undefined}
          />
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={PanelErrorFallback}>
          <AgendaItemDetailPanel
            item={currentItemDetail}
            meetingId={meetingId}
            boardId={boardId}
            townId={townId}
            allMembers={members}
            presentMembers={presentMembers}
            memberNameMap={memberNameMap}
            attendanceRecords={attendanceRows}
            votesByMotion={votesByMotion}
            motionDisplayFormat={board?.motion_display_format ?? null}
            boardQuorumConfig={{
              quorumType: board?.quorum_type ?? null,
              quorumValue: board?.quorum_value ?? null,
              memberCount: board?.member_count ?? 0,
            }}
            onNavigatePrev={navigatePrev}
            onNavigateNext={navigateNext}
            hasPrev={currentFlatIdx > 0}
            hasNext={currentFlatIdx < flatItems.length - 1}
            readOnly={readOnly}
            externalRecusalMember={recusalMemberFromAttendance}
            onExternalRecusalConsumed={() => setRecusalMemberFromAttendance(null)}
            isInExecSession={isInExecSession}
            onEnterExecSession={() => setExecSessionDialogOpen(true)}
          />
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={PanelErrorFallback}>
          <AttendancePanel
            meetingId={meetingId}
            townId={townId}
            members={members}
            attendance={attendanceRows}
            presidingOfficerId={meeting.presiding_officer_id}
            recordingSecretaryId={meeting.recording_secretary_id}
            quorumRequired={quorum?.required ?? 0}
            quorumPresent={quorum?.present ?? 0}
            quorumTotal={quorum?.total ?? 0}
            hasQuorum={quorum?.hasQuorum ?? false}
            meetingStartedAt={meetingStartedAt}
            currentItemStartedAt={currentTransition?.started_at ?? null}
            currentItemEstimatedDuration={currentItemDetail?.estimatedDuration ?? null}
            readOnly={readOnly}
            onRecuse={(member) => setRecusalMemberFromAttendance(member)}
          />
        </ErrorBoundary>
      </div>

      {/* ─── Dialogs ─────────────────────────────────────────────── */}

      {/* Executive session citation dialog */}
      <ExecutiveSessionDialog
        open={execSessionDialogOpen}
        onOpenChange={setExecSessionDialogOpen}
        onProceed={handleExecSessionProceed}
      />

      {/* Executive session entry motion dialog (reuses MotionCaptureDialog) */}
      {pendingExecCitation && currentItemId && (
        <MotionCaptureDialog
          open={execMotionDialogOpen}
          onOpenChange={handleExecMotionDialogClose}
          mode={{
            type: "custom",
            motionType: "main",
            prefillText: pendingExecCitation.motionText,
          }}
          meetingId={meetingId}
          townId={townId}
          agendaItemId={currentItemId}
          presentMembers={presentMembers}
        />
      )}

      {/* Exit executive session dialog */}
      {activeExecSession && (
        <ExitExecutiveSessionDialog
          open={exitExecDialogOpen}
          onOpenChange={setExitExecDialogOpen}
          execSessionId={activeExecSession.id}
          onReturnWithActions={handleExitExecWithActions}
          onReturnNoActions={handleExitExecNoActions}
        />
      )}

      {/* Adjournment motion dialog (reuses MotionCaptureDialog) */}
      {currentItemId && (
        <MotionCaptureDialog
          open={adjournMotionDialogOpen}
          onOpenChange={setAdjournMotionDialogOpen}
          mode={{
            type: "custom",
            motionType: "adjourn",
            prefillText: "to adjourn the meeting",
          }}
          meetingId={meetingId}
          townId={townId}
          agendaItemId={currentItemId}
          presentMembers={presentMembers}
        />
      )}
    </div>
  );
}

// ─── Error Fallback ─────────────────────────────────────────────

function PanelErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      <AlertTriangle className="mb-2 h-6 w-6 text-amber-500" />
      <p className="text-sm font-medium">Panel encountered an error</p>
      <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={resetErrorBoundary}>
        Retry
      </Button>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
