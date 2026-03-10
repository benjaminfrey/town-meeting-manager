/**
 * BoardListPage — /boards route
 *
 * Lists all boards and committees for the current town.
 * Supports add, edit, archive actions and show/hide archived toggle.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@powersync/react";
import { Plus, Pencil, Archive } from "lucide-react";
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

export async function clientLoader() {
  return {};
}

export default function BoardListPage(_props: Route.ComponentProps) {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;

  const [showArchived, setShowArchived] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editBoard, setEditBoard] = useState<Record<string, unknown> | null>(null);
  const [archiveBoard, setArchiveBoard] = useState<Record<string, unknown> | null>(null);

  // ─── Reactive queries ─────────────────────────────────────────────
  const { data: boardRows } = useQuery(
    "SELECT * FROM boards WHERE town_id = ? ORDER BY is_governing_board DESC, name ASC",
    [townId ?? ""]
  );
  const { data: memberCountRows } = useQuery(
    "SELECT board_id, COUNT(*) as count FROM board_members WHERE town_id = ? AND status = 'active' GROUP BY board_id",
    [townId ?? ""]
  );
  const { data: townRows } = useQuery(
    "SELECT * FROM towns WHERE id = ? LIMIT 1",
    [townId ?? ""]
  );

  const town = townRows?.[0] as Record<string, unknown> | undefined;

  // Build member count lookup
  const memberCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of memberCountRows ?? []) {
      const r = row as Record<string, unknown>;
      map[String(r.board_id)] = Number(r.count);
    }
    return map;
  }, [memberCountRows]);

  // Filter boards
  const boards = useMemo(() => {
    const all = (boardRows ?? []) as Record<string, unknown>[];
    if (showArchived) return all;
    return all.filter((b) => !b.archived_at);
  }, [boardRows, showArchived]);

  const archivedCount = useMemo(() => {
    return ((boardRows ?? []) as Record<string, unknown>[]).filter((b) => b.archived_at).length;
  }, [boardRows]);

  // ─── Loading state ────────────────────────────────────────────────
  if (!townId) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading...</p>
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
      {editBoard && (
        <EditBoardDialog
          townId={townId}
          town={town}
          board={editBoard}
          open={!!editBoard}
          onOpenChange={(open) => { if (!open) setEditBoard(null); }}
        />
      )}
      {archiveBoard && (
        <ArchiveBoardDialog
          board={archiveBoard}
          open={!!archiveBoard}
          onOpenChange={(open) => { if (!open) setArchiveBoard(null); }}
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

      {/* Show archived toggle */}
      {archivedCount > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Switch
            id="show-archived"
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
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
                const id = String(board.id);
                const name = String(board.name ?? "");
                const electedOrAppointed = String(board.elected_or_appointed ?? "elected");
                const isArchived = !!board.archived_at;
                const isGoverning = board.is_governing_board === 1;
                const activeMemberCount = memberCounts[id] ?? 0;
                const seatCount = Number(board.member_count ?? 0);

                return (
                  <tr key={id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        to={`/boards/${id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {name}
                      </Link>
                      {isGoverning && (
                        <span className="ml-2 text-xs text-muted-foreground">(Governing)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="capitalize">
                        {electedOrAppointed}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {activeMemberCount} / {seatCount}
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
                          onClick={() => setEditBoard(board)}
                          disabled={isArchived}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setArchiveBoard(board)}
                          disabled={isArchived}
                        >
                          <Archive className="h-3.5 w-3.5" />
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
