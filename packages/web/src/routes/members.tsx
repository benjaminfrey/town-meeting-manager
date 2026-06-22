/**
 * Members (/members) — town-wide roster.
 *
 * Read-only view of everyone actively serving on the town's boards, aggregated
 * across boards. Per-board member management (add, edit, archive, permissions)
 * still lives in each board's Members tab.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { MeetingListSkeleton } from "@/components/skeletons";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

interface BoardRow {
  id: string;
  name: string;
}

interface MemberRow {
  id: string;
  status: string;
  board_id: string;
  person: { id: string; name: string | null; email: string | null } | null;
}

export async function clientLoader() {
  return {};
}

export default function MembersPage() {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";

  const { data: boards = [] } = useQuery({
    queryKey: queryKeys.boards.byTown(townId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("id, name")
        .eq("town_id", townId)
        .is("archived_at", null)
        .order("name")
        .throwOnError();
      return (data ?? []) as BoardRow[];
    },
    enabled: !!townId,
  });

  const boardIds = boards.map((b) => b.id);
  const boardNameById = useMemo(
    () => new Map(boards.map((b) => [b.id, b.name])),
    [boards],
  );

  const { data: members = [], isLoading } = useQuery({
    queryKey: [...queryKeys.members.all, "byTown", townId, boardIds.length],
    queryFn: async () => {
      if (boardIds.length === 0) return [];
      const { data } = await supabase
        .from("board_member")
        .select("id, status, board_id, person(id, name, email)")
        .in("board_id", boardIds)
        .eq("status", "active")
        .throwOnError();
      return (data ?? []) as unknown as MemberRow[];
    },
    enabled: !!townId && boardIds.length > 0,
  });

  // Group memberships by person.
  const roster = useMemo(() => {
    const byPerson = new Map<
      string,
      { name: string; email: string; boards: string[] }
    >();
    for (const m of members) {
      const p = m.person;
      if (!p) continue;
      const entry =
        byPerson.get(p.id) ??
        { name: p.name ?? "Unnamed", email: p.email ?? "", boards: [] };
      const bn = boardNameById.get(m.board_id);
      if (bn && !entry.boards.includes(bn)) entry.boards.push(bn);
      byPerson.set(p.id, entry);
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members, boardNameById]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone serving on your town's boards. Add or manage members from each
          board's Members tab.
        </p>
      </div>

      {isLoading ? (
        <MeetingListSkeleton rows={5} />
      ) : roster.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No active members yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a board and add members from its Members tab.
          </p>
          <Link
            to="/boards"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            Go to Boards →
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground sm:table-cell">
                  Email
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Boards
                </th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr
                  key={`${r.name}-${r.email}`}
                  className="border-b transition-colors last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                    {r.email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.boards.map((b) => (
                        <span
                          key={b}
                          className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
