/**
 * MeetingsPage — /meetings
 *
 * Aggregate view of all meetings across all boards for the current town.
 * Shows upcoming meetings first, then past meetings, grouped by date.
 * Links through to the board-specific meeting list and individual meeting pages.
 */

import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Play } from "lucide-react";
import type { Route } from "./+types/meetings";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermission } from "@/hooks/usePermission";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";
import {
  MEETING_STATUS_LABELS,
  MEETING_STATUS_COLORS,
  MEETING_TYPE_LABELS,
} from "@/components/meetings/meeting-labels";

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader() {
  return {};
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(timeStr: string) {
  return timeStr.slice(0, 5);
}

// ─── Component ───────────────────────────────────────────────────────

export default function MeetingsPage() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";
  const { allowed: canCreateMeeting } = usePermission("A1");

  // Fetch all meetings for this town, joined with board name
  const { data: meetingRows = [], isLoading } = useQuery({
    queryKey: queryKeys.meetings.byTown(townId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting")
        .select("*, board:board_id(id, name)")
        .eq("town_id", townId)
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: false })
        .order("scheduled_time", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!townId,
  });

  const meetings = meetingRows as Array<Record<string, unknown>>;

  // Split into upcoming (today or future, or open) and past
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = meetings.filter((m) => {
    const date = String(m.scheduled_date ?? "");
    const status = String(m.status ?? "");
    return date >= today || status === "open" || status === "noticed";
  });
  const past = meetings.filter((m) => {
    const date = String(m.scheduled_date ?? "");
    const status = String(m.status ?? "");
    return date < today && status !== "open" && status !== "noticed";
  });

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
          <p className="mt-1 text-muted-foreground">
            All meetings across your boards and committees
          </p>
        </div>
        {canCreateMeeting && (
          <Button asChild>
            <Link to="/boards">Schedule Meeting</Link>
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">Loading meetings…</p>
        </div>
      ) : meetings.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-card-foreground shadow-sm">
          <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">No meetings scheduled</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Schedule a meeting from a board's meeting list.
          </p>
          <Button className="mt-4" variant="outline" asChild>
            <Link to="/boards">Go to Boards</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <MeetingSection
              title="Upcoming"
              meetings={upcoming}
              onNavigate={(path) => void navigate(path)}
            />
          )}
          {past.length > 0 && (
            <MeetingSection
              title="Past"
              meetings={past}
              onNavigate={(path) => void navigate(path)}
              muted
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────

function MeetingSection({
  title,
  meetings,
  onNavigate,
  muted = false,
}: {
  title: string;
  meetings: Record<string, unknown>[];
  onNavigate: (path: string) => void;
  muted?: boolean;
}) {
  return (
    <div>
      <h2 className={`mb-3 text-sm font-semibold uppercase tracking-wider ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {title}
      </h2>
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Meeting</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Board</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {meetings.map((m) => {
              const id = String(m.id);
              const title = String(m.title ?? "");
              const status = String(m.status ?? "draft");
              const meetingType = String(m.meeting_type ?? "regular");
              const scheduledDate = String(m.scheduled_date ?? "");
              const scheduledTime = String(m.scheduled_time ?? "");
              const board = m.board as Record<string, unknown> | null;
              const boardId = String(board?.id ?? "");
              const boardName = String(board?.name ?? "");
              const isActive = status === "open";

              return (
                <tr key={id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-medium">{scheduledDate ? formatDate(scheduledDate) : "—"}</div>
                    {scheduledTime && (
                      <div className="text-xs text-muted-foreground">{formatTime(scheduledTime)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/meetings/${id}/agenda`}
                      className="font-medium text-primary hover:underline"
                    >
                      {title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {boardId ? (
                      <Link to={`/boards/${boardId}/meetings`} className="hover:text-foreground transition-colors">
                        {boardName}
                      </Link>
                    ) : boardName}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {MEETING_TYPE_LABELS[meetingType] ?? meetingType}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${MEETING_STATUS_COLORS[status] ?? ""}`}>
                      {MEETING_STATUS_LABELS[status] ?? status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onNavigate(`/meetings/${id}/live`)}
                        >
                          <Play className="mr-1 h-3.5 w-3.5" />
                          Run
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onNavigate(`/meetings/${id}/agenda`)}
                      >
                        View
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
