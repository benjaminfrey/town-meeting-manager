/**
 * MeetingSubnavHeader — shared context header for every meeting screen.
 *
 * Answers "which meeting am I in, what's its status, where am I in its
 * lifecycle, and how do I move between its stages" — the wayfinding the
 * meeting sub-pages (agenda/live/review/minutes) previously lacked.
 *
 * Self-contained: takes only the meetingId and queries the rest. The active
 * tab is derived from the URL, so callers just render
 * <MeetingSubnavHeader meetingId={meetingId} />.
 */

import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  MEETING_STATUS_LABELS,
  MEETING_STATUS_COLORS,
} from "@/components/meetings/meeting-labels";
import {
  LIFECYCLE_STAGES,
  lifecycleStageForStatus,
} from "@/components/MeetingLifecycle";
import { cn } from "@/lib/utils";

const TABS = [
  { seg: "agenda", label: "Agenda" },
  { seg: "live", label: "Live meeting" },
  { seg: "review", label: "Review" },
  { seg: "minutes", label: "Minutes" },
] as const;

interface MeetingHeader {
  id: string;
  title: string | null;
  status: string | null;
  board: { id: string; name: string } | null;
}

export function MeetingSubnavHeader({ meetingId }: { meetingId: string }) {
  const location = useLocation();
  const activeSeg = location.pathname.split("/").pop() ?? "";

  const { data: meeting } = useQuery({
    queryKey: ["meeting-subnav", meetingId],
    queryFn: async () => {
      const { data } = await supabase
        .from("meeting")
        .select("id, title, status, board:board_id(id, name)")
        .eq("id", meetingId)
        .limit(1)
        .maybeSingle();
      if (!data) return null;
      const raw = data as Record<string, unknown>;
      const boardRaw = raw.board as
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
      const board = Array.isArray(boardRaw) ? (boardRaw[0] ?? null) : boardRaw;
      return {
        id: raw.id as string,
        title: (raw.title as string) ?? null,
        status: (raw.status as string) ?? null,
        board,
      } satisfies MeetingHeader;
    },
    enabled: !!meetingId,
  });

  const status = meeting?.status ?? "";
  const currentStage = lifecycleStageForStatus(status);

  return (
    <div className="border-b bg-background">
      <div className="mx-auto max-w-6xl px-4 pt-3">
        {/* Back + identity + status */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to="/meetings"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Meetings
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-medium">
            {meeting?.board?.name ?? "Meeting"}
          </span>
          {meeting?.title && (
            <span className="truncate text-muted-foreground">
              {meeting.title}
            </span>
          )}
          {status && (
            <span
              className={cn(
                "ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                MEETING_STATUS_COLORS[status] ?? "",
              )}
            >
              {MEETING_STATUS_LABELS[status] ?? status}
            </span>
          )}
        </div>

        {/* Tabs — the meeting lifecycle, navigable */}
        <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto" aria-label="Meeting stages">
          {TABS.map((tab) => {
            const isActive = activeSeg === tab.seg;
            const isCurrentStage =
              currentStage &&
              LIFECYCLE_STAGES.find((s) => s.key === currentStage) &&
              ((tab.seg === "agenda" && currentStage === "draft") ||
                (tab.seg === "live" &&
                  (currentStage === "noticed" || currentStage === "meeting")) ||
                ((tab.seg === "review" || tab.seg === "minutes") &&
                  (currentStage === "minutes" || currentStage === "published")));
            return (
              <Link
                key={tab.seg}
                to={`/meetings/${meetingId}/${tab.seg}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {tab.label}
                {isCurrentStage && !isActive && (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
