/**
 * Home (/) — the self-explanatory landing.
 *
 * States what the app is, makes the meeting lifecycle visible, leads with the
 * next meeting, and surfaces what needs doing. Role-aware: admin/staff see the
 * full operations view; board members see a lighter review-oriented view.
 *
 * Stage 1, Phase E, wave 6, Task 5 — every read on this screen is tRPC now.
 * `town.detail` moved in wave 1; `meeting.byTown`, `minutesDocument
 * .pendingByTown` and `board.listActive` move here, discharging this file's
 * marker in full: ~~TODO(phase-e-wave-6): minutesDocument.pendingByTown,
 * board.listActive~~.
 *
 * ─── The three reads, and what changed with each ─────────────────────────
 *
 * `meetingRows` -> `trpc.meeting.byTown`. The raw query was
 * `select("*, board:board_id(id, name)")`, so this screen used to receive
 * every column of `meeting` whether it read it or not; the procedure names
 * nine, and `started_at` was added to it for this screen's "started N min
 * ago" hero (see its own doc comment). The board arrives as flat
 * `board_id`/`board_name` rather than a PostgREST to-one embed. Order and
 * filter are identical (`status != 'cancelled'`, `scheduled_date` then
 * `scheduled_time` ascending).
 *
 * `minutesDocs` -> `trpc.minutesDocument.pendingByTown`. Same `draft`/`review`
 * filter, same `{meeting_id, status}` shape — and a NARROWING the raw query
 * could not perform: that procedure applies rule 9 (R4) per row, so an account
 * with R4 on no board no longer sees every unadopted document in the town.
 * See its own doc comment; that is a deliberate fix, not a side effect.
 *
 * `boardRows` -> `trpc.board.listActive`. Same `archived_at IS NULL` filter
 * (the hazard this file's header has warned about for four waves: an archived
 * board must never be offered as a place to schedule a meeting). **The
 * ordering difference is real and is accepted here, not papered over:**
 * `listActive` orders `is_governing_board DESC, name ASC` where this picker's
 * raw read was plain `.order("name")`. This is a labelled, one-click list of a
 * town's handful of boards, and the governing board — the one that meets most
 * often — sorting first is if anything the better answer for it. The four
 * extra columns the procedure returns are invisible to a consumer that does
 * not read them (`test/trpc.ts`'s "the gap runs one way"). The alternative,
 * a second procedure differing only in ORDER BY, was declined for the reason
 * `listActive`'s own doc comment already gives.
 *
 * ─── A dead status vocabulary, audited rather than missed ────────────────
 *
 * `"in_progress"` appears three times below (the `active.push` branch, the
 * hero's `isLive`, and `primaryAction`'s case) and `"published"` once (the
 * `upcoming` exclusion). Neither is a `meeting_status` value: the enum is
 * `draft, noticed, open, adjourned, minutes_draft, approved, cancelled`
 * (`0000_baseline.sql`), and `SELECT 'in_progress'::meeting_status` raises
 * "invalid input value for enum meeting_status" against a live database.
 * `"published"` is a `minutes_document_status`, borrowed by mistake. Both are
 * therefore inert, on both sides of this migration — no row has ever matched
 * either. Left as-is and NAMED rather than quietly deleted, matching the
 * identical call `meetings.tsx`'s own `KANBAN_COLUMNS` comment made in wave 3;
 * `components/MeetingLifecycle.tsx`'s `LIFECYCLE_STAGES` carries the same two
 * dead values and is shared by a second screen, so the fix belongs in one
 * change across all three rather than smuggled into a transport task.
 */

import { useMemo, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Play,
  FileText,
  Edit,
  AlertTriangle,
  Radio,
  Plus,
  Clock,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermission } from "@/hooks/usePermission";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MEETING_STATUS_LABELS, MEETING_STATUS_COLORS } from "@/components/meetings/meeting-labels";
