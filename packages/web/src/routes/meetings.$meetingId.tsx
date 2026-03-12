/**
 * MeetingDetailPage — /meetings/:meetingId route
 *
 * Shows meeting overview: date/time, location, status, board,
 * agenda/minutes status, and links to agenda builder, live meeting,
 * review, and minutes pages.
 */

import { Link } from "react-router";
import { useQuery, useStatus } from "@powersync/react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ─── Helpers ─────────────────────────────────────────────────────────

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[140px] text-sm text-muted-foreground">
        {label}
      </span>
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
  const hour = parseInt(h, 10);
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
  draft:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  review:
    "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  approved:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  published:
    "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { meetingId: params.meetingId };
}

export default function MeetingDetail({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const syncStatus = useStatus();

  // Meeting data
  const { data: meetingRows } = useQuery(
    "SELECT * FROM meetings WHERE id = ? LIMIT 1",
    [meetingId],
  );
  const meeting = meetingRows?.[0] as Record<string, unknown> | undefined;

  // Board name
  const boardId = (meeting?.board_id as string) ?? "";
  const { data: boardRows } = useQuery(
    "SELECT id, name FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );
  const board = boardRows?.[0] as Record<string, unknown> | undefined;

  // Presiding officer & recording secretary names
  const presidingId = (meeting?.presiding_officer_id as string) ?? "";
  const secretaryId = (meeting?.recording_secretary_id as string) ?? "";
  const { data: presidingRows } = useQuery(
    "SELECT name FROM persons WHERE id = ? LIMIT 1",
    [presidingId],
  );
  const { data: secretaryRows } = useQuery(
    "SELECT name FROM persons WHERE id = ? LIMIT 1",
    [secretaryId],
  );
  const presiding = presidingRows?.[0] as Record<string, unknown> | undefined;
  const secretary = secretaryRows?.[0] as Record<string, unknown> | undefined;

  // Agenda item count
  const { data: agendaCountRows } = useQuery(
    "SELECT COUNT(*) as count FROM agenda_items WHERE meeting_id = ?",
    [meetingId],
  );
  const agendaItemCount = (agendaCountRows?.[0] as Record<string, unknown>)
    ?.count as number | undefined;

  // Minutes document status
  const { data: minutesRows } = useQuery(
    "SELECT id, status FROM minutes_documents WHERE meeting_id = ? LIMIT 1",
    [meetingId],
  );
  const minutes = minutesRows?.[0] as Record<string, unknown> | undefined;

  // Attendance count
  const { data: attendanceRows } = useQuery(
    "SELECT COUNT(*) as count FROM meeting_attendance WHERE meeting_id = ?",
    [meetingId],
  );
  const attendanceCount = (attendanceRows?.[0] as Record<string, unknown>)
    ?.count as number | undefined;

  // ─── Loading state ───────────────────────────────────────────────────

  if (!meeting) {
    // If PowerSync has fully synced and the meeting still isn't found, show not-found.
    // Otherwise show a loading spinner while data arrives.
    const hasSynced = syncStatus.hasSynced ?? false;
    return (
      <div className="flex items-center justify-center p-12">
        {hasSynced ? (
          <div className="text-center">
            <p className="text-muted-foreground">Meeting not found.</p>
            <Link
              to="/boards"
              className="mt-3 inline-block text-sm text-blue-600 hover:underline"
            >
              Back to Boards
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Loading meeting…</p>
          </div>
        )}
      </div>
    );
  }

  // ─── Derived values ──────────────────────────────────────────────────

  const status = meeting.status as string;
  const meetingType = meeting.meeting_type as string;
  const agendaStatus = meeting.agenda_status as string;
  const scheduledDate = meeting.scheduled_date as string;
  const scheduledTime = meeting.scheduled_time as string;
  const location = meeting.location as string;
  const title = meeting.title as string;
  const boardName = (board?.name as string) ?? "—";
  const minutesStatus = minutes?.status as string | undefined;

  const presidingName = presiding?.name as string | undefined;
  const secretaryName = secretary?.name as string | undefined;

  // Can run the live meeting?
  const canRunLive = status === "noticed" || status === "open";
  // Can view review?
  const canViewReview =
    status === "adjourned" ||
    status === "minutes_draft" ||
    status === "approved";

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
            <Link
              to={`/boards/${boardId}/meetings`}
              className="hover:text-foreground"
            >
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
            <InfoRow label="Type">
              {MEETING_TYPE_LABELS[meetingType] ?? meetingType}
            </InfoRow>
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
            {presidingName && (
              <InfoRow label="Presiding Officer">{presidingName}</InfoRow>
            )}
            {secretaryName && (
              <InfoRow label="Recording Secretary">{secretaryName}</InfoRow>
            )}
            {meeting.started_at && (
              <InfoRow label="Started">
                {new Date(meeting.started_at as string).toLocaleString()}
              </InfoRow>
            )}
            {meeting.ended_at && (
              <InfoRow label="Ended">
                {new Date(meeting.ended_at as string).toLocaleString()}
              </InfoRow>
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
                      {agendaItemCount ?? 0} item
                      {agendaItemCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/meetings/${meetingId}/agenda`}>
                  Edit Agenda
                </Link>
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
                    <span className="text-xs text-muted-foreground">
                      Not yet generated
                    </span>
                  )}
                </div>
              </div>
              {minutesStatus && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/meetings/${meetingId}/minutes`}>
                    View Minutes
                  </Link>
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
            {(attendanceCount ?? 0) > 0 && (
              <div className="flex items-center gap-3 rounded-lg border p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950">
                  <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Attendance</p>
                  <span className="text-xs text-muted-foreground">
                    {attendanceCount} member{attendanceCount !== 1 ? "s" : ""}{" "}
                    recorded
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
                  <Link to={`/meetings/${meetingId}/review`}>
                    Review
                  </Link>
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
