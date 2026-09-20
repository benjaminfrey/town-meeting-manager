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
 *
 * Phase E, wave 6, Task 5 — `trpc.meeting.detail`, which gained `board_name`
 * for this component (see that procedure's own doc comment for why a JOIN
 * rather than a dependent `board.detail` call). Like `CommandPalette.tsx`,
 * this file carried no `TODO(phase-e-wave-*)` marker through five waves
 * despite a live raw read, so item 11's sweep read it as done.
 *
 * Three differences from the query it replaces, all of them narrowings the
 * raw read could not express:
 *
 *  - `.limit(1).maybeSingle()` on a primary key becomes plain NOT_FOUND:
 *    `meeting.detail` throws for an id that names no row or a row in another
 *    town, where `maybeSingle()` answered `null` for both and this component
 *    rendered its "Meeting" placeholder either way.
 *  - The `board:board_id(id, name)` embed and its array/object normalisation
 *    are gone — a to-one PostgREST embed infers as an array, which is what
 *    the `Array.isArray(boardRaw)` dance existed for. A real JOIN has no such
 *    ambiguity, and `board.id` is dropped because nothing here rendered it.
 *  - `title` and `status` are `NOT NULL` in the schema, so the `?? null`
 *    coalescing and the `MeetingHeader` bag type went with them.
 *
 * The failure is now VISIBLE rather than silent: a header that renders
 * "Meeting" with no title is exactly the "renders nothing and says nothing"
 * mode conventions item 5 exists to end. It stays small and non-blocking (the
 * tabs remain usable) for the reason `home.tsx`'s town-header banner gives —
 * this is a context strip, not the screen's content.
 */

import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MEETING_STATUS_LABELS, MEETING_STATUS_COLORS } from "@/components/meetings/meeting-labels";
import { LIFECYCLE_STAGES, lifecycleStageForStatus } from "@/components/MeetingLifecycle";
import { cn } from "@/lib/utils";

const TABS = [
  { seg: "agenda", label: "Agenda" },
  { seg: "live", label: "Live meeting" },
  { seg: "review", label: "Review" },
  { seg: "minutes", label: "Minutes" },
] as const;

export function MeetingSubnavHeader({ meetingId }: { meetingId: string }) {
  const location = useLocation();
  const activeSeg = location.pathname.split("/").pop() ?? "";

  const { data: meeting, isError } = useQuery({
    ...trpc.meeting.detail.queryOptions({ meetingId }),
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
          <span className="font-medium">{meeting?.board_name ?? "Meeting"}</span>
          {meeting?.title && (
            <span className="truncate text-muted-foreground">{meeting.title}</span>
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

        {/* This read failed after mount (conventions item 5/12) — small and
            non-blocking, matching this strip's weight on the screen. */}
        {isError && (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>Couldn't load this meeting's details.</p>
          </div>
        )}

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
                  (currentStage === "minutes" || currentStage === "approved")));
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
