/**
 * Home (/) — the self-explanatory landing.
 *
 * States what the app is, makes the meeting lifecycle visible, leads with the
 * next meeting, and surfaces what needs doing. Role-aware: admin/staff see the
 * full operations view; board members see a lighter review-oriented view.
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
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  MEETING_STATUS_LABELS,
  MEETING_STATUS_COLORS,
} from "@/components/meetings/meeting-labels";
import {
  MeetingLifecycle,
  computeLifecycleCounts,
} from "@/components/MeetingLifecycle";
import { QuickTour, useShouldShowTour } from "@/components/QuickTour";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { MeetingListSkeleton } from "@/components/skeletons";
import { CreateMeetingDialog } from "@/components/meetings/CreateMeetingDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface MeetingRow {
  id: string;
  title: string;
  status: string;
  meeting_type: string;
  scheduled_date: string;
  scheduled_time: string | null;
  started_at: string | null;
  board: { id: string; name: string } | null;
  town_id: string;
  [key: string]: unknown;
}

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

  const { data: meetingRows = [], isLoading: meetingsLoading } = useQuery({
    queryKey: queryKeys.meetings.byTown(townId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting")
        .select("*, board:board_id(id, name)")
        .eq("town_id", townId)
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MeetingRow[];
    },
    enabled: !!townId,
  });

  const { data: townRows } = useQuery({
    queryKey: queryKeys.towns.detail(townId),
    queryFn: async () => {
      const { data } = await supabase
        .from("town")
        .select("*")
        .eq("id", townId)
        .limit(1)
        .throwOnError();
      return data ?? [];
    },
    enabled: !!townId,
  });

  const { data: minutesDocs = [] } = useQuery({
    queryKey: [...queryKeys.minutes.byMeeting("__home_pending__"), townId],
    queryFn: async () => {
      const { data } = await supabase
        .from("minutes_document")
        .select("meeting_id, status")
        .eq("town_id", townId)
        .in("status", ["draft", "review"])
        .throwOnError();
      return (data ?? []) as Array<{ meeting_id: string; status: string }>;
    },
    enabled: !!townId,
  });

  const { data: boardRows = [] } = useQuery({
    queryKey: queryKeys.boards.byTown(townId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("id, name")
        .eq("town_id", townId)
        .is("archived_at", null)
        .order("name")
        .throwOnError();
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: !!townId && canCreateMeeting,
  });

  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handleBoardSelect = useCallback(
    (board: { id: string; name: string }) => {
      setBoardPickerOpen(false);
      setSelectedBoard(board);
    },
    [],
  );

  const town = townRows?.[0] as Record<string, unknown> | undefined;
  const townName = (town?.name as string) ?? "Your town";
  const townState = (town?.state as string) ?? "ME";

  // ─── Compute sections ─────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const pendingMinutesMeetingIds = new Set(minutesDocs.map((d) => d.meeting_id));

  const { heroMeeting, actionItems, upcoming, minutesReview, counts } =
    useMemo(() => {
      const active: MeetingRow[] = [];
      const actions: ActionItem[] = [];
      const upcomingList: MeetingRow[] = [];
      const review: MeetingRow[] = [];

      for (const m of meetingRows) {
        const date = m.scheduled_date ?? "";
        const status = m.status ?? "";

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
          const showAction =
            daysAway <= 7 || (deadlineDays !== null && deadlineDays <= 2);
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

        if (
          date >= today &&
          date <= thirtyDaysOut &&
          !["approved", "published"].includes(status)
        ) {
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
            This is your home base for running meetings. Below you can see your
            meeting pipeline and what needs doing next.
          </p>
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

      {meetingsLoading ? (
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
                  <NeedsActionCard
                    key={`${item.meeting.id}-${item.actionLabel}`}
                    item={item}
                  />
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
                  <Card
                    key={m.id}
                    className="transition-colors hover:bg-accent/50"
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.board?.name ?? "Meeting"}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {m.title}
                        </p>
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
                  <Button
                    className="mt-4"
                    size="sm"
                    onClick={() => setBoardPickerOpen(true)}
                  >
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
          townId={townId}
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
  const status = meeting.status ?? "draft";
  const isLive = status === "open" || status === "in_progress";
  const action = primaryAction(status, meeting.id);
  const elapsed =
    meeting.started_at && isLive
      ? Math.floor(
          (Date.now() - new Date(meeting.started_at).getTime()) / 60_000,
        )
      : null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {isLive ? "Happening now" : "Next meeting"}
      </h2>
      <Card
        className={
          isLive
            ? "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
            : undefined
        }
      >
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isLive && (
                <Radio className="h-4 w-4 animate-pulse text-red-600 dark:text-red-400" />
              )}
              <span className="font-semibold">
                {meeting.board?.name ?? "Meeting"}
              </span>
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
              {meeting.scheduled_time &&
                ` · ${formatTime(meeting.scheduled_time)}`}
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
            <p className="truncate font-medium">
              {item.meeting.board?.name ?? "Meeting"}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {item.meeting.title}
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              {(item.priority <= 1 || item.reason.includes("Notice due")) && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              )}
              <span className="text-xs text-muted-foreground">
                {item.reason}
              </span>
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
  const status = meeting.status ?? "draft";
  const date = meeting.scheduled_date ?? "";
  const time = meeting.scheduled_time ?? "";
  const action = primaryAction(status, meeting.id);

  return (
    <tr className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
      <td className="whitespace-nowrap px-4 py-3">
        <div className="font-medium">{date ? formatDate(date) : "—"}</div>
        {time && (
          <div className="text-xs text-muted-foreground">
            {formatTime(time)}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/meetings/${meeting.id}/agenda`}
          className="font-medium hover:underline"
        >
          {meeting.title}
        </Link>
        <div className="text-xs text-muted-foreground sm:hidden">
          {meeting.board?.name ?? ""}
        </div>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {meeting.board ? (
          <Link
            to={`/boards/${meeting.board.id}`}
            className="transition-colors hover:text-foreground"
          >
            {meeting.board.name}
          </Link>
        ) : (
          "—"
        )}
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
