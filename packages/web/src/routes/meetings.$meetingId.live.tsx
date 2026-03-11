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
 * - adjourned+ → read-only review mode
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, usePowerSync } from "@powersync/react";
import { ErrorBoundary } from "react-error-boundary";
import { Clock, AlertTriangle } from "lucide-react";
import type { Route } from "./+types/meetings.$meetingId.live";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQuorumCheck } from "@/hooks/useQuorumCheck";
import { MeetingTimer } from "@/components/meeting/MeetingTimer";
import { MeetingStartFlow } from "@/components/meeting/MeetingStartFlow";
import { AgendaNavigationPanel } from "@/components/meeting/AgendaNavigationPanel";
import { AgendaItemDetailPanel } from "@/components/meeting/AgendaItemDetailPanel";
import { AttendancePanel } from "@/components/meeting/AttendancePanel";
import { hasPermission } from "@town-meeting/shared";
import { cn } from "@/lib/utils";

// ─── Route Loader ─────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { meetingId: params.meetingId };
}

// ─── Component ────────────────────────────────────────────────────

export default function LiveMeetingPage({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const navigate = useNavigate();
  const powerSync = usePowerSync();
  const currentUser = useCurrentUser();
  const [agendaCollapsed, setAgendaCollapsed] = useState(false);
  const [recusalMemberFromAttendance, setRecusalMemberFromAttendance] = useState<{
    boardMemberId: string;
    personId: string;
    name: string;
    seatTitle: string | null;
  } | null>(null);

  // ─── Permission check ─────────────────────────────────────────
  const canRunMeeting = currentUser
    ? hasPermission(
        currentUser.permissions,
        "M1",
        undefined,
        currentUser.role,
      )
    : false;

  // ─── Reactive queries (no JOINs) ─────────────────────────────
  const { data: meetingRows } = useQuery(
    "SELECT * FROM meetings WHERE id = ? LIMIT 1",
    [meetingId],
  );
  const meeting = meetingRows?.[0] as Record<string, unknown> | undefined;
  const boardId = (meeting?.board_id as string) ?? "";
  const townId = (meeting?.town_id as string) ?? "";
  const status = (meeting?.status as string) ?? "";

  const { data: boardRows } = useQuery(
    "SELECT * FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );
  const board = boardRows?.[0] as Record<string, unknown> | undefined;

  const { data: memberRows } = useQuery(
    "SELECT * FROM board_members WHERE board_id = ? AND status = 'active'",
    [boardId],
  );

  const { data: personRows } = useQuery(
    "SELECT * FROM persons WHERE town_id = ?",
    [townId],
  );

  const { data: attendanceRows } = useQuery(
    "SELECT * FROM meeting_attendance WHERE meeting_id = ?",
    [meetingId],
  );

  const { data: itemRows } = useQuery(
    "SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order ASC",
    [meetingId],
  );

  const { data: motionRows } = useQuery(
    "SELECT * FROM motions WHERE meeting_id = ?",
    [meetingId],
  );

  const { data: voteRecordRows } = useQuery(
    "SELECT * FROM vote_records WHERE meeting_id = ?",
    [meetingId],
  );

  const { data: exhibitRows } = useQuery(
    "SELECT * FROM exhibits WHERE town_id = ?",
    [townId],
  );

  const { data: speakerRows } = useQuery(
    "SELECT * FROM guest_speakers WHERE meeting_id = ? ORDER BY created_at ASC",
    [meetingId],
  );

  const { data: transitionRows } = useQuery(
    "SELECT * FROM agenda_item_transitions WHERE meeting_id = ? ORDER BY started_at ASC",
    [meetingId],
  );

  const { quorum } = useQuorumCheck(meetingId, boardId);

  // ─── Data merging ─────────────────────────────────────────────

  const personMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    (personRows ?? []).forEach((p: Record<string, unknown>) => map.set(p.id as string, p));
    return map;
  }, [personRows]);

  const members = useMemo(
    () =>
      (memberRows ?? []).map((m: Record<string, unknown>) => {
        const person = personMap.get(m.person_id as string);
        return {
          boardMemberId: m.id as string,
          personId: m.person_id as string,
          name: (person?.name as string) ?? "Unknown",
          seatTitle: (m.seat_title as string) ?? null,
          isDefaultRecSec: (m.is_default_rec_sec as number) === 1,
        };
      }),
    [memberRows, personMap],
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.boardMemberId, m.name));
    return map;
  }, [members]);

  const motionsByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (motionRows ?? []).forEach((m: Record<string, unknown>) => {
      const itemId = m.agenda_item_id as string;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(m);
    });
    return map;
  }, [motionRows]);

  const votesByMotion = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (voteRecordRows ?? []).forEach((v: Record<string, unknown>) => {
      const mId = v.motion_id as string;
      if (!map.has(mId)) map.set(mId, []);
      map.get(mId)!.push(v);
    });
    return map;
  }, [voteRecordRows]);

  const exhibitsByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (exhibitRows ?? []).forEach((e: Record<string, unknown>) => {
      const itemId = e.agenda_item_id as string;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(e);
    });
    return map;
  }, [exhibitRows]);

  const speakersByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (speakerRows ?? []).forEach((s: Record<string, unknown>) => {
      const itemId = s.agenda_item_id as string;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(s);
    });
    return map;
  }, [speakerRows]);

  // Build sections → items tree
  const allItems = useMemo(() => itemRows ?? [], [itemRows]);

  const sections = useMemo(() => {
    const parents = allItems.filter(
      (item: Record<string, unknown>) => !item.parent_item_id,
    );
    return parents.map((section: Record<string, unknown>, sIdx: number) => {
      const children = allItems
        .filter((item: Record<string, unknown>) => item.parent_item_id === section.id)
        .map((item: Record<string, unknown>) => {
          const subItems = allItems
            .filter((sub: Record<string, unknown>) => sub.parent_item_id === item.id)
            .map((sub: Record<string, unknown>) => ({
              id: sub.id as string,
              title: sub.title as string,
              sortOrder: sub.sort_order as number,
            }));

          return {
            id: item.id as string,
            title: item.title as string,
            sortOrder: item.sort_order as number,
            status: (item.status as string) ?? "pending",
            estimatedDuration: (item.estimated_duration as number) ?? null,
            hasMotions: motionsByItem.has(item.id as string),
            subItems,
          };
        });

      return {
        id: section.id as string,
        title: section.title as string,
        sectionType: (section.section_type as string) ?? "other",
        sortOrder: section.sort_order as number,
        status: (section.status as string) ?? "pending",
        items: children,
      };
    });
  }, [allItems, motionsByItem]);

  // Flat ordered item list for navigation
  const flatItems = useMemo(() => {
    const items: Array<{ id: string; sectionTitle: string; sectionType: string; sectionIdx: number; itemIdx: number }> = [];
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

  const currentItemId = (meeting?.current_agenda_item_id as string) ?? null;
  const currentFlatIdx = flatItems.findIndex((i) => i.id === currentItemId);
  const firstItemId = flatItems[0]?.id ?? null;

  // Current item's transition for per-item timer
  const currentTransition = useMemo(() => {
    if (!currentItemId) return null;
    const transitions = (transitionRows ?? []).filter(
      (t: Record<string, unknown>) => t.agenda_item_id === currentItemId && !t.ended_at,
    );
    return transitions[transitions.length - 1] as Record<string, unknown> | undefined ?? null;
  }, [transitionRows, currentItemId]);

  // Build current item detail
  const currentItemDetail = useMemo(() => {
    if (!currentItemId) return null;
    const raw = allItems.find((i: Record<string, unknown>) => i.id === currentItemId);
    if (!raw) return null;

    const flatInfo = flatItems.find((i) => i.id === currentItemId);
    const letter = flatInfo ? String.fromCharCode(65 + flatInfo.itemIdx) : "";
    const sectionRef = flatInfo ? `${flatInfo.sectionIdx + 1}${letter}` : "";

    const itemMotions = (motionsByItem.get(currentItemId) ?? []).map((m: Record<string, unknown>) => ({
      id: m.id as string,
      motionText: (m.motion_text as string) ?? "",
      motionType: (m.motion_type as string) ?? "main",
      movedBy: (m.moved_by as string) ?? null,
      secondedBy: (m.seconded_by as string) ?? null,
      status: (m.status as string) ?? "pending",
      parentMotionId: (m.parent_motion_id as string) ?? null,
      voteSummary: (m.vote_summary as string) ?? null,
    }));

    const itemExhibits = (exhibitsByItem.get(currentItemId) ?? []).map((e: Record<string, unknown>) => ({
      id: e.id as string,
      title: (e.title as string) ?? "",
      fileName: (e.file_name as string) ?? "",
    }));

    const itemSpeakers = (speakersByItem.get(currentItemId) ?? []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      name: (s.name as string) ?? "",
      address: (s.address as string) ?? null,
      topic: (s.topic as string) ?? null,
      created_at: (s.created_at as string) ?? "",
    }));

    const subItems = allItems
      .filter((sub: Record<string, unknown>) => sub.parent_item_id === currentItemId)
      .map((sub: Record<string, unknown>) => ({
        id: sub.id as string,
        title: sub.title as string,
        sortOrder: sub.sort_order as number,
      }));

    // Find the section this item belongs to
    const parentId = raw.parent_item_id as string;
    const section = allItems.find((i: Record<string, unknown>) => i.id === parentId);

    return {
      id: currentItemId,
      title: (raw.title as string) ?? "",
      sectionTitle: (section?.title as string) ?? "",
      sectionType: (section?.section_type as string) ?? (raw.section_type as string) ?? "other",
      sectionRef,
      description: (raw.description as string) ?? null,
      presenter: (raw.presenter as string) ?? null,
      staffResource: (raw.staff_resource as string) ?? null,
      background: (raw.background as string) ?? null,
      recommendation: (raw.recommendation as string) ?? null,
      suggestedMotion: (raw.suggested_motion as string) ?? null,
      operatorNotes: (raw.operator_notes as string) ?? null,
      estimatedDuration: (raw.estimated_duration as number) ?? null,
      status: (raw.status as string) ?? "pending",
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
        (attendanceRows ?? []).some(
          (a: Record<string, unknown>) =>
            a.board_member_id === m.boardMemberId &&
            (a.status === "present" || a.status === "remote" || a.status === "late_arrival"),
        ),
      ),
    [members, attendanceRows],
  );

  // ─── Navigation ───────────────────────────────────────────────

  const navigateToItem = useCallback(
    async (itemId: string) => {
      const now = new Date().toISOString();

      // End current transition
      if (currentItemId && currentTransition) {
        await powerSync.execute(
          "UPDATE agenda_item_transitions SET ended_at = ? WHERE id = ?",
          [now, currentTransition.id as string],
        );
      }

      // Set current item to active
      await powerSync.execute(
        "UPDATE agenda_items SET status = 'active', updated_at = ? WHERE id = ?",
        [now, itemId],
      );

      // Update meeting's current item
      await powerSync.execute(
        "UPDATE meetings SET current_agenda_item_id = ?, updated_at = ? WHERE id = ?",
        [itemId, now, meetingId],
      );

      // Create new transition
      const transId = crypto.randomUUID();
      await powerSync.execute(
        `INSERT INTO agenda_item_transitions (id, meeting_id, agenda_item_id, town_id, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
        [transId, meetingId, itemId, townId, now],
      );
    },
    [currentItemId, currentTransition, meetingId, townId, powerSync],
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

  const readOnly = status === "adjourned" || status === "minutes_draft" || status === "approved";
  const meetingStartedAt = (meeting.started_at as string) ?? null;

  // ─── Noticed → Show start flow ─────────────────────────────

  if (status === "noticed") {
    return (
      <MeetingStartFlow
        meetingId={meetingId}
        townId={townId}
        boardId={boardId}
        members={members}
        attendance={(attendanceRows ?? []) as Array<{
          id: string;
          board_member_id: string | null;
          person_id: string;
          status: string;
          is_recording_secretary: number;
        }>}
        quorumRequired={quorum?.required ?? 0}
        quorumPresent={quorum?.present ?? 0}
        quorumTotal={quorum?.total ?? 0}
        hasQuorum={quorum?.hasQuorum ?? false}
        firstItemId={firstItemId}
      />
    );
  }

  // ─── Open / Adjourned → Three-panel layout ───────────────────

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{meeting.title as string}</h1>
          <Badge variant={status === "open" ? "default" : "secondary"}>
            {status === "open" ? "In Progress" : status}
          </Badge>
          {board && (
            <span className="text-sm text-muted-foreground">{board.name as string}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {meetingStartedAt && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <MeetingTimer startedAt={meetingStartedAt} />
            </div>
          )}
          {quorum && !quorum.hasQuorum && status === "open" && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="mr-1 h-3 w-3" />
              No Quorum
            </Badge>
          )}
          {!readOnly && (
            <AdjournButton meetingId={meetingId} currentItemId={currentItemId} currentTransitionId={(currentTransition?.id as string) ?? null} />
          )}
        </div>
      </div>

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
          />
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={PanelErrorFallback}>
          <AgendaItemDetailPanel
            item={currentItemDetail}
            meetingId={meetingId}
            townId={townId}
            allMembers={members}
            presentMembers={presentMembers}
            memberNameMap={memberNameMap}
            attendanceRecords={(attendanceRows ?? []) as Array<{
              id: string;
              board_member_id: string | null;
              person_id: string;
              status: string;
            }>}
            votesByMotion={votesByMotion as unknown as Map<string, Array<{
              id: string;
              motion_id: string;
              board_member_id: string;
              vote: string;
              recusal_reason: string | null;
            }>>}
            motionDisplayFormat={(board?.motion_display_format as string) ?? null}
            boardQuorumConfig={{
              quorumType: (board?.quorum_type as string) ?? null,
              quorumValue: (board?.quorum_value as number) ?? null,
              memberCount: (board?.member_count as number) ?? 0,
            }}
            onNavigatePrev={navigatePrev}
            onNavigateNext={navigateNext}
            hasPrev={currentFlatIdx > 0}
            hasNext={currentFlatIdx < flatItems.length - 1}
            readOnly={readOnly}
            externalRecusalMember={recusalMemberFromAttendance}
            onExternalRecusalConsumed={() => setRecusalMemberFromAttendance(null)}
          />
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={PanelErrorFallback}>
          <AttendancePanel
            meetingId={meetingId}
            townId={townId}
            members={members}
            attendance={(attendanceRows ?? []) as Array<{
              id: string;
              board_member_id: string | null;
              person_id: string;
              status: string;
              arrived_at: string | null;
              departed_at: string | null;
              is_recording_secretary: number;
            }>}
            presidingOfficerId={(meeting.presiding_officer_id as string) ?? null}
            recordingSecretaryId={(meeting.recording_secretary_id as string) ?? null}
            quorumRequired={quorum?.required ?? 0}
            quorumPresent={quorum?.present ?? 0}
            quorumTotal={quorum?.total ?? 0}
            hasQuorum={quorum?.hasQuorum ?? false}
            meetingStartedAt={meetingStartedAt}
            currentItemStartedAt={(currentTransition?.started_at as string) ?? null}
            currentItemEstimatedDuration={currentItemDetail?.estimatedDuration ?? null}
            readOnly={readOnly}
            onRecuse={(member) => setRecusalMemberFromAttendance(member)}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}

// ─── Adjourn Button ─────────────────────────────────────────────

function AdjournButton({
  meetingId,
  currentItemId,
  currentTransitionId,
}: {
  meetingId: string;
  currentItemId: string | null;
  currentTransitionId: string | null;
}) {
  const powerSync = usePowerSync();
  const [confirming, setConfirming] = useState(false);

  const handleAdjourn = async () => {
    const now = new Date().toISOString();

    if (currentTransitionId) {
      await powerSync.execute(
        "UPDATE agenda_item_transitions SET ended_at = ? WHERE id = ?",
        [now, currentTransitionId],
      );
    }

    await powerSync.execute(
      "UPDATE meetings SET status = 'adjourned', ended_at = ?, current_agenda_item_id = NULL, updated_at = ? WHERE id = ?",
      [now, now, meetingId],
    );
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Adjourn meeting?</span>
        <Button size="sm" variant="destructive" onClick={() => void handleAdjourn()}>
          Confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
      Adjourn Meeting
    </Button>
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
