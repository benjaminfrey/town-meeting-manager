/**
 * BoardListPage — /boards route
 *
 * Lists all boards and committees for the current town.
 * Supports add, edit, archive actions and show/hide archived toggle.
 *
 * Wave 2, Task 2 — this route's three Supabase reads (`board`, active
 * `board_member` counts grouped by board, `town`) move onto
 * `trpc.board.list` (extended this task to carry the columns and per-board
 * `active_member_count` this screen needs — see that procedure's own doc
 * comment) and `trpc.town.detail`. `board.list` is deliberately unfiltered
 * (this screen's own "show archived" toggle needs archived boards in the
 * data it already has), ordered `name` only; the governing-board-first order
 * this screen wants is sorted client-side below, matching `listActive`'s own
 * doc comment's reasoning for `StaffAccountFlow.tsx` — changing `list`'s own
 * ORDER BY would reorder it out from under its other two callers
 * (`settings.meeting-notices.tsx`, `ProgressChecklist.tsx`).
 *
 * `EditBoardDialog`/`ArchiveBoardDialog` both need a board's FULL settings
 * (`election_method`, `quorum_type`, etc.) — columns `list`'s narrower,
 * town-wide scan does not carry, and should not: `list` runs on every visit
 * to this page and on the dashboard (`ProgressChecklist`), so it stays cheap
 * rather than growing to `detail`'s ~20 columns for the sake of an action a
 * caller may never take. Opening either dialog instead fetches
 * `trpc.board.detail` for just that one board id — the identical procedure
 * `boards.$boardId.tsx` already uses, so a dialog opened here warms the same
 * cache entry a follow-up visit to that board's own page would read.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, Pencil, Archive, Loader2 } from "lucide-react";
import type { Route } from "./+types/boards";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { AddBoardDialog } from "@/components/boards/AddBoardDialog";
import { EditBoardDialog } from "@/components/boards/EditBoardDialog";
import { ArchiveBoardDialog } from "@/components/boards/ArchiveBoardDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc";
import { BoardListSkeleton } from "@/components/skeletons";

export async function clientLoader() {
  return {};
}

/** A row's actionable identity: which board, and which dialog it opens. */
interface SelectedBoard {
  id: string;
  mode: "edit" | "archive";
}

export default function BoardListPage(_props: Route.ComponentProps) {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;

  const [showArchived, setShowArchived] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedBoard | null>(null);
  /**
   * Set when the on-demand `board.detail` fetch below rejects. Without this,
   * a rejected fetch left `isPending` (derived from `selected && !selectedBoard`)
   * true forever -- the Edit/Archive button spun with nothing said, since
   * neither `selected` nor `selectedBoard` ever changed on their own.
   */
  const [selectedBoardError, setSelectedBoardError] = useState<string | null>(null);

  // ─── Reactive queries ─────────────────────────────────────────────
  const {
    data: boardRows,
    isLoading: boardsLoading,
    isError: boardsError,
  } = useQuery(trpc.board.list.queryOptions());

  const { data: town } = useQuery({ ...trpc.town.detail.queryOptions(), enabled: !!townId });

  // Full settings for whichever single board a dialog is about to open for —
  // see this file's own header comment for why this is not folded into
  // `board.list` above.
  const { data: selectedBoard, isError: isSelectedBoardError } = useQuery({
    ...trpc.board.detail.queryOptions({ boardId: selected?.id ?? "" }),
    enabled: !!selected,
  });

  useEffect(() => {
    if (isSelectedBoardError && selected) {
      setSelectedBoardError(
        selected.mode === "edit"
          ? "Could not load this board to edit it. Try again."
          : "Could not load this board to archive it. Try again.",
      );
      setSelected(null);
    }
  }, [isSelectedBoardError, selected]);

  // Sort governing board first, then alphabetically — matching the Supabase
  // query this replaces exactly (see this file's header comment for why the
  // sort happens here rather than in `board.list` itself).
  const sortedBoards = useMemo(() => {
    const rows = boardRows ?? [];
    return [...rows].sort((a, b) => {
      if (a.is_governing_board !== b.is_governing_board) {
        return a.is_governing_board ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [boardRows]);

  const boards = useMemo(() => {
    if (showArchived) return sortedBoards;
    return sortedBoards.filter((b) => !b.archived_at);
  }, [sortedBoards, showArchived]);

  const archivedCount = useMemo(
    () => sortedBoards.filter((b) => b.archived_at).length,
    [sortedBoards],
  );

  // A screen that renders nothing and says nothing for a failed read is the
  // failure mode this migration exists to end (conventions item 5).
  if (boardsError) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
          <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
            <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">
              Something went wrong loading your town's boards.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try reloading the page. If the problem continues, contact support.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading state ────────────────────────────────────────────────
  if (!townId || boardsLoading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <div className="h-8 w-48 rounded-md bg-muted animate-pulse" />
          <div className="mt-1 h-4 w-72 rounded-md bg-muted animate-pulse" />
        </div>
        <BoardListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Dialogs */}
      <AddBoardDialog
        townId={townId}
        town={town}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
      {selected?.mode === "edit" && selectedBoard && (
        <EditBoardDialog
          townId={townId}
          town={town}
          board={selectedBoard}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      )}
      {selected?.mode === "archive" && selectedBoard && (
        <ArchiveBoardDialog
          board={selectedBoard}
          townId={townId}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Boards & Committees</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your town's boards, committees, and commissions
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Board
        </Button>
      </div>

      {selectedBoardError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {selectedBoardError}
        </div>
      )}

      {/* Show archived toggle */}
      {archivedCount > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived" className="text-sm text-muted-foreground">
            Show archived ({archivedCount})
          </Label>
        </div>
      )}

      {/* Board list */}
      {boards.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-card-foreground shadow-sm">
          <p className="text-muted-foreground">
            No boards yet. Add your first board to get started.
          </p>
          <Button className="mt-4" onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Board
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Members</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {boards.map((board) => {
                const isArchived = !!board.archived_at;
                const isGoverning = board.is_governing_board === true;
                const isPending = selected?.id === board.id && !selectedBoard;

                return (
                  <tr
                    key={board.id}
                    className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/boards/${board.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {board.name}
                      </Link>
                      {isGoverning && (
                        <span className="ml-2 text-xs text-muted-foreground">(Governing)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="capitalize">
                        {board.elected_or_appointed ?? "elected"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {board.active_member_count} / {board.member_count ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      {isArchived ? (
                        <Badge variant="secondary">Archived</Badge>
                      ) : (
                        <Badge className="bg-green-600 text-white hover:bg-green-600">Active</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedBoardError(null);
                            setSelected({ id: board.id, mode: "edit" });
                          }}
                          disabled={isArchived}
                        >
                          {isPending && selected?.mode === "edit" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedBoardError(null);
                            setSelected({ id: board.id, mode: "archive" });
                          }}
                          disabled={isArchived}
                        >
                          {isPending && selected?.mode === "archive" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                          <span className="sr-only">Archive</span>
                        </Button>
                      </div>
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
