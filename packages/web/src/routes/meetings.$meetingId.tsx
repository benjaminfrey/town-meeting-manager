/**
 * MeetingDetailPage — /meetings/:meetingId route
 *
 * Shows meeting overview: date/time, location, status, board,
 * agenda/minutes status, and links to agenda builder, live meeting,
 * review, and minutes pages.
 *
 * Phase E, wave 3, Task 3 — the shell every downstream tab (agenda, live,
 * minutes, review) navigates from. Formerly nine raw Supabase reads (one
 * `meeting` row read twice — loader + component — plus `board`, two
 * `person` lookups, `agenda_item`, `minutes_document`, `meeting_attendance`)
 * and zero writes; all nine now go through tRPC:
 *
 *   - `meeting.detail` (wave 3, Task 1) — the meeting row itself, including
 *     `board_id`. This is the one column every board-scoped guard the
 *     agenda/live/minutes/review tabs need downstream reads off this row —
 *     see this wave's plan, Task 3's own note — so `boardId` below is
 *     derived from it, not from a prop or a separate read.
 *   - `board.detail` (unit 0) — reused as-is for the board name; not
 *     duplicated into `meeting.detail`, matching that procedure's own header
 *     comment ("those belong to their own routers").
 *   - `person.detail` (new, this task) — presiding officer / recording
 *     secretary names.
 *   - `agendaItem.countByMeeting`, `minutesDocument.byMeeting`,
 *     `meetingAttendance.countByMeeting` (new routers, this task, one
 *     procedure each) — each router's own header explains why it carries
 *     only one procedure today: the fuller surface belongs to whichever wave
 *     migrates the screen that owns it (agenda: wave 4; attendance/live:
 *     wave 5; minutes: wave 6).
 *
 * This screen has no child components that receive `meeting`/`board` as
 * props — every downstream tab is a sibling ROUTE (`routes.ts`), not an
 * `<Outlet>` child, reached by `<Link>`, so there is no prop surface here to
 * audit columns against; each sibling route reads its own data independently
 * when its own wave migrates it.
 */

import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import {
  CalendarDays,
  Clock,
  MapPin,
  ChevronRight,
  FileText,
  Play,
  ClipboardList,
  Users,
  Gavel,
  AlertTriangle,
} from "lucide-react";
import type { Route } from "./+types/meetings.$meetingId";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import {
  MEETING_STATUS_LABELS,
  MEETING_STATUS_COLORS,
  MEETING_TYPE_LABELS,
  AGENDA_STATUS_LABELS,
  AGENDA_STATUS_COLORS,
} from "@/components/meetings/meeting-labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { queryClient } from "@/lib/queryClient";

// ─── Helpers ─────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[140px] text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h ?? "0", 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${m} ${ampm}`;
}

const MINUTES_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  review: "In Review",
  approved: "Approved",
  published: "Published",
};

const MINUTES_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  review: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  published: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const meetingId = params.meetingId;

  // Not wrapped in try/catch: a nonexistent or foreign meeting answers
  // NOT_FOUND (see `meeting.detail`'s doc comment), and letting that reject
  // the loader routes to `RouteErrorBoundary` below — visible, not the
  // indefinite "Loading meeting…" spinner the old `select("*").single()`
  // produced for the same case.
  await queryClient.ensureQueryData(trpc.meeting.detail.queryOptions({ meetingId }));

  return { meetingId };
}

