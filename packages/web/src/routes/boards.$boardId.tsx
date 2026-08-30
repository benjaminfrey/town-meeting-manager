/**
 * BoardDetailPage — /boards/:boardId route
 *
 * Tabbed layout: Overview | Members | Meetings | Templates | Settings
 * Tab state is URL-based (?tab=overview etc.) for direct linking.
 */

import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import {
  ChevronRight,
  Pencil,
  Archive,
  CalendarDays,
  AlertTriangle,
  FileText,
  Settings,
  Users,
  LayoutGrid,
  Play,
} from "lucide-react";
import { calculateQuorum, getEffectiveBoardSettings } from "@town-meeting/shared";
import type { Route } from "./+types/boards.$boardId";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { EditBoardDialog } from "@/components/boards/EditBoardDialog";
import { ArchiveBoardDialog } from "@/components/boards/ArchiveBoardDialog";
import { MemberRoster } from "@/components/boards/MemberRoster";
import { NoticeTemplateEditor } from "@/components/boards/NoticeTemplateEditor";
import { MinutesWorkflowEditor } from "@/components/boards/MinutesWorkflowEditor";
import type { NoticeTemplateBlock } from "@town-meeting/shared";
import {
  FORMALITY_LABELS,
  MINUTES_STYLE_LABELS,
  QUORUM_TYPE_LABELS,
  MOTION_FORMAT_LABELS,
  ELECTION_METHOD_LABELS,
  OFFICER_ELECTION_LABELS,
} from "@/components/boards/board-labels";
import { MEETING_STATUS_LABELS, MEETING_STATUS_COLORS } from "@/components/meetings/meeting-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
// TODO(phase-e-wave-2): town.detail, agendaTemplate.countForBoard
//
// The marker above is the machine-checkable half of this comment, and it is
// the point: a ten-line explanation is invisible to
// `grep -rn "TODO(phase-e-wave" packages/web/src`, so a completeness sweep
// over 66 remaining Supabase importers would read this file as finished.
//
// `supabase` is still needed for two reads this task does not migrate: town
// settings (used for the Overview "effective settings" rows, and passed down
// as defaults to EditBoardDialog / MinutesWorkflowEditor) and the agenda
// template count. Neither has a tRPC procedure yet — there is no `town.detail`
// or `agendaTemplate` router in `packages/api/src/trpc/routers/` today, only
// `board` and the narrow `town.portalAddress`/`town.setPortalAddress` pair.
// Dropping these reads instead of leaving them on Supabase would be a real
// feature regression (silently losing the effective-settings display and the
// template count), which is worse than the migration being incomplete. Wave 2
// adds those routers and finishes this file.
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ─── Helper ──────────────────────────────────────────────────────────

function InfoRow({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[160px] text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">
        {value}
        {suffix && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">— {suffix}</span>
        )}
      </span>
    </div>
  );
}

function formatMeetingDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Tab types ────────────────────────────────────────────────────────

type TabId = "overview" | "members" | "meetings" | "templates" | "settings";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "members", label: "Members", icon: Users },
  { id: "meetings", label: "Meetings", icon: CalendarDays },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const boardId = params.boardId;

  // Not wrapped in try/catch: a nonexistent or foreign board answers
  // NOT_FOUND (see `board.detail`'s doc comment), and letting that reject the
  // loader routes to `RouteErrorBoundary` below — visible, not the indefinite
  // "Loading board..." spinner the old `select("*").limit(1)` produced for
  // the same case (an empty array is neither an error nor a board).
  await queryClient.ensureQueryData(trpc.board.detail.queryOptions({ boardId }));

  return { boardId };
}

