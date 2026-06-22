/**
 * Agenda Templates (/templates) — town-wide overview.
 *
 * Lists every board's reusable agenda templates, grouped by board. Creating and
 * editing happens in each board's Templates tab; this is the cross-board view.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, ChevronRight } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/lib/supabase";
import { MeetingListSkeleton } from "@/components/skeletons";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

interface TemplateRow {
  id: string;
  name: string;
  board: { id: string; name: string } | null;
}

export async function clientLoader() {
  return {};
}

export default function TemplatesPage() {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["agendaTemplates", "byTown", townId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agenda_template")
        .select("id, name, board:board_id(id, name)")
        .eq("town_id", townId)
        .order("name")
        .throwOnError();
      return (data ?? []) as unknown as TemplateRow[];
    },
    enabled: !!townId,
  });

  const groups = useMemo(() => {
    const byBoard = new Map<
      string,
      { boardId: string; boardName: string; items: TemplateRow[] }
    >();
    for (const t of templates) {
      const boardId = t.board?.id ?? "none";
      const boardName = t.board?.name ?? "Unassigned";
      const g =
        byBoard.get(boardId) ?? { boardId, boardName, items: [] as TemplateRow[] };
      g.items.push(t);
      byBoard.set(boardId, g);
    }
    return [...byBoard.values()].sort((a, b) =>
      a.boardName.localeCompare(b.boardName),
    );
  }, [templates]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable agenda structures, grouped by board. Create and edit them in a
          board's Templates tab.
        </p>
      </div>

      {isLoading ? (
        <MeetingListSkeleton rows={4} />
      ) : groups.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No agenda templates yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a board and create one from its Templates tab.
          </p>
          <Link
            to="/boards"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            Go to Boards →
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.boardId}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {g.boardName}
                </h2>
                {g.boardId !== "none" && (
                  <Link
                    to={`/boards/${g.boardId}/templates`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Manage →
                  </Link>
                )}
              </div>
              <div className="overflow-hidden rounded-lg border bg-card">
                {g.items.map((t) => {
                  const content = (
                    <>
                      <span className="text-sm font-medium">{t.name}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </>
                  );
                  const cls =
                    "flex items-center justify-between border-b px-4 py-3 transition-colors last:border-b-0";
                  return g.boardId !== "none" ? (
                    <Link
                      key={t.id}
                      to={`/boards/${g.boardId}/templates/${t.id}/edit`}
                      className={`${cls} hover:bg-accent`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={t.id} className={cls}>
                      {content}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