export default function MeetingDetail({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;

  const {
    data: meeting,
    isLoading: meetingLoading,
    isError: meetingIsError,
    error: meetingError,
  } = useQuery(trpc.meeting.detail.queryOptions({ meetingId }));

  const boardId = meeting?.board_id ?? "";
  const presidingId = meeting?.presiding_officer_id ?? "";
  const secretaryId = meeting?.recording_secretary_id ?? "";

  // Board name
  const { data: board } = useQuery({
    ...trpc.board.detail.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  // Presiding officer name
  const { data: presiding } = useQuery({
    ...trpc.person.detail.queryOptions({ personId: presidingId }),
    enabled: !!presidingId,
  });

  // Recording secretary name
  const { data: secretary } = useQuery({
    ...trpc.person.detail.queryOptions({ personId: secretaryId }),
    enabled: !!secretaryId,
  });

  // Agenda item count
  const { data: agendaItemCount = 0 } = useQuery(
    trpc.agendaItem.countByMeeting.queryOptions({ meetingId }),
  );

  // Minutes document status
  const { data: minutes } = useQuery(trpc.minutesDocument.byMeeting.queryOptions({ meetingId }));

  // Attendance count
  const { data: attendanceCount = 0 } = useQuery(
    trpc.meetingAttendance.countByMeeting.queryOptions({ meetingId }),
  );

  // ─── Error state ─────────────────────────────────────────────────────
  //
  // A failure AFTER mount (a refetch, a `staleTime` expiry) — the loader
  // above already handles the BEFORE-mount case via `RouteErrorBoundary`.
  // Both are required — conventions item 12 — neither substitutes for the
  // other.

  if (meetingIsError) {
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
          <Link to="/boards" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to Boards
          </Link>
        </div>
      </div>
    );
  }

  // ─── Loading state ───────────────────────────────────────────────────

  if (meetingLoading || !meeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading meeting…</p>
        </div>
      </div>
    );
  }

  // ─── Derived values ──────────────────────────────────────────────────

  const status = meeting.status;
  const meetingType = meeting.meeting_type;
  const agendaStatus = meeting.agenda_status;
  const scheduledDate = meeting.scheduled_date;
  const scheduledTime = meeting.scheduled_time;
  const location = meeting.location;
  const title = meeting.title;
  const boardName = board?.name ?? "—";
  const minutesStatus = minutes?.status;

  const presidingName = presiding?.name;
  const secretaryName = secretary?.name;

  // Can run the live meeting?
  const canRunLive = status === "noticed" || status === "open";
  // Can view review?
  const canViewReview =
    status === "adjourned" || status === "minutes_draft" || status === "approved";

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <Link to="/" className="hover:text-foreground">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to="/boards" className="hover:text-foreground">
          Boards
        </Link>
        {boardId && (
          <>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link to={`/boards/${boardId}`} className="hover:text-foreground">
              {boardName}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link to={`/boards/${boardId}/meetings`} className="hover:text-foreground">
              Meetings
            </Link>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{title}</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted-foreground">{boardName}</p>
        </div>
        <div className="flex items-center gap-2">
          {canRunLive && (
            <Button asChild>
              <Link to={`/meetings/${meetingId}/live`}>
                <Play className="mr-2 h-4 w-4" />
                Run Meeting
              </Link>
            </Button>
          )}
          {canViewReview && (
            <Button variant="outline" asChild>
              <Link to={`/meetings/${meetingId}/review`}>
                <ClipboardList className="mr-2 h-4 w-4" />
                Post-Meeting Review
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Meeting Information */}
        <Card>
          <CardHeader>
            <CardTitle>Meeting Information</CardTitle>
            <CardDescription>Schedule, location, and status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Status">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${MEETING_STATUS_COLORS[status] ?? ""}`}
              >
                {MEETING_STATUS_LABELS[status] ?? status}
              </span>
            </InfoRow>
            <InfoRow label="Type">{MEETING_TYPE_LABELS[meetingType] ?? meetingType}</InfoRow>
            <InfoRow label="Date">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                {formatDate(scheduledDate)}
              </span>
            </InfoRow>
            {scheduledTime && (
              <InfoRow label="Time">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatTime(scheduledTime)}
                </span>
              </InfoRow>
            )}
            {location && (
              <InfoRow label="Location">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {location}
                </span>
              </InfoRow>
            )}
            {presidingName && <InfoRow label="Presiding Officer">{presidingName}</InfoRow>}
            {secretaryName && <InfoRow label="Recording Secretary">{secretaryName}</InfoRow>}
            {meeting.started_at && (
              <InfoRow label="Started">{new Date(meeting.started_at).toLocaleString()}</InfoRow>
            )}
            {meeting.ended_at && (
              <InfoRow label="Ended">{new Date(meeting.ended_at).toLocaleString()}</InfoRow>
            )}
          </CardContent>
        </Card>

        {/* Documents & Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Documents & Actions</CardTitle>
            <CardDescription>Agenda, minutes, and meeting tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Agenda */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                  <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Agenda</p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${AGENDA_STATUS_COLORS[agendaStatus] ?? ""}`}
                    >
                      {AGENDA_STATUS_LABELS[agendaStatus] ?? agendaStatus}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {agendaItemCount} item{agendaItemCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/meetings/${meetingId}/agenda`}>Edit Agenda</Link>
              </Button>
            </div>

            {/* Minutes */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-950">
                  <Gavel className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Minutes</p>
                  {minutesStatus ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${MINUTES_STATUS_COLORS[minutesStatus] ?? ""}`}
                    >
                      {MINUTES_STATUS_LABELS[minutesStatus] ?? minutesStatus}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not yet generated</span>
                  )}
                </div>
              </div>
              {minutesStatus && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/meetings/${meetingId}/minutes`}>View Minutes</Link>
                </Button>
              )}
            </div>

            {/* Live Meeting */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 dark:bg-green-950">
                  <Play className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Live Meeting</p>
                  <span className="text-xs text-muted-foreground">
                    {status === "open"
                      ? "Meeting in progress"
                      : status === "noticed"
                        ? "Ready to start"
                        : status === "draft"
                          ? "Publish agenda & notice first"
                          : "Meeting completed"}
                  </span>
                </div>
              </div>
              {canRunLive && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/meetings/${meetingId}/live`}>
                    {status === "open" ? "Rejoin" : "Start"}
                  </Link>
                </Button>
              )}
            </div>

            {/* Attendance summary (if any) */}
            {attendanceCount > 0 && (
              <div className="flex items-center gap-3 rounded-lg border p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950">
                  <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Attendance</p>
                  <span className="text-xs text-muted-foreground">
                    {attendanceCount} member{attendanceCount !== 1 ? "s" : ""} recorded
                  </span>
                </div>
              </div>
            )}

            {/* Post-Meeting Review */}
            {canViewReview && (
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-950">
                    <ClipboardList className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Post-Meeting Review</p>
                    <span className="text-xs text-muted-foreground">
                      Review meeting summary and actions
                    </span>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/meetings/${meetingId}/review`}>Review</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