import { MeetingLifecycle, computeLifecycleCounts } from "@/components/MeetingLifecycle";
import { QuickTour, useShouldShowTour } from "@/components/QuickTour";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { MeetingListSkeleton } from "@/components/skeletons";
import { CreateMeetingDialog } from "@/components/meetings/CreateMeetingDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getNoticeDeadline, type MeetingType } from "@town-meeting/shared";

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h!, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function daysFromNow(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** The single most relevant next action for a meeting, by status. */
function primaryAction(status: string, id: string) {
  switch (status) {
    case "draft":
      return { label: "Open agenda", to: `/meetings/${id}/agenda` };
    case "noticed":
      return { label: "Start meeting", to: `/meetings/${id}/live` };
    // `"in_progress"` below is not a `meeting_status` value and never has
    // been — see this file's header. Inert, named rather than deleted.
    case "open":
    case "in_progress":
      return { label: "Rejoin meeting", to: `/meetings/${id}/live` };
    case "adjourned":
    case "minutes_draft":
      return { label: "Review minutes", to: `/meetings/${id}/review` };
    default:
      return { label: "View meeting", to: `/meetings/${id}` };
  }
}

// ─── Types ────────────────────────────────────────────────────────────

/**
 * `meeting.byTown`'s real row shape, not a hand-written bag with an
 * `[key: string]: unknown` escape hatch — conventions item 10, and this is
 * exactly the type that made `ArchiveBoardDialog`'s `board.town_id` read
 * compile to `""`. The three child components below take this type too, since
 * the audit covers props, not only this file's own JSX.
 */
type MeetingRow = RouterOutputs["meeting"]["byTown"][number];

interface ActionItem {
  meeting: MeetingRow;
  reason: string;
  actionLabel: string;
  actionPath: string;
  icon: typeof Play;
  priority: number;
}

// ─── Component ────────────────────────────────────────────────────────

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isWelcome = searchParams.get("welcome") === "true";
  const showTour = useShouldShowTour(isWelcome);
  const [tourActive, setTourActive] = useState(showTour);
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";
  const isBoardMember = currentUser?.role === "board_member";
  const { allowed: canCreateMeeting } = usePermission("A1");

  // ─── Queries ──────────────────────────────────────────────────────

  const {
    data: meetingRows = [],
    isLoading: meetingsLoading,
    isError: isMeetingsError,
  } = useQuery({
    ...trpc.meeting.byTown.queryOptions(),
    enabled: !!townId,
  });

  // Only `name`/`state` are read below — see conventions item 1 for why
  // `town.detail`'s explicit 19-column list is not narrowed further here:
  // it is one procedure shared by every screen that needs the town row
  // (`settings.town.tsx` and, as of this task, this one), not a per-screen
  // query. `isTownError` gets a small non-blocking banner, not a full-page
  // `role="alert"` replacement (conventions item 5/12): unlike
  // `settings.town.tsx`, where `town.detail` gates the entire page, this
  // screen's header degrades to safe defaults ("Your town", "ME") and the
  // meeting pipeline below it is still fully useful without this read.
  const { data: town, isError: isTownError } = useQuery({
    ...trpc.town.detail.queryOptions(),
    enabled: !!townId,
  });

  const { data: minutesDocs = [] } = useQuery({
    ...trpc.minutesDocument.pendingByTown.queryOptions(),
    enabled: !!townId,
  });

  const { data: boardRows = [] } = useQuery({
    ...trpc.board.listActive.queryOptions(),
    enabled: !!townId && canCreateMeeting,
  });

  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handleBoardSelect = useCallback((board: { id: string; name: string }) => {
    setBoardPickerOpen(false);
    setSelectedBoard(board);
  }, []);

  // No `as`/`Record<string, unknown>` cast (conventions item 10): `town` is
  // already typed off `town.detail`'s real output.
  const townName = town?.name ?? "Your town";
  const townState = town?.state ?? "ME";

  // ─── Compute sections ─────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pendingMinutesMeetingIds = new Set(minutesDocs.map((d) => d.meeting_id));

  const { heroMeeting, actionItems, upcoming, minutesReview, counts } = useMemo(() => {
    const active: MeetingRow[] = [];
    const actions: ActionItem[] = [];
    const upcomingList: MeetingRow[] = [];
    const review: MeetingRow[] = [];

    for (const m of meetingRows) {
      const date = m.scheduled_date;
      const status = m.status;

      if (date === today && (status === "open" || status === "in_progress")) {
        active.push(m);
        actions.push({
          meeting: m,
          reason: "Meeting in progress",
          actionLabel: "Go to live meeting",
          actionPath: `/meetings/${m.id}/live`,
          icon: Radio,
          priority: 0,
        });
      } else if (date === today && status === "noticed") {
        actions.push({
          meeting: m,
          reason: "Ready to start today",
          actionLabel: "Start meeting",
          actionPath: `/meetings/${m.id}/live`,
          icon: Play,
          priority: 1,
        });
      } else if (status === "draft" && date >= today) {
        const daysAway = daysFromNow(date);
        let deadlineDays: number | null = null;
        try {
          const result = getNoticeDeadline({
            meetingDate: new Date(date + "T00:00:00"),
            meetingTime: m.scheduled_time || undefined,
            state: townState,
            meetingType: (m.meeting_type ?? "regular") as MeetingType,
          });
          if (result.daysUntilDeadline !== null) {
            deadlineDays = result.daysUntilDeadline;
          }
        } catch {
          // compliance engine may lack rules for this state — advisory only
        }
        const showAction = daysAway <= 7 || (deadlineDays !== null && deadlineDays <= 2);
        if (showAction) {
          const warning =
            deadlineDays !== null && deadlineDays <= 2
              ? `Notice due in ${deadlineDays} day${deadlineDays !== 1 ? "s" : ""}`
              : `Meeting in ${daysAway} day${daysAway !== 1 ? "s" : ""}`;
          actions.push({
            meeting: m,
            reason: warning,
            actionLabel: "Complete agenda",
            actionPath: `/meetings/${m.id}/agenda`,
            icon: Edit,
            priority: 2,
          });
        }
      } else if (
        (status === "adjourned" || status === "minutes_draft") &&
        pendingMinutesMeetingIds.has(m.id)
      ) {
        review.push(m);
        actions.push({
          meeting: m,
          reason: "Minutes pending review",
          actionLabel: "Review minutes",
          actionPath: `/meetings/${m.id}/review`,
          icon: FileText,
          priority: 3,
        });
      }

      // `"published"` is a `minutes_document_status`, not a `meeting_status`
      // — inert here. See this file's header.
      if (date >= today && date <= thirtyDaysOut && !["approved", "published"].includes(status)) {
        upcomingList.push(m);
      }
    }

    actions.sort((a, b) => a.priority - b.priority);

    return {
      heroMeeting: active[0] ?? upcomingList[0] ?? null,
      actionItems: actions.slice(0, 6),
      upcoming: upcomingList,
      minutesReview: review,
      counts: computeLifecycleCounts(meetingRows),
    };
  }, [meetingRows, today, thirtyDaysOut, pendingMinutesMeetingIds, townState]);

  const handleTourComplete = () => {
    setTourActive(false);
    setSearchParams({}, { replace: true });
  };

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {tourActive && <QuickTour onComplete={handleTourComplete} />}

      {isWelcome && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">
          <p className="font-medium">Welcome! Your town is set up.</p>
          <p className="mt-1 text-green-700 dark:text-green-300">
            This is your home base for running meetings. Below you can see your meeting pipeline and
            what needs doing next.
          </p>
        </div>
      )}

      {/* town.detail failed after mount (conventions item 5/12) — small and
          non-blocking, matching this read's own weight on this screen: see
          the query's own doc comment for why this is not a full-page
          replacement the way settings.town.tsx's is. */}
      {isTownError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p>Couldn't load your town's profile. Try reloading the page.</p>
        </div>
      )}

      {/* Identity + primary action */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{townName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run your meetings from notice to published minutes.
          </p>
        </div>
        {canCreateMeeting && (
          <Button onClick={() => setBoardPickerOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Schedule meeting
          </Button>
        )}
      </div>

      {/* The meeting list failed after mount (conventions item 5/12). Unlike
          the town-header banner above, this one replaces the pipeline rather
          than sitting beside it: every section below is computed from
          `meetingRows`, so rendering them from an empty array would show an
          empty, healthy-looking landing for a town that may have a meeting
          starting in an hour — the exact silent failure this phase exists to
          end. */}
      {isMeetingsError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
        >
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 font-medium text-destructive">Couldn't load your meetings.</p>
          <p className="mt-1 text-sm text-destructive/80">
            Try reloading the page. If the problem continues, contact support.
          </p>
        </div>
      ) : meetingsLoading ? (
        <MeetingListSkeleton rows={4} />
      ) : (
        <>
          {/* Lifecycle pipeline — the "what this app does" spine (ops view) */}
          {!isBoardMember && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Your meeting pipeline
              </h2>
              <MeetingLifecycle counts={counts} />
            </section>
          )}

          {/* Next meeting hero */}
          {heroMeeting && <NextMeetingHero meeting={heroMeeting} />}

          {/* Needs action (ops view) */}
          {!isBoardMember && actionItems.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Needs your attention
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {actionItems.map((item) => (
                  <NeedsActionCard key={`${item.meeting.id}-${item.actionLabel}`} item={item} />
                ))}
              </div>
            </section>
          )}

          {/* Minutes awaiting review (board member view) */}
          {isBoardMember && minutesReview.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Minutes for your review
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {minutesReview.map((m) => (
                  <Card key={m.id} className="transition-colors hover:bg-accent/50">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{m.board_name}</p>
                        <p className="truncate text-sm text-muted-foreground">{m.title}</p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/meetings/${m.id}/review`}>Review</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Upcoming */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Upcoming (next 30 days)
              </h2>
              <Link
                to="/meetings"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                All meetings
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <div className="rounded-lg border bg-card p-8 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 font-medium">No upcoming meetings</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canCreateMeeting
                    ? "Schedule your first meeting to get started — pick a board and set a date."
                    : "Meetings your boards schedule will appear here."}
                </p>
                {canCreateMeeting && (
                  <Button className="mt-4" size="sm" onClick={() => setBoardPickerOpen(true)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Schedule meeting
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                        Date
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                        Meeting
                      </th>
                      <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground sm:table-cell">
                        Board
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((m) => (
                      <UpcomingRow key={m.id} meeting={m} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Board picker */}
      <Dialog open={boardPickerOpen} onOpenChange={setBoardPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which board is meeting?</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {boardRows.map((board) => (
              <button
                key={board.id}
                type="button"
                onClick={() => handleBoardSelect(board)}
                className="w-full rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-accent"
              >
                {board.name}
              </button>
            ))}
            {boardRows.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No active boards yet. Add a board first.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {selectedBoard && (
        <CreateMeetingDialog
          boardId={selectedBoard.id}
          boardName={selectedBoard.name}
          open={!!selectedBoard}
          onOpenChange={(open) => {
            if (!open) setSelectedBoard(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Next meeting hero ──────────────────────────────────────────────

function NextMeetingHero({ meeting }: { meeting: MeetingRow }) {
  const status = meeting.status;
  // `"in_progress"`: inert, see this file's header.
  const isLive = status === "open" || status === "in_progress";
  const action = primaryAction(status, meeting.id);
  const elapsed =
    meeting.started_at && isLive
      ? Math.floor((Date.now() - new Date(meeting.started_at).getTime()) / 60_000)
      : null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {isLive ? "Happening now" : "Next meeting"}
      </h2>
      <Card
        className={
          isLive ? "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20" : undefined
        }
      >
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isLive && <Radio className="h-4 w-4 animate-pulse text-red-600 dark:text-red-400" />}
              <span className="font-semibold">{meeting.board_name}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${MEETING_STATUS_COLORS[status] ?? ""}`}
              >
                {MEETING_STATUS_LABELS[status] ?? status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{meeting.title}</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {meeting.scheduled_date ? formatDate(meeting.scheduled_date) : "—"}
              {meeting.scheduled_time && ` · ${formatTime(meeting.scheduled_time)}`}
              {elapsed !== null && elapsed >= 0 && ` · started ${elapsed} min ago`}
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <Button asChild>
              <Link to={action.to}>
                {action.label}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/meetings/${meeting.id}/agenda`}>Agenda</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Needs action card ──────────────────────────────────────────────

function NeedsActionCard({ item }: { item: ActionItem }) {
  const Icon = item.icon;
  return (
    <Card className="transition-colors hover:bg-accent/50">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{item.meeting.board_name}</p>
            <p className="truncate text-sm text-muted-foreground">{item.meeting.title}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              {(item.priority <= 1 || item.reason.includes("Notice due")) && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              )}
              <span className="text-xs text-muted-foreground">{item.reason}</span>
            </div>
            <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
              <Link to={item.actionPath}>
                {item.actionLabel}
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Upcoming row ───────────────────────────────────────────────────

function UpcomingRow({ meeting }: { meeting: MeetingRow }) {
  const status = meeting.status;
  const date = meeting.scheduled_date;
  const time = meeting.scheduled_time ?? "";
  const action = primaryAction(status, meeting.id);

  return (
    <tr className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
      <td className="whitespace-nowrap px-4 py-3">
        <div className="font-medium">{date ? formatDate(date) : "—"}</div>
        {time && <div className="text-xs text-muted-foreground">{formatTime(time)}</div>}
      </td>
      <td className="px-4 py-3">
        <Link to={`/meetings/${meeting.id}/agenda`} className="font-medium hover:underline">
          {meeting.title}
        </Link>
        <div className="text-xs text-muted-foreground sm:hidden">{meeting.board_name}</div>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {/* `board_id` is NOT NULL on `meeting` and `meeting.byTown` INNER
            JOINs `board`, so the "no board" fallback the PostgREST embed
            needed has nothing left to represent. */}
        <Link
          to={`/boards/${meeting.board_id}`}
          className="transition-colors hover:text-foreground"
        >
          {meeting.board_name}
        </Link>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${MEETING_STATUS_COLORS[status] ?? ""}`}
        >
          {MEETING_STATUS_LABELS[status] ?? status}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <Button variant="ghost" size="sm" asChild>
          <Link to={action.to}>
            {action.label}
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </td>
    </tr>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
