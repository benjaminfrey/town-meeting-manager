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
 */

import { useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@powersync/react";
import {
  Clock,
  Calendar,
  MapPin,
  Users,
  Gavel,
  Lock,
  Download,
  ArrowLeft,
  CheckCircle2,
  PauseCircle,
  ArrowRightCircle,
  Circle,
  ShieldOff,
} from "lucide-react";
import type { Route } from "./+types/meetings.$meetingId.review";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FutureItemsQueue } from "@/components/meeting/FutureItemsQueue";
import {
  buildStructuredMeetingRecord,
  downloadMeetingRecord,
  type StructuredMeetingRecordInput,
} from "@/lib/meeting/buildStructuredMeetingRecord";

// ─── Route Loader ─────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { meetingId: params.meetingId };
}

// ─── Component ────────────────────────────────────────────────────

export default function PostMeetingReviewPage({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const navigate = useNavigate();

  // ─── Reactive queries ───────────────────────────────────────────
  const { data: meetingRows } = useQuery(
    "SELECT * FROM meetings WHERE id = ? LIMIT 1",
    [meetingId],
  );
  const meeting = meetingRows?.[0] as Record<string, unknown> | undefined;
  const boardId = (meeting?.board_id as string) ?? "";
  const townId = (meeting?.town_id as string) ?? "";

  const { data: boardRows } = useQuery(
    "SELECT * FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );
  const board = boardRows?.[0] as Record<string, unknown> | undefined;

  const { data: townRows } = useQuery(
    "SELECT * FROM towns WHERE id = ? LIMIT 1",
    [townId],
  );
  const town = townRows?.[0] as Record<string, unknown> | undefined;

  const { data: memberRows } = useQuery(
    "SELECT * FROM board_members WHERE board_id = ?",
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

  const { data: execSessionRows } = useQuery(
    "SELECT * FROM executive_sessions WHERE meeting_id = ?",
    [meetingId],
  );

  const { data: transitionRows } = useQuery(
    "SELECT * FROM agenda_item_transitions WHERE meeting_id = ? ORDER BY started_at ASC",
    [meetingId],
  );

  const { data: speakerRows } = useQuery(
    "SELECT * FROM guest_speakers WHERE meeting_id = ? ORDER BY created_at ASC",
    [meetingId],
  );

  const { data: exhibitRows } = useQuery(
    "SELECT * FROM exhibits WHERE town_id = ?",
    [townId],
  );

  const { data: futureItemRows } = useQuery(
    "SELECT * FROM future_item_queues WHERE source_meeting_id = ?",
    [meetingId],
  );

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
        };
      }),
    [memberRows, personMap],
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((m) => map.set(m.boardMemberId, m.name));
    return map;
  }, [members]);

  const allItems = useMemo(() => itemRows ?? [], [itemRows]);

  // Build sections with child items
  const sections = useMemo(() => {
    const parents = allItems.filter(
      (item: Record<string, unknown>) => !item.parent_item_id,
    );
    return parents.map((section: Record<string, unknown>) => {
      const children = allItems
        .filter((item: Record<string, unknown>) => item.parent_item_id === section.id)
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          (a.sort_order as number) - (b.sort_order as number),
        );
      return { section, children };
    });
  }, [allItems]);

  const motions = useMemo(() => motionRows ?? [], [motionRows]);
  const voteRecords = useMemo(() => voteRecordRows ?? [], [voteRecordRows]);
  const execSessions = useMemo(() => execSessionRows ?? [], [execSessionRows]);
  const transitions = useMemo(() => transitionRows ?? [], [transitionRows]);

  // Motions by item for display
  const motionsByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (motions as Array<Record<string, unknown>>).forEach((m) => {
      const itemId = m.agenda_item_id as string;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(m);
    });
    return map;
  }, [motions]);

  // Votes by motion
  const votesByMotion = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (voteRecords as Array<Record<string, unknown>>).forEach((v) => {
      const mId = v.motion_id as string;
      if (!map.has(mId)) map.set(mId, []);
      map.get(mId)!.push(v);
    });
    return map;
  }, [voteRecords]);

  // Transitions by item (for time tracking)
  const transitionsByItem = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    (transitions as Array<Record<string, unknown>>).forEach((t) => {
      const itemId = t.agenda_item_id as string;
      if (!map.has(itemId)) map.set(itemId, []);
      map.get(itemId)!.push(t);
    });
    return map;
  }, [transitions]);

  // Presiding officer and recording secretary names
  const presidingOfficerName = useMemo(() => {
    const id = (meeting?.presiding_officer_id as string) ?? null;
    return id ? memberNameMap.get(id) ?? null : null;
  }, [meeting, memberNameMap]);

  const recordingSecretaryName = useMemo(() => {
    const id = (meeting?.recording_secretary_id as string) ?? null;
    return id ? memberNameMap.get(id) ?? null : null;
  }, [meeting, memberNameMap]);

  // Adjournment data
  const adjournment = useMemo(() => {
    if (!meeting?.adjournment) return null;
    try {
      return JSON.parse(meeting.adjournment as string) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [meeting]);

  // Duration
  const duration = useMemo(() => {
    if (!meeting?.started_at || !meeting?.ended_at) return null;
    const start = new Date(meeting.started_at as string);
    const end = new Date(meeting.ended_at as string);
    const mins = Math.round((end.getTime() - start.getTime()) / 60000);
    const hours = Math.floor(mins / 60);
    const remaining = mins % 60;
    return hours > 0 ? `${hours}h ${remaining}m` : `${remaining}m`;
  }, [meeting]);

  // All recusals across the meeting
  const recusals = useMemo(() => {
    return (voteRecords as Array<Record<string, unknown>>)
      .filter((v) => v.vote === "recusal")
      .map((v) => {
        const motion = (motions as Array<Record<string, unknown>>).find(
          (m) => m.id === v.motion_id,
        );
        const itemId = motion?.agenda_item_id as string;
        const item = allItems.find((i: Record<string, unknown>) => i.id === itemId);
        return {
          member: memberNameMap.get(v.board_member_id as string) ?? "Unknown",
          item: (item?.title as string) ?? "Unknown item",
          reason: (v.recusal_reason as string) ?? "Not specified",
        };
      });
  }, [voteRecords, motions, allItems, memberNameMap]);

  // Future items queue
  const futureItems = useMemo(
    () =>
      (futureItemRows ?? []).map((fi: Record<string, unknown>) => ({
        id: fi.id as string,
        title: (fi.title as string) ?? "",
        description: (fi.description as string) ?? null,
        source: (fi.source as string) ?? "deferred",
        status: (fi.status as string) ?? "pending",
      })),
    [futureItemRows],
  );

  // ─── Export handler ────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (!meeting || !board || !town) return;

    const input: StructuredMeetingRecordInput = {
      meeting: {
        id: meeting.id as string,
        title: (meeting.title as string) ?? "",
        scheduled_date: (meeting.scheduled_date as string) ?? "",
        scheduled_time: (meeting.scheduled_time as string) ?? null,
        location: (meeting.location as string) ?? null,
        meeting_type: (meeting.meeting_type as string) ?? "regular",
        started_at: (meeting.started_at as string) ?? null,
        ended_at: (meeting.ended_at as string) ?? null,
        adjournment: (meeting.adjournment as string) ?? null,
      },
      board: {
        id: board.id as string,
        name: (board.name as string) ?? "",
        board_type: (board.board_type as string) ?? "",
        motion_display_format: (board.motion_display_format as string) ?? null,
      },
      town: {
        name: (town.name as string) ?? "",
        meeting_formality: (town.meeting_formality as string) ?? null,
        minutes_style: (town.minutes_style as string) ?? null,
      },
      presidingOfficerName,
      recordingSecretaryName,
      members,
      attendance: (attendanceRows ?? []).map((a: Record<string, unknown>) => ({
        board_member_id: (a.board_member_id as string) ?? null,
        person_id: (a.person_id as string) ?? "",
        status: (a.status as string) ?? "absent",
        arrived_at: (a.arrived_at as string) ?? null,
        departed_at: (a.departed_at as string) ?? null,
        is_recording_secretary: (a.is_recording_secretary as number) ?? 0,
      })),
      agendaItems: allItems.map((i: Record<string, unknown>) => ({
        id: i.id as string,
        meeting_id: meetingId,
        section_type: (i.section_type as string) ?? null,
        sort_order: (i.sort_order as number) ?? 0,
        title: (i.title as string) ?? "",
        description: (i.description as string) ?? null,
        presenter: (i.presenter as string) ?? null,
        estimated_duration: (i.estimated_duration as number) ?? null,
        parent_item_id: (i.parent_item_id as string) ?? null,
        status: (i.status as string) ?? "pending",
        staff_resource: (i.staff_resource as string) ?? null,
        background: (i.background as string) ?? null,
        recommendation: (i.recommendation as string) ?? null,
        suggested_motion: (i.suggested_motion as string) ?? null,
        operator_notes: (i.operator_notes as string) ?? null,
      })),
      motions: (motions as Array<Record<string, unknown>>).map((m) => ({
        id: m.id as string,
        agenda_item_id: (m.agenda_item_id as string) ?? "",
        motion_text: (m.motion_text as string) ?? "",
        motion_type: (m.motion_type as string) ?? "main",
        moved_by: (m.moved_by as string) ?? null,
        seconded_by: (m.seconded_by as string) ?? null,
        status: (m.status as string) ?? "pending",
        parent_motion_id: (m.parent_motion_id as string) ?? null,
        vote_summary: (m.vote_summary as string) ?? null,
      })),
      voteRecords: (voteRecords as Array<Record<string, unknown>>).map((v) => ({
        id: v.id as string,
        motion_id: (v.motion_id as string) ?? "",
        board_member_id: (v.board_member_id as string) ?? "",
        vote: (v.vote as string) ?? "",
        recusal_reason: (v.recusal_reason as string) ?? null,
      })),
      executiveSessions: (execSessions as Array<Record<string, unknown>>).map((es) => ({
        id: es.id as string,
        agenda_item_id: (es.agenda_item_id as string) ?? null,
        statutory_basis: (es.statutory_basis as string) ?? "",
        entered_at: (es.entered_at as string) ?? null,
        exited_at: (es.exited_at as string) ?? null,
        entry_motion_id: (es.entry_motion_id as string) ?? null,
        post_session_action_motion_ids: (es.post_session_action_motion_ids as string) ?? null,
      })),
      transitions: (transitions as Array<Record<string, unknown>>).map((t) => ({
        agenda_item_id: (t.agenda_item_id as string) ?? "",
        started_at: (t.started_at as string) ?? "",
        ended_at: (t.ended_at as string) ?? null,
      })),
      exhibits: (exhibitRows ?? []).map((e: Record<string, unknown>) => ({
        id: e.id as string,
        agenda_item_id: (e.agenda_item_id as string) ?? "",
        title: (e.title as string) ?? "",
        file_name: (e.file_name as string) ?? "",
      })),
      speakers: (speakerRows ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        agenda_item_id: (s.agenda_item_id as string) ?? "",
        name: (s.name as string) ?? "",
        topic: (s.topic as string) ?? null,
      })),
    };

    const record = buildStructuredMeetingRecord(input);
    downloadMeetingRecord(
      record,
      (board.name as string) ?? "meeting",
      (meeting.scheduled_date as string) ?? "unknown-date",
    );
  }, [
    meeting, board, town, presidingOfficerName, recordingSecretaryName,
    members, attendanceRows, allItems, motions, voteRecords,
    execSessions, transitions, exhibitRows, speakerRows, meetingId,
  ]);

  // ─── Loading / error states ────────────────────────────────────

  if (!meeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading meeting data...</p>
      </div>
    );
  }

  const boardName = (board?.name as string) ?? "";
  const meetingDate = (meeting.scheduled_date as string) ?? "";

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
        <h1 className="mt-3 text-2xl font-bold">{meeting.title as string}</h1>
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
              {meeting.location as string}
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
              <span className="text-muted-foreground">Presiding:</span>{" "}
              {presidingOfficerName}
            </span>
          )}
          {recordingSecretaryName && (
            <span>
              <span className="text-muted-foreground">Secretary:</span>{" "}
              {recordingSecretaryName}
            </span>
          )}
          {adjournment && (
            <Badge variant="secondary" className="text-xs">
              Adjourned{" "}
              {adjournment.method === "motion"
                ? "by motion"
                : "without objection"}
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
                const att = (attendanceRows ?? []).find(
                  (a: Record<string, unknown>) => a.board_member_id === m.boardMemberId,
                ) as Record<string, unknown> | undefined;
                const status = (att?.status as string) ?? "absent";
                const isRecSec = (att?.is_recording_secretary as number) === 1;
                const isPresiding = (meeting?.presiding_officer_id as string) === m.boardMemberId;

                return (
                  <tr key={m.boardMemberId} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{m.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {m.seatTitle ?? "—"}
                    </td>
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
            <div key={section.id as string}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {sIdx + 1}. {section.title as string}
              </h3>
              {children.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No items in this section.
                </p>
              ) : (
                <div className="space-y-1">
                  {children.map((item: Record<string, unknown>, iIdx: number) => {
                    const itemId = item.id as string;
                    const itemStatus = (item.status as string) ?? "pending";
                    const itemTransitions = transitionsByItem.get(itemId) ?? [];
                    const timeSpent = computeTimeSpent(itemTransitions);
                    const letter = String.fromCharCode(65 + iIdx);
                    const itemMotions = motionsByItem.get(itemId) ?? [];

                    return (
                      <div
                        key={itemId}
                        className="flex items-center gap-3 rounded-md border px-4 py-2"
                      >
                        <ItemStatusIcon status={itemStatus} />
                        <span className="min-w-0 flex-1 text-sm">
                          {letter}. {item.title as string}
                        </span>
                        {timeSpent && (
                          <span className="text-xs text-muted-foreground">
                            {timeSpent}
                          </span>
                        )}
                        {itemMotions.length > 0 && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Gavel className="h-3 w-3" />
                            {itemMotions.length}
                          </Badge>
                        )}
                        <Badge
                          variant={
                            itemStatus === "completed"
                              ? "default"
                              : itemStatus === "tabled"
                                ? "secondary"
                                : itemStatus === "deferred"
                                  ? "outline"
                                  : "secondary"
                          }
                          className="text-xs"
                        >
                          {itemStatus}
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
        {(motions as Array<Record<string, unknown>>).length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No motions were recorded during this meeting.
          </p>
        ) : (
          <div className="space-y-4">
            {sections.map(({ section, children }) =>
              children
                .filter((item: Record<string, unknown>) =>
                  motionsByItem.has(item.id as string),
                )
                .map((item: Record<string, unknown>) => {
                  const itemMotions = motionsByItem.get(item.id as string) ?? [];
                  return (
                    <div key={item.id as string}>
                      <h4 className="mb-2 text-sm font-medium">
                        {item.title as string}
                      </h4>
                      <div className="space-y-2 pl-4">
                        {itemMotions.map((m: Record<string, unknown>) => {
                          const mId = m.id as string;
                          const votes = votesByMotion.get(mId) ?? [];
                          let summary: Record<string, unknown> | null = null;
                          try {
                            summary = m.vote_summary
                              ? (JSON.parse(m.vote_summary as string) as Record<string, unknown>)
                              : null;
                          } catch { /* ignore */ }

                          return (
                            <div
                              key={mId}
                              className="rounded-md border px-4 py-3"
                            >
                              <div className="flex items-start gap-2">
                                <Gavel className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm">
                                    {m.motion_text as string}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    {m.moved_by && (
                                      <span>
                                        Moved:{" "}
                                        {memberNameMap.get(m.moved_by as string) ??
                                          (m.moved_by as string)}
                                      </span>
                                    )}
                                    {m.seconded_by && (
                                      <span>
                                        Seconded:{" "}
                                        {memberNameMap.get(
                                          m.seconded_by as string,
                                        ) ?? (m.seconded_by as string)}
                                      </span>
                                    )}
                                    {m.motion_type &&
                                      m.motion_type !== "main" && (
                                        <Badge variant="outline" className="text-xs">
                                          {(m.motion_type as string).replace(/_/g, " ")}
                                        </Badge>
                                      )}
                                  </div>
                                  {summary && (
                                    <div className="mt-2 text-xs">
                                      <span className="font-medium">
                                        Result:{" "}
                                      </span>
                                      <Badge
                                        variant={
                                          (m.status as string) === "passed"
                                            ? "default"
                                            : "secondary"
                                        }
                                        className="text-xs"
                                      >
                                        {(m.status as string) ?? "pending"}
                                      </Badge>
                                      <span className="ml-2">
                                        Yeas: {(summary.yeas as number) ?? 0},
                                        Nays: {(summary.nays as number) ?? 0},
                                        Abstentions:{" "}
                                        {(summary.abstentions as number) ?? 0}
                                      </span>
                                    </div>
                                  )}
                                  {votes.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {votes.map(
                                        (v: Record<string, unknown>) => (
                                          <span
                                            key={v.id as string}
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
                                            {memberNameMap.get(
                                              v.board_member_id as string,
                                            ) ?? "?"}
                                            : {v.vote as string}
                                          </span>
                                        ),
                                      )}
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
      {(execSessions as Array<Record<string, unknown>>).length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Executive Sessions</h2>
          <div className="space-y-3">
            {(execSessions as Array<Record<string, unknown>>).map(
              (es) => (
                <div
                  key={es.id as string}
                  className="rounded-md border border-red-200 bg-red-50/50 px-4 py-3 dark:border-red-900 dark:bg-red-950/20"
                >
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium">
                      {es.statutory_basis as string}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                    {es.entered_at && (
                      <span>
                        Entered:{" "}
                        {new Date(es.entered_at as string).toLocaleTimeString()}
                      </span>
                    )}
                    {es.exited_at && (
                      <span>
                        Returned:{" "}
                        {new Date(es.exited_at as string).toLocaleTimeString()}
                      </span>
                    )}
                    {es.entered_at && es.exited_at && (
                      <span>
                        Duration:{" "}
                        {computeDuration(
                          es.entered_at as string,
                          es.exited_at as string,
                        )}
                      </span>
                    )}
                  </div>
                </div>
              ),
            )}
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
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Future Items Queue */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Future Items Queue
        </h2>
        <FutureItemsQueue items={futureItems} />
      </section>

      {/* Action bar */}
      <div className="flex items-center justify-between border-t pt-6">
        <Button variant="outline" onClick={() => void navigate("/boards")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Return to Meeting List
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" disabled title="Coming in a future session">
            Generate Minutes
          </Button>
          <Button onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" />
            Export Meeting Data
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ──────────────────────────────────────────────

function AttendanceBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    present: { label: "Present", variant: "default" },
    remote: { label: "Remote", variant: "secondary" },
    late_arrival: { label: "Late Arrival", variant: "secondary" },
    absent: { label: "Absent", variant: "outline" },
    departed_early: { label: "Departed Early", variant: "outline" },
  };
  const c = config[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={c.variant} className="text-xs">{c.label}</Badge>;
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

function computeTimeSpent(transitions: Array<Record<string, unknown>>): string | null {
  let totalMs = 0;
  transitions.forEach((t) => {
    const start = t.started_at as string;
    const end = (t.ended_at as string) ?? null;
    if (start && end) {
      totalMs += new Date(end).getTime() - new Date(start).getTime();
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
