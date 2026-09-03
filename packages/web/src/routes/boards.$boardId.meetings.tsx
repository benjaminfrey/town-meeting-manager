/**
 * MeetingListPage — /boards/:boardId/meetings route
 *
 * Lists meetings for a board with create, edit-agenda, and cancel actions.
 *
 * Phase E, wave 3, Task 2 — `meeting.byBoard` (wave 3 Task 1) and
 * `board.detail` (already shipped, wave 2) both move onto tRPC here;
 * completeness gaps only for this file's own reads. `meeting.byBoard`'s row
 * shape does NOT include `board_id` (it doesn't need to — the query is
 * already scoped by the `boardId` input) — `boardId` from the route's own
 * params is what's threaded to any writer instead. This route is
 * `CancelMeetingDialog`'s only mount point, and — unlike this
 * file's own reads — that dialog's write was NOT merely a completeness gap;
 * it had no authorization check at all. It's converted here too, now that
 * this route has a real `boardId` to hand it (see that component's own doc
 * comment for the guard it closes).
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CalendarDays, AlertTriangle, Play, Plus } from "lucide-react";
import type { Route } from "./+types/boards.$boardId.meetings";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { CreateMeetingDialog } from "@/components/meetings/CreateMeetingDialog";
import { CancelMeetingDialog } from "@/components/meetings/CancelMeetingDialog";
import {
  MEETING_STATUS_LABELS,
  MEETING_STATUS_COLORS,
  MEETING_TYPE_LABELS,
  AGENDA_STATUS_LABELS,
  AGENDA_STATUS_COLORS,
} from "@/components/meetings/meeting-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc";
import { queryClient } from "@/lib/queryClient";

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const boardId = params.boardId;

  // Not wrapped in try/catch: a nonexistent or foreign board answers
  // NOT_FOUND and letting that reject routes to RouteErrorBoundary — see
  // conventions item 4/12. `meeting.byBoard` cannot itself 404 (an empty
  // list is a legitimate answer for a real, meeting-less board), so only
  // `board.detail` is worth priming pre-mount; `byBoard` still gets fetched
  // in parallel so the component does not wait on it serially.
  await Promise.all([
    queryClient.ensureQueryData(trpc.board.detail.queryOptions({ boardId })),
    queryClient.ensureQueryData(trpc.meeting.byBoard.queryOptions({ boardId })),
  ]);

  return { boardId };
}

export default function MeetingListPage({ loaderData }: Route.ComponentProps) {
  const { boardId } = loaderData;
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";

  const [createOpen, setCreateOpen] = useState(false);
  const [cancelMeeting, setCancelMeeting] = useState<{
    id: string;
    title: string;
  } | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────
  const {
    data: board,
    isLoading: isBoardLoading,
    isError: isBoardError,
  } = useQuery(trpc.board.detail.queryOptions({ boardId }));

  const {
    data: meetings = [],
    isLoading: isMeetingsLoading,
    isError: isMeetingsError,
  } = useQuery(trpc.meeting.byBoard.queryOptions({ boardId }));

  const boardName = board?.name ?? "";

  // ─── Error ──────────────────────────────────────────────────────────
  // A screen that renders nothing and says nothing for a failed read is the
  // failure mode this migration exists to end (conventions item 5).
  if (isBoardError || isMeetingsError) {
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {isBoardError
              ? "This board could not be found."
              : "Something went wrong loading its meetings."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isBoardError
              ? "It may have been deleted, or it belongs to another town."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
        </div>
      </div>
    );
  }

  // ─── Loading ────────────────────────────────────────────────────────
  if (isBoardLoading || !board || isMeetingsLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Dialogs */}
      <CreateMeetingDialog
        boardId={boardId}
        boardName={boardName}
        townId={townId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      {cancelMeeting && (
        <CancelMeetingDialog
          meetingId={cancelMeeting.id}
          meetingTitle={cancelMeeting.title}
          boardId={boardId}
          open={!!cancelMeeting}
          onOpenChange={(open) => {
            if (!open) setCancelMeeting(null);
          }}
        />
      )}

      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/dashboard" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to="/boards" className="hover:text-foreground transition-colors">
          Boards
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to={`/boards/${boardId}`} className="hover:text-foreground transition-colors">
          {boardName}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">Meetings</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
          <p className="mt-1 text-muted-foreground">Manage meetings for {boardName}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Meeting
        </Button>
      </div>

      {/* Meeting table */}
      {meetings.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-card-foreground shadow-sm">
          <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">No meetings yet. Create one to get started.</p>
          <Button className="mt-4" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Meeting
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Agenda</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => {
                const id = m.id;
                const title = m.title;
                const meetingType = m.meeting_type;
                const status = m.status;
                const agendaStatus = m.agenda_status;
                const scheduledDate = m.scheduled_date;
                const scheduledTime = m.scheduled_time ?? "";
                const isCancelled = status === "cancelled";

                const formattedDate = scheduledDate
                  ? new Date(scheduledDate + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "";
                const formattedTime = scheduledTime ? scheduledTime.slice(0, 5) : "";

                return (
                  <tr
                    key={id}
                    className={`border-b last:border-b-0 transition-colors ${
                      isCancelled ? "opacity-50" : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium">{formattedDate}</div>
                      {formattedTime && (
                        <div className="text-xs text-muted-foreground">{formattedTime}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/meetings/${id}/agenda`}
                        className={`font-medium ${
                          isCancelled ? "text-muted-foreground" : "text-primary hover:underline"
                        }`}
                      >
                        {title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {MEETING_TYPE_LABELS[meetingType] ?? meetingType}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          MEETING_STATUS_COLORS[status] ?? ""
                        }`}
                      >
                        {MEETING_STATUS_LABELS[status] ?? status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          AGENDA_STATUS_COLORS[agendaStatus] ?? ""
                        }`}
                      >
                        {AGENDA_STATUS_LABELS[agendaStatus] ?? agendaStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isCancelled && (
                        <div className="flex items-center justify-end gap-1">
                          {(status === "noticed" || status === "open") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void navigate(`/meetings/${id}/live`)}
                            >
                              <Play className="mr-1 h-3.5 w-3.5" />
                              Run Meeting
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void navigate(`/meetings/${id}/agenda`)}
                          >
                            Edit Agenda
                          </Button>
                          {(status === "draft" || status === "noticed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setCancelMeeting({ id, title })}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
