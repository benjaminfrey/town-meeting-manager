/**
 * BoardDetailPage — /boards/:boardId route
 *
 * Shows board info, member roster (placeholder), and meeting history (placeholder).
 * Includes edit and archive actions.
 */

import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Pencil,
  Archive,
  CalendarDays,
  AlertTriangle,
  FileText,
} from "lucide-react";
import {
  calculateQuorum,
  getEffectiveBoardSettings,
} from "@town-meeting/shared";
import type { Route } from "./+types/boards.$boardId";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { EditBoardDialog } from "@/components/boards/EditBoardDialog";
import { ArchiveBoardDialog } from "@/components/boards/ArchiveBoardDialog";
import { MemberRoster } from "@/components/boards/MemberRoster";
import {
  FORMALITY_LABELS,
  MINUTES_STYLE_LABELS,
  QUORUM_TYPE_LABELS,
  MOTION_FORMAT_LABELS,
  ELECTION_METHOD_LABELS,
  OFFICER_ELECTION_LABELS,
} from "@/components/boards/board-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";

// ─── Helper ──────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[160px] text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">
        {value}
        {suffix && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            — {suffix}
          </span>
        )}
      </span>
    </div>
  );
}

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const boardId = params.boardId;

  // Prefetch board detail
  await queryClient.ensureQueryData({
    queryKey: queryKeys.boards.detail(boardId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("*")
        .eq("id", boardId)
        .limit(1)
        .throwOnError();
      return data ?? [];
    },
  });

  return { boardId };
}

export default function BoardDetailPage({ loaderData }: Route.ComponentProps) {
  const { boardId } = loaderData;
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // ─── Reactive queries ─────────────────────────────────────────────
  const { data: boardRows } = useQuery({
    queryKey: queryKeys.boards.detail(boardId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("*")
        .eq("id", boardId)
        .limit(1)
        .throwOnError();
      return data ?? [];
    },
  });

  const { data: activeMemberCount } = useQuery({
    queryKey: [...queryKeys.members.byBoard(boardId), "active-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("board_member")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId)
        .eq("status", "active")
        .throwOnError();
      return count ?? 0;
    },
  });

  const { data: meetingCount } = useQuery({
    queryKey: [...queryKeys.meetings.byBoard(boardId), "count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("meeting")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId)
        .throwOnError();
      return count ?? 0;
    },
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

  const board = boardRows?.[0] as Record<string, unknown> | undefined;
  const town = townRows?.[0] as Record<string, unknown> | undefined;
  const memberCount = activeMemberCount ?? 0;
  const mtgCount = meetingCount ?? 0;
  const tmplCount = templateCount ?? 0;

  // ─── Loading / not found ──────────────────────────────────────────
  if (!board) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading board...</p>
      </div>
    );
  }

  // Cast board fields — Supabase returns native booleans
  const b = {
    id: String(board.id),
    name: String(board.name ?? ""),
    elected_or_appointed: String(board.elected_or_appointed ?? "elected"),
    member_count: Number(board.member_count ?? 0),
    election_method: String(board.election_method ?? "at_large"),
    officer_election_method: String(board.officer_election_method ?? "vote_of_board"),
    is_governing_board: board.is_governing_board === true,
    meeting_formality_override: (board.meeting_formality_override as string) || null,
    minutes_style_override: (board.minutes_style_override as string) || null,
    quorum_type: (board.quorum_type as string) || "simple_majority",
    quorum_value: board.quorum_value != null ? Number(board.quorum_value) : null,
    motion_display_format: String(board.motion_display_format ?? "inline_narrative"),
    archived_at: (board.archived_at as string) || null,
    created_at: String(board.created_at ?? ""),
  };

  const isArchived = !!b.archived_at;

  // Effective settings
  const effective = town
    ? getEffectiveBoardSettings(
        { meeting_formality_override: b.meeting_formality_override, minutes_style_override: b.minutes_style_override },
        { meeting_formality: String(town.meeting_formality ?? "informal"), minutes_style: String(town.minutes_style ?? "summary") }
      )
    : null;

  // Quorum
  const quorumRequired = calculateQuorum(
    b.member_count,
    b.quorum_type as "simple_majority" | "two_thirds" | "three_quarters" | "fixed_number",
    b.quorum_value,
  );

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

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{b.name}</h1>
            {b.is_governing_board && (
              <Badge variant="outline">Governing</Badge>
            )}
            {isArchived ? (
              <Badge variant="secondary">Archived</Badge>
            ) : (
              <Badge className="bg-green-600 text-white hover:bg-green-600">Active</Badge>
            )}
          </div>
          <p className="mt-1 text-muted-foreground capitalize">
            {b.elected_or_appointed} board
          </p>
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

      <div className="space-y-6">
        {/* Board Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Board Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Type" value={b.elected_or_appointed === "appointed" ? "Appointed" : "Elected"} />
            <InfoRow label="Members" value={`${memberCount} active / ${b.member_count} seats`} />
            <InfoRow
              label="Quorum"
              value={`${quorumRequired} of ${b.member_count}`}
              suffix={QUORUM_TYPE_LABELS[b.quorum_type] ?? b.quorum_type}
            />
            <InfoRow label="Election method" value={ELECTION_METHOD_LABELS[b.election_method] ?? b.election_method} />
            <InfoRow label="Officer election" value={OFFICER_ELECTION_LABELS[b.officer_election_method] ?? b.officer_election_method} />
            {effective && (
              <>
                <InfoRow
                  label="Formality"
                  value={FORMALITY_LABELS[effective.formality] ?? effective.formality}
                  suffix={effective.formalitySource === "board_override" ? "board override" : "town default"}
                />
                <InfoRow
                  label="Minutes style"
                  value={MINUTES_STYLE_LABELS[effective.minutesStyle] ?? effective.minutesStyle}
                  suffix={effective.minutesStyleSource === "board_override" ? "board override" : "town default"}
                />
              </>
            )}
            <InfoRow
              label="Motion format"
              value={MOTION_FORMAT_LABELS[b.motion_display_format] ?? b.motion_display_format}
            />
          </CardContent>
        </Card>

        {/* Member Roster */}
        <MemberRoster
          boardId={b.id}
          boardName={b.name}
          electionMethod={b.election_method}
          townId={townId ?? ""}
          isArchived={isArchived}
        />

        {/* Agenda Templates */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Agenda Templates</CardTitle>
                <CardDescription>
                  {tmplCount} template{tmplCount !== 1 ? "s" : ""}
                </CardDescription>
              </div>
              <Link to={`/boards/${b.id}/templates`}>
                <Button variant="outline" size="sm">
                  <FileText className="mr-2 h-4 w-4" />
                  Manage Templates
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>

        {/* Meetings */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Meetings</CardTitle>
                <CardDescription>
                  {mtgCount} meeting{mtgCount !== 1 ? "s" : ""}
                </CardDescription>
              </div>
              <Link to={`/boards/${b.id}/meetings`}>
                <Button variant="outline" size="sm">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  Manage Meetings
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