export default function BoardDetailPage({ loaderData }: Route.ComponentProps) {
  const { boardId } = loaderData;
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId) ?? "overview";

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // ─── Queries ──────────────────────────────────────────────────────

  // `boardRows`/`activeMemberCount`/`meetingCount`/`recentMeetings` above
  // were four Supabase reads; `board.detail` + `board.stats` +
  // `board.recentMeetings` are the three tRPC procedures that replace them
  // (the two count queries collapse into `stats`). tRPC supplies its own
  // query keys, so `queryKeys.boards.detail` etc. are no longer used for
  // these three — but they stay in `lib/queryKeys.ts` and are NOT deleted:
  // `EditBoardDialog`, `ArchiveBoardDialog`, `NoticeTemplateEditor`,
  // `MinutesWorkflowEditor` and roughly a dozen other route/component files
  // still key their own Supabase reads and cache invalidations off them.
  const {
    data: board,
    isLoading: isBoardLoading,
    isError: isBoardError,
    error: boardError,
  } = useQuery(trpc.board.detail.queryOptions({ boardId }));

  const { data: stats } = useQuery(trpc.board.stats.queryOptions({ boardId }));

  const { data: recentMeetings = [] } = useQuery({
    ...trpc.board.recentMeetings.queryOptions({ boardId, limit: 5 }),
    enabled: activeTab === "meetings",
  });

  const { data: townRows } = useQuery({
    queryKey: queryKeys.towns.detail(townId ?? ""),
    queryFn: async () => {
      const { data } = await supabase
        .from("town")
        .select("*")
        .eq("id", townId!)
        .limit(1)
        .throwOnError();
      return data ?? [];
    },
    enabled: !!townId,
  });

  const { data: templateCount } = useQuery({
    queryKey: [...queryKeys.agendaTemplates.byBoard(boardId), "count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("agenda_template")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId)
        .throwOnError();
      return count ?? 0;
    },
  });

  const town = townRows?.[0] as Record<string, unknown> | undefined;
  const memberCount = stats?.active_members ?? 0;
  const mtgCount = stats?.meetings ?? 0;
  const tmplCount = templateCount ?? 0;

  // A screen that renders nothing and says nothing for a bad boardId is the
  // failure mode this migration exists to end — so a rejected `board.detail`
  // (most commonly NOT_FOUND: deleted, or another town's board) gets a
  // visible, `role="alert"` state of its own, distinct from "still loading."
  if (isBoardError) {
    const notFound = isTRPCClientError(boardError) && boardError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This board could not be found."
              : "Something went wrong loading this board."}
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

  if (isBoardLoading || !board) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading board...</p>
      </div>
    );
  }

  const b = {
    id: board.id,
    name: board.name,
    elected_or_appointed: board.elected_or_appointed ?? "elected",
    member_count: board.member_count ?? 0,
    election_method: board.election_method ?? "at_large",
    officer_election_method: board.officer_election_method ?? "vote_of_board",
    is_governing_board: board.is_governing_board,
    meeting_formality_override: board.meeting_formality_override,
    minutes_style_override: board.minutes_style_override,
    quorum_type: board.quorum_type ?? "simple_majority",
    quorum_value: board.quorum_value,
    motion_display_format: board.motion_display_format ?? "inline_narrative",
    archived_at: board.archived_at,
    created_at: board.created_at,
  };

  const isArchived = !!b.archived_at;

  const effective = town
    ? getEffectiveBoardSettings(
        {
          meeting_formality_override: b.meeting_formality_override,
          minutes_style_override: b.minutes_style_override,
        },
        {
          meeting_formality: String(town.meeting_formality ?? "informal"),
          minutes_style: String(town.minutes_style ?? "summary"),
        },
      )
    : null;

  const quorumRequired = calculateQuorum(
    b.member_count,
    b.quorum_type as "simple_majority" | "two_thirds" | "three_quarters" | "fixed_number",
    b.quorum_value,
  );

  const setTab = (tab: TabId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });
  };

  return (
    <div className="p-6">
      {/* Dialogs */}
      {editOpen && (
        <EditBoardDialog
          townId={townId ?? ""}
          town={town}
          board={board}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      {archiveOpen && (
        <ArchiveBoardDialog
          board={board}
          townId={townId ?? ""}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
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
        <span className="text-foreground font-medium">{b.name}</span>
      </nav>

      {/* Archived banner */}
      {isArchived && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              This board was archived on{" "}
              {new Date(b.archived_at!).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      )}

      {/* Board header — always visible above tabs */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{b.name}</h1>
            {b.is_governing_board && <Badge variant="outline">Governing</Badge>}
            {isArchived ? (
              <Badge variant="secondary">Archived</Badge>
            ) : (
              <Badge className="bg-green-600 text-white hover:bg-green-600">Active</Badge>
            )}
          </div>
          <p className="mt-1 text-muted-foreground capitalize">{b.elected_or_appointed} board</p>
        </div>
        {!isArchived && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Board
            </Button>
            <Button variant="outline" onClick={() => setArchiveOpen(true)}>
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="mb-6 border-b">
        <nav className="-mb-px flex gap-0" aria-label="Board sections">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-6 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Board Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow
                label="Type"
                value={b.elected_or_appointed === "appointed" ? "Appointed" : "Elected"}
              />
              <InfoRow label="Members" value={`${memberCount} active / ${b.member_count} seats`} />
              <InfoRow
                label="Quorum"
                value={`${quorumRequired} of ${b.member_count}`}
                suffix={QUORUM_TYPE_LABELS[b.quorum_type] ?? b.quorum_type}
              />
              <InfoRow
                label="Election method"
                value={ELECTION_METHOD_LABELS[b.election_method] ?? b.election_method}
              />
              <InfoRow
                label="Officer election"
                value={
                  OFFICER_ELECTION_LABELS[b.officer_election_method] ?? b.officer_election_method
                }
              />
              {effective && (
                <>
                  <InfoRow
                    label="Formality"
                    value={FORMALITY_LABELS[effective.formality] ?? effective.formality}
                    suffix={
                      effective.formalitySource === "board_override"
                        ? "board override"
                        : "town default"
                    }
                  />
                  <InfoRow
                    label="Minutes style"
                    value={MINUTES_STYLE_LABELS[effective.minutesStyle] ?? effective.minutesStyle}
                    suffix={
                      effective.minutesStyleSource === "board_override"
                        ? "board override"
                        : "town default"
                    }
                  />
                </>
              )}
              <InfoRow
                label="Motion format"
                value={MOTION_FORMAT_LABELS[b.motion_display_format] ?? b.motion_display_format}
              />
            </CardContent>
          </Card>

          {/* Quick links */}
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setTab("members")}
              className="rounded-lg border bg-card p-4 text-left shadow-sm hover:bg-muted/50 transition-colors"
            >
              <Users className="h-5 w-5 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">
                {memberCount} member{memberCount !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground">View roster →</p>
            </button>
            <button
              type="button"
              onClick={() => setTab("meetings")}
              className="rounded-lg border bg-card p-4 text-left shadow-sm hover:bg-muted/50 transition-colors"
            >
              <CalendarDays className="h-5 w-5 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">
                {mtgCount} meeting{mtgCount !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground">View meetings →</p>
            </button>
            <button
              type="button"
              onClick={() => setTab("templates")}
              className="rounded-lg border bg-card p-4 text-left shadow-sm hover:bg-muted/50 transition-colors"
            >
              <FileText className="h-5 w-5 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">
                {tmplCount} template{tmplCount !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground">View templates →</p>
            </button>
          </div>
        </div>
      )}

      {activeTab === "members" && (
        <MemberRoster
          boardId={b.id}
          boardName={b.name}
          electionMethod={b.election_method}
          townId={townId ?? ""}
          isArchived={isArchived}
        />
      )}

      {activeTab === "meetings" && (
        <div className="space-y-4 max-w-4xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {mtgCount} meeting{mtgCount !== 1 ? "s" : ""} total
            </p>
            <Link to={`/boards/${b.id}/meetings`}>
              <Button variant="outline" size="sm">
                <CalendarDays className="mr-2 h-4 w-4" />
                Manage Meetings
              </Button>
            </Link>
          </div>

          {recentMeetings.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center">
              <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No meetings yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Schedule a meeting from the Manage Meetings page.
              </p>
              <Link to={`/boards/${b.id}/meetings`}>
                <Button variant="outline" size="sm" className="mt-3">
                  Schedule Meeting
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentMeetings.map((m) => {
                    const status = String(m.status ?? "draft");
                    const isActive = status === "open";
                    return (
                      <tr
                        key={m.id}
                        className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          {m.scheduled_date ? formatMeetingDate(String(m.scheduled_date)) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/meetings/${m.id}/agenda`}
                            className="font-medium text-primary hover:underline"
                          >
                            {String(m.title ?? "")}
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
                          <div className="flex items-center justify-end gap-1">
                            {isActive && (
                              <Link to={`/meetings/${m.id}/live`}>
                                <Button variant="ghost" size="sm">
                                  <Play className="mr-1 h-3.5 w-3.5" />
                                  Run
                                </Button>
                              </Link>
                            )}
                            <Link to={`/meetings/${m.id}/agenda`}>
                              <Button variant="ghost" size="sm">
                                View
                              </Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {mtgCount > 5 && (
                <div className="border-t px-4 py-3">
                  <Link
                    to={`/boards/${b.id}/meetings`}
                    className="text-sm text-primary hover:underline"
                  >
                    View all {mtgCount} meetings →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "templates" && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {tmplCount} template{tmplCount !== 1 ? "s" : ""} configured
            </p>
            <Link to={`/boards/${b.id}/templates`}>
              <Button variant="outline" size="sm">
                <FileText className="mr-2 h-4 w-4" />
                Manage Templates
              </Button>
            </Link>
          </div>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Agenda templates define the default structure for meetings of this board. Use the
                Manage Templates page to create and edit templates.
              </p>
              <Link to={`/boards/${b.id}/templates`} className="mt-3 block">
                <Button variant="outline">Open Template Manager</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="space-y-6 max-w-3xl">
          <NoticeTemplateEditor
            boardId={b.id}
            initialBlocks={
              (board.notice_template_blocks as unknown as NoticeTemplateBlock[]) ?? null
            }
          />

          <MinutesWorkflowEditor
            boardId={b.id}
            initialValues={{
              minutes_consent_agenda: (board.minutes_consent_agenda as boolean) ?? false,
              minutes_requires_second: (board.minutes_requires_second as boolean) ?? true,
              r4_board_member_default: (board.r4_board_member_default as boolean) ?? true,
              audio_retention_policy_override:
                (board.audio_retention_policy_override as string | null) ?? null,
              auto_publish_on_approval_override:
                (board.auto_publish_on_approval_override as boolean | null) ?? null,
            }}
            townDefaults={{
              audio_retention_policy: (town?.audio_retention_policy as string) ?? "retain_30_days",
              auto_publish_on_approval: (town?.auto_publish_on_approval as boolean) ?? false,
            }}
          />
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
