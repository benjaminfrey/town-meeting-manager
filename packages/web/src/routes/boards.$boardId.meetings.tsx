/**
 * MeetingListPage — /boards/:boardId/meetings route
 *
 * Lists meetings for a board with create, edit-agenda, and cancel actions.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { usePowerSync, useQuery } from "@powersync/react";
import { ChevronRight, CalendarDays, Plus } from "lucide-react";
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

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { boardId: params.boardId };
}

export default function MeetingListPage({
  loaderData,
}: Route.ComponentProps) {
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
  const { data: boardRows } = useQuery(
    "SELECT id, name, board_type FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );
  const { data: meetingRows } = useQuery(
    "SELECT * FROM meetings WHERE board_id = ? ORDER BY scheduled_date DESC, scheduled_time DESC",
    [boardId],
  );

  const board = boardRows?.[0] as Record<string, unknown> | undefined;
  const boardName = String(board?.name ?? "");
  const meetings = (meetingRows ?? []) as Record<string, unknown>[];

  // ─── Loading ────────────────────────────────────────────────────────
  if (!board) {
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
          open={!!cancelMeeting}
          onOpenChange={(open) => {
            if (!open) setCancelMeeting(null);
          }}
        />
      )}

      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link
          to="/dashboard"
          className="hover:text-foreground transition-colors"
        >
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to="/boards" className="hover:text-foreground transition-colors">
          Boards
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          to={`/boards/${boardId}`}
          className="hover:text-foreground transition-colors"
        >
          {boardName}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">Meetings</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
          <p className="mt-1 text-muted-foreground">
            Manage meetings for {boardName}
          </p>
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
          <p className="mt-3 text-muted-foreground">
            No meetings yet. Create one to get started.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Meeting
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Title
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Type
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Agenda
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => {
                const id = String(m.id);
                const title = String(m.title ?? "");
                const meetingType = String(m.meeting_type ?? "regular");
                const status = String(m.status ?? "draft");
                const agendaStatus = String(m.agenda_status ?? "draft");
                const scheduledDate = String(m.scheduled_date ?? "");
                const scheduledTime = String(m.scheduled_time ?? "");
                const isCancelled = status === "cancelled";

                const formattedDate = scheduledDate
                  ? new Date(scheduledDate + "T00:00:00").toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" },
                    )
                  : "";
                const formattedTime = scheduledTime
                  ? scheduledTime.slice(0, 5)
                  : "";

                return (
                  <tr
                    key={id}
                    className={`border-b last:border-b-0 transition-colors ${
                      isCancelled
                        ? "opacity-50"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium">{formattedDate}</div>
                      {formattedTime && (
                        <div className="text-xs text-muted-foreground">
                          {formattedTime}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/meetings/${id}/agenda`}
                        className={`font-medium ${
                          isCancelled
                            ? "text-muted-foreground"
                            : "text-primary hover:underline"
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void navigate(`/meetings/${id}/agenda`)
                            }
                          >
                            Edit Agenda
                          </Button>
                          {(status === "draft" || status === "noticed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() =>
                                setCancelMeeting({ id, title })
                              }
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
