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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { Clock, AlertTriangle } from "lucide-react";
import type { Route } from "./+types/meetings.$meetingId.live";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQuorumCheck } from "@/hooks/useQuorumCheck";
import { useSupabase } from "@/hooks/useSupabase";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { ConnectionStatusBar } from "@/components/ConnectionStatusBar";
import { queryKeys } from "@/lib/queryKeys";
import { supabase as supabaseSingleton } from "@/lib/supabase";
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
import { MotionCaptureDialog, type MotionDialogMode } from "@/components/meeting/MotionCaptureDialog";
import { hasPermission } from "@town-meeting/shared";
import { cn } from "@/lib/utils";

// ─── Route Loader ─────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const meetingId = params.meetingId!;

  // Prefetch meeting + board in one query
  const meetingData = await sharedQueryClient.ensureQueryData({
    queryKey: queryKeys.meetings.detail(meetingId),
    queryFn: async () => {
      const { data, error } = await supabaseSingleton
        .from("meeting")
        .select("*, board(*)")
        .eq("id", meetingId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const boardId = (meetingData as Record<string, unknown>)?.board_id as string ?? "";

  // Prefetch secondary data in parallel
  await Promise.all([
    sharedQueryClient.ensureQueryData({
      queryKey: queryKeys.agendaItems.byMeeting(meetingId),
      queryFn: async () => {
        const { data, error } = await supabaseSingleton
          .from("agenda_item")
          .select("*, exhibit(*)")
          .eq("meeting_id", meetingId)
          .order("sort_order");
        if (error) throw error;
        return data ?? [];
      },
    }),
    sharedQueryClient.ensureQueryData({
      queryKey: queryKeys.attendance.byMeeting(meetingId),
      queryFn: async () => {
        const { data, error } = await supabaseSingleton
          .from("meeting_attendance")
          .select("*")
          .eq("meeting_id", meetingId);
        if (error) throw error;
        return data ?? [];
      },
    }),
    sharedQueryClient.ensureQueryData({
      queryKey: queryKeys.motions.byMeeting(meetingId),
      queryFn: async () => {
        const { data, error } = await supabaseSingleton
          .from("motion")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("created_at");
        if (error) throw error;
        return data ?? [];
      },
    }),
    ...(boardId
      ? [
          sharedQueryClient.ensureQueryData({
            queryKey: queryKeys.members.byBoard(boardId),
            queryFn: async () => {
              const { data, error } = await supabaseSingleton
                .from("board_member")
                .select("*, person(*)")
                .eq("board_id", boardId)
                .eq("status", "active");
              if (error) throw error;
              return data ?? [];
            },
          }),
        ]
      : []),
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
  const canRunMeeting = currentUser
    ? hasPermission(
        currentUser.permissions,
        "M1",
        undefined,
        currentUser.role,
      )
    : false;

  // ─── Reactive queries ─────────────────────────────────────────

  // Meeting + Board (joined)
  const { data: meetingData } = useQuery({
    queryKey: queryKeys.meetings.detail(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting")
        .select("*, board(*)")
        .eq("id", meetingId)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
  });

  const meeting = meetingData as Record<string, unknown> | undefined;
  const board = (meetingData as Record<string, unknown> | undefined)?.board as Record<string, unknown> | undefined;
  const boardId = (meeting?.board_id as string) ?? "";
  const townId = (meeting?.town_id as string) ?? "";
  const status = (meeting?.status as string) ?? "";

  // Board members + persons (joined)
  const { data: memberRows = [] } = useQuery({
    queryKey: queryKeys.members.byBoard(boardId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("board_member")
        .select("*, person(*)")
        .eq("board_id", boardId)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!boardId,
  });

  // Attendance
  const { data: attendanceRows = [] } = useQuery({
    queryKey: queryKeys.attendance.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_attendance")
        .select("*")
        .eq("meeting_id", meetingId);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5_000,
  });

  // Agenda items + exhibits (joined)
  const { data: itemRows = [] } = useQuery({
    queryKey: queryKeys.agendaItems.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_item")
        .select("*, exhibit(*)")
        .eq("meeting_id", meetingId)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5_000,
  });

  // Motions
  const { data: motionRows = [] } = useQuery({
    queryKey: queryKeys.motions.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("motion")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5_000,
  });

  // Vote records
  const { data: voteRecordRows = [] } = useQuery({
    queryKey: queryKeys.voteRecords.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vote_record")
        .select("*")
        .eq("meeting_id", meetingId);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5_000,
  });

  // Guest speakers
  const { data: speakerRows = [] } = useQuery({
    queryKey: queryKeys.guestSpeakers.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guest_speaker")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5_000,
  });

  // Agenda item transitions
  const { data: transitionRows = [] } = useQuery({
    queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_item_transition")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("started_at");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5_000,
  });

  // Executive sessions
  const { data: execSessionRows = [] } = useQuery({
    queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("executive_session")
        .select("*")
        .eq("meeting_id", meetingId);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5_000,
  });

  const { quorum } = useQuorumCheck(meetingId, boardId);

  // ─── Realtime subscriptions ────────────────────────────────────

  useRealtimeSubscription(
    `live-${meetingId}-meeting`,
    "meeting",
    `id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
    },
  );

  useRealtimeSubscription(
    `live-${meetingId}-attendance`,
    "meeting_attendance",
    `meeting_id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.byMeeting(meetingId) });
    },
  );

  useRealtimeSubscription(
    `live-${meetingId}-agenda`,
    "agenda_item",
    `meeting_id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
    },
  );

  useRealtimeSubscription(
    `live-${meetingId}-motions`,
    "motion",
    `meeting_id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
    },
  );

  useRealtimeSubscription(
    `live-${meetingId}-votes`,
    "vote_record",
    `meeting_id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.voteRecords.byMeeting(meetingId) });
    },
  );

  useRealtimeSubscription(
    `live-${meetingId}-speakers`,
    "guest_speaker",
    `meeting_id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestSpeakers.byMeeting(meetingId) });
    },
  );

  useRealtimeSubscription(
    `live-${meetingId}-transitions`,
    "agenda_item_transition",
    `meeting_id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId) });
    },
  );

  useRealtimeSubscription(
    `live-${meetingId}-exec`,
    "executive_session",
    `meeting_id=eq.${meetingId}`,
    () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.executiveSessions.byMeeting(meetingId) });
    },
  );

  // ─── Data merging ─────────────────────────────────────────────

  const members = useMemo(
    () =>
      (memberRows as Array<Record<string, unknown>>).map((m) => {
        const person = m.person as Record<string, unknown> | null;
        return {
          boardMemberId: String(m.id),
          personId: String(m.person_id),
          name: (person?.name as string) ?? "Unknown",
          seatTitle: (m.seat_title as string) ?? null,
          isDefaultRecSec: !!m.is_default_rec_sec,
        };
      }),
    [memberRows],
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.boardMemberId, m.name));
    return map;
  }, [members]);

  const motionsByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (motionRows as Array<Record<string, unknown>>).forEach((m) => {
      const itemId = m.agenda_item_id as string;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(m);
    });
    return map;
  }, [motionRows]);

  const votesByMotion = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (voteRecordRows as Array<Record<string, unknown>>).forEach((v) => {
      const mId = v.motion_id as string;
      if (!map.has(mId)) map.set(mId, []);
      map.get(mId)!.push(v);
    });
    return map;
  }, [voteRecordRows]);

  // Exhibits are embedded in itemRows via select('*, exhibit(*)')
  const exhibitsByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (itemRows as Array<Record<string, unknown>>).forEach((item) => {
      const exhibits = item.exhibit;
      const arr = Array.isArray(exhibits) ? exhibits : exhibits ? [exhibits] : [];
      if (arr.length > 0) {
        map.set(String(item.id), arr as Array<Record<string, unknown>>);
      }
    });
    return map;
  }, [itemRows]);

  const speakersByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (speakerRows as Array<Record<string, unknown>>).forEach((s) => {
      const itemId = s.agenda_item_id as string;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(s);
    });
    return map;
  }, [speakerRows]);

  // Build sections → items tree
  const allItems = useMemo(
    () => itemRows as Array<Record<string, unknown>>,
    [itemRows],
  );

  const sections = useMemo(() => {
    const parents = allItems.filter((item) => !item.parent_item_id);
    return parents.map((section, sIdx) => {
      const children = allItems
        .filter((item) => item.parent_item_id === section.id)
        .map((item, _iIdx) => {
          const subItems = allItems
            .filter((sub) => sub.parent_item_id === item.id)
            .map((sub) => ({
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

  const currentItemId = (meeting?.current_agenda_item_id as string) ?? null;
  const currentFlatIdx = flatItems.findIndex((i) => i.id === currentItemId);
  const firstItemId = flatItems[0]?.id ?? null;

  // Current item's transition for per-item timer
  const currentTransition = useMemo(() => {
    if (!currentItemId) return null;
    const transitions = (transitionRows as Array<Record<string, unknown>>).filter(
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
      id: m.id as string,
      motionText: (m.motion_text as string) ?? "",
      motionType: (m.motion_type as string) ?? "main",
      movedBy: (m.moved_by as string) ?? null,
      secondedBy: (m.seconded_by as string) ?? null,
      status: (m.status as string) ?? "pending",
      parentMotionId: (m.parent_motion_id as string) ?? null,
      voteSummary: m.vote_summary ?? null,
    }));

    const itemExhibits = (exhibitsByItem.get(currentItemId) ?? []).map((e) => ({
      id: e.id as string,
      title: (e.title as string) ?? "",
      fileName: (e.file_name as string) ?? "",
    }));

    const itemSpeakers = (speakersByItem.get(currentItemId) ?? []).map((s) => ({
      id: s.id as string,
      name: (s.name as string) ?? "",
      address: (s.address as string) ?? null,
      topic: (s.topic as string) ?? null,
      created_at: (s.created_at as string) ?? "",
    }));

    const subItems = allItems
      .filter((sub) => sub.parent_item_id === currentItemId)
      .map((sub) => ({
        id: sub.id as string,
        title: sub.title as string,
        sortOrder: sub.sort_order as number,
      }));

    // Find the section this item belongs to
    const parentId = raw.parent_item_id as string;
    const section = allItems.find((i) => i.id === parentId);

    return {
      id: currentItemId,
      title: (raw.title as string) ?? "",
      sectionTitle: (section?.title as string) ?? "",
      sectionType:
        (section?.section_type as string) ??
        (raw.section_type as string) ??
        "other",
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
  }, [
    currentItemId,
    allItems,
    flatItems,
    motionsByItem,
    exhibitsByItem,
    speakersByItem,
  ]);

  // Present members for motion forms
  const presentMembers = useMemo(
    () =>
      members.filter((m) =>
        (attendanceRows as Array<Record<string, unknown>>).some(
          (a) =>
            a.board_member_id === m.boardMemberId &&
            (a.status === "present" ||
              a.status === "remote" ||
              a.status === "late_arrival"),
        ),
      ),
    [members, attendanceRows],
  );

  // ─── Executive session detection ────────────────────────────────

  const activeExecSession = useMemo(() => {
    const rows = execSessionRows as Array<Record<string, unknown>>;
    return rows.find((es) => es.entered_at && !es.exited_at) ?? null;
  }, [execSessionRows]);

  const isInExecSession = !!activeExecSession;

  const pendingExecSession = useMemo(() => {
    const rows = execSessionRows as Array<Record<string, unknown>>;
    return (
      rows.find((es) => es.entry_motion_id && !es.entered_at && !es.exited_at) ?? null
    );
  }, [execSessionRows]);

  // Reactive: when entry motion for exec session passes → set entered_at
  // When entry motion fails → delete the pending exec session record
  useEffect(() => {
    if (!pendingExecSession || !motionRows.length) return;
    const entryMotionId = pendingExecSession.entry_motion_id as string;
    const entryMotion = (motionRows as Array<Record<string, unknown>>).find(
      (m) => m.id === entryMotionId,
    );
    if (!entryMotion) return;

    const motionStatus = entryMotion.status as string;
    const esId = pendingExecSession.id as string;

    if (processedMotionIds.current.has(entryMotionId)) return;

    if (motionStatus === "passed") {
      processedMotionIds.current.add(entryMotionId);
      const now = new Date().toISOString();
      void (async () => {
        await supabase
          .from("executive_session")
          .update({ entered_at: now })
          .eq("id", esId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
        });
      })();
    } else if (motionStatus === "failed") {
      processedMotionIds.current.add(entryMotionId);
      void (async () => {
        await supabase.from("executive_session").delete().eq("id", esId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
        });
      })();
    }
  }, [pendingExecSession, motionRows, supabase, queryClient, meetingId]);

  // Reactive: when adjourn motion passes → trigger meeting end
  useEffect(() => {
    if (!motionRows.length || status !== "open") return;
    const adjournMotion = (motionRows as Array<Record<string, unknown>>).find(
      (m) => m.motion_type === "adjourn" && m.status === "passed",
    );
    if (!adjournMotion) return;
    const motionId = adjournMotion.id as string;
    if (processedMotionIds.current.has(`adjourn_${motionId}`)) return;
    processedMotionIds.current.add(`adjourn_${motionId}`);
    void handleMeetingEnd("motion", motionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionRows, status]);

  // Reactive: when a minutes-approval motion passes → auto-approve minutes
  useEffect(() => {
    if (!motionRows.length || !itemRows.length) return;
    const items = itemRows as Array<Record<string, unknown>>;
    const motions = motionRows as Array<Record<string, unknown>>;

    const approvalItems = items.filter((item) => item.source_minutes_document_id);
    if (approvalItems.length === 0) return;

    for (const item of approvalItems) {
      const itemMotions = motions.filter(
        (m) => m.agenda_item_id === item.id && m.status === "passed",
      );

      for (const motion of itemMotions) {
        const key = `minutes_approve_${motion.id as string}`;
        if (processedMotionIds.current.has(key)) continue;
        processedMotionIds.current.add(key);

        const docId = item.source_minutes_document_id as string;
        const now = new Date().toISOString();
        const motionText = String(motion.motion_text ?? "").toLowerCase();
        const asAmended =
          motionText.includes("as amended") ||
          motionText.includes("with corrections");

        void (async () => {
          // Update minutes_document status to approved
          await supabase
            .from("minutes_document")
            .update({
              status: "approved",
              approved_at: now,
              approved_by_motion_id: motion.id as string,
              approved_as_amended: asAmended,
              updated_at: now,
            })
            .eq("id", docId);

          void queryClient.invalidateQueries({
            queryKey: queryKeys.minutesDocuments.byMeeting(meetingId),
          });

          // Fire notification event (fire-and-forget)
          await supabase.from("notification_event").insert({
            id: crypto.randomUUID(),
            town_id: townId,
            event_type: "minutes_approved",
            payload: {
              minutes_document_id: docId,
              meeting_id: meetingId,
              approved_by_motion_id: motion.id as string,
            },
            status: "pending",
            created_at: now,
          });

          // Fire API call to regenerate PDF without DRAFT watermark (fire-and-forget)
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const accessToken = sessionData?.session?.access_token;
            if (accessToken) {
              const apiBase =
                import.meta.env.VITE_API_URL ?? "http://localhost:3001";
              await fetch(
                `${apiBase}/api/meetings/${meetingId}/minutes/render`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`,
                  },
                  body: JSON.stringify({ is_draft: false }),
                },
              );
            }
          } catch {
            // Fire-and-forget — PDF regeneration failure is non-critical
          }
        })();
      }
    }
  }, [motionRows, itemRows, supabase, queryClient, townId, meetingId]);

  // Track post-session action motions: any motion created after returning
  // from exec session gets linked to the exec session record
  useEffect(() => {
    if (!isPostExecSession || !postExecSessionId || !motionRows.length) return;
    const execSession = (execSessionRows as Array<Record<string, unknown>>).find(
      (es) => es.id === postExecSessionId,
    );
    if (!execSession) return;

    // post_session_action_motion_ids is JSONB (native array) in Supabase
    const existingIds: string[] = Array.isArray(
      execSession.post_session_action_motion_ids,
    )
      ? (execSession.post_session_action_motion_ids as string[])
      : [];

    const exitedAt = execSession.exited_at as string;
    if (!exitedAt) return;

    const postMotions = (motionRows as Array<Record<string, unknown>>).filter(
      (m) =>
        (m.created_at as string) > exitedAt &&
        !existingIds.includes(m.id as string),
    );

    if (postMotions.length > 0) {
      const newIds = [...existingIds, ...postMotions.map((m) => m.id as string)];
      void (async () => {
        await supabase
          .from("executive_session")
          .update({ post_session_action_motion_ids: newIds })
          .eq("id", postExecSessionId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
        });
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
  const execSessionItemId = useMemo(() => {
    if (!activeExecSession) return null;
    return (activeExecSession.agenda_item_id as string) ?? null;
  }, [activeExecSession]);

  // Presiding officer name for adjournment controls
  const presidingOfficerName = useMemo(() => {
    const presidingId = (meeting?.presiding_officer_id as string) ?? null;
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
          .eq("id", (currentTransition as Record<string, unknown>).id as string);
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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agendaItems.byMeeting(meetingId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId),
      });
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
    const entryMotion = [...itemMotions].reverse().find(
      (m: Record<string, unknown>) =>
        (m.motion_text as string)?.includes("Executive Session"),
    );

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
      entry_motion_id: entryMotion.id as string,
      post_session_action_motion_ids: [],
      created_at: now,
    });

    void queryClient.invalidateQueries({
      queryKey: queryKeys.executiveSessions.byMeeting(meetingId),
    });

    setPendingExecCitation(null);
  }, [
    pendingExecCitation,
    currentItemId,
    motionsByItem,
    meetingId,
    townId,
    supabase,
    queryClient,
  ]);

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
      setPostExecSessionId(activeExecSession.id as string);
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
          .eq("id", (currentTransition as Record<string, unknown>).id as string);
      }

      // 2. Mark pending/active items as "deferred" and create future_item_queue entries
      const unreachedItems = allItems.filter((item) => {
        const itemStatus = item.status as string;
        return (
          item.parent_item_id &&
          (itemStatus === "pending" || itemStatus === "active") &&
          item.id !== currentItemId
        );
      });

      for (const item of unreachedItems) {
        await supabase
          .from("agenda_item")
          .update({ status: "deferred", updated_at: now })
          .eq("id", item.id as string);

        await supabase.from("future_item_queue").insert({
          id: crypto.randomUUID(),
          board_id: boardId,
          town_id: townId,
          source_meeting_id: meetingId,
          source_agenda_item_id: item.id as string,
          title: item.title as string,
          description: (item.description as string) ?? null,
          source: "deferred",
          status: "pending",
          created_at: now,
        });
      }

      // 3. Also add tabled items to future queue
      const tabledItems = allItems.filter((item) => {
        if (!item.parent_item_id) return false;
        const itemMotions = motionsByItem.get(item.id as string) ?? [];
        return itemMotions.some(
          (m: Record<string, unknown>) =>
            m.motion_type === "table" && m.status === "passed",
        );
      });

      for (const item of tabledItems) {
        await supabase.from("future_item_queue").insert({
          id: crypto.randomUUID(),
          board_id: boardId,
          town_id: townId,
          source_meeting_id: meetingId,
          source_agenda_item_id: item.id as string,
          title: item.title as string,
          description: (item.description as string) ?? null,
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

  if (
    status === "adjourned" ||
    status === "minutes_draft" ||
    status === "approved"
  ) {
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
            You need the "Start/Run Meeting" permission to access the live
            meeting interface.
          </p>
        </div>
      </div>
    );
  }

  const readOnly = false;
  const meetingStartedAt = (meeting.started_at as string) ?? null;

  // ─── Noticed → Show start flow ─────────────────────────────

  if (status === "noticed") {
    return (
      <MeetingStartFlow
        meetingId={meetingId}
        townId={townId}
        boardId={boardId}
        members={members}
        attendance={
          (attendanceRows as Array<{
            id: string;
            board_member_id: string | null;
            person_id: string;
            status: string;
            is_recording_secretary: boolean;
          }>) ?? []
        }
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
      {/* Connection status banner (prominent in live meeting context) */}
      <ConnectionStatusBar prominent={true} />

      {/* Header bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{meeting.title as string}</h1>
          <Badge variant="default">In Progress</Badge>
          {board && (
            <span className="text-sm text-muted-foreground">
              {board.name as string}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {meetingStartedAt && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <MeetingTimer startedAt={meetingStartedAt} />
            </div>
          )}
          {quorum && !quorum.hasQuorum && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="mr-1 h-3 w-3" />
              No Quorum
            </Badge>
          )}
          {isPostExecSession && (
            <Badge
              variant="outline"
              className="border-amber-300 text-amber-700 text-xs"
            >
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
          citation={(activeExecSession.statutory_basis as string) ?? ""}
          enteredAt={(activeExecSession.entered_at as string) ?? ""}
          onReturnToPublic={handleReturnToPublic}
        />
      )}

      {/* Post-exec session action bar */}
      {isPostExecSession && !isInExecSession && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-6 py-2 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Recording post-executive-session actions. File any motions resulting
            from executive session discussion.
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
            townId={townId}
            allMembers={members}
            presentMembers={presentMembers}
            memberNameMap={memberNameMap}
            attendanceRecords={
              (attendanceRows as Array<{
                id: string;
                board_member_id: string | null;
                person_id: string;
                status: string;
              }>) ?? []
            }
            votesByMotion={
              votesByMotion as unknown as Map<
                string,
                Array<{
                  id: string;
                  motion_id: string;
                  board_member_id: string;
                  vote: string;
                  recusal_reason: string | null;
                }>
              >
            }
            motionDisplayFormat={
              (board?.motion_display_format as string) ?? null
            }
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
            isInExecSession={isInExecSession}
            onEnterExecSession={() => setExecSessionDialogOpen(true)}
          />
        </ErrorBoundary>

        <ErrorBoundary FallbackComponent={PanelErrorFallback}>
          <AttendancePanel
            meetingId={meetingId}
            townId={townId}
            members={members}
            attendance={
              (attendanceRows as Array<{
                id: string;
                board_member_id: string | null;
                person_id: string;
                status: string;
                arrived_at: string | null;
                departed_at: string | null;
                is_recording_secretary: boolean;
              }>) ?? []
            }
            presidingOfficerId={
              (meeting.presiding_officer_id as string) ?? null
            }
            recordingSecretaryId={
              (meeting.recording_secretary_id as string) ?? null
            }
            quorumRequired={quorum?.required ?? 0}
            quorumPresent={quorum?.present ?? 0}
            quorumTotal={quorum?.total ?? 0}
            hasQuorum={quorum?.hasQuorum ?? false}
            meetingStartedAt={meetingStartedAt}
            currentItemStartedAt={
              (currentTransition as Record<string, unknown> | null)
                ?.started_at as string ?? null
            }
            currentItemEstimatedDuration={
              currentItemDetail?.estimatedDuration ?? null
            }
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
          execSessionId={activeExecSession.id as string}
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
