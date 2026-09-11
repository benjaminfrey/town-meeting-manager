/**
 * Agenda Templates (/templates) — town-wide overview.
 *
 * Lists every board's reusable agenda templates, grouped by board. Creating and
 * editing happens in each board's Templates tab; this is the cross-board view.
 *
 * Phase E, wave 4, Task 4 — the read moves onto
 * `trpc.agendaTemplate.listByTown`, a NEW procedure. The wave-3 marker this
 * discharges asked whether `agendaTemplate.list` would do, and the answer is
 * no, for four reasons stated in full on the procedure itself: `list` is
 * board-scoped, returns the template's `sections` blob instead of the board's
 * name, orders `is_default DESC, name ASC`, and — the one that makes it
 * impossible rather than merely wasteful — can never return a template with
 * NO board, which `agenda_template.board_id`'s nullability allows and this
 * screen's "Unassigned" group exists to render.
 *
 * **Cache keys.** This screen's old key was a hand-written
 * `["agendaTemplates", "byTown", townId]` — not from `lib/queryKeys.ts`, and
 * NOTHING in the tree ever invalidated it. Every template writer
 * (`CreateTemplateDialog`, `DeleteTemplateDialog`,
 * `boards.$boardId.templates.tsx`, `…templates.$templateId.edit.tsx`)
 * invalidates `queryKeys.agendaTemplates.byBoard(boardId)` and
 * `trpc.agendaTemplate.pathFilter()`, and neither reached that key. So this
 * page went stale for the full 60s `staleTime` after any template change, and
 * moving the read onto the tRPC key fixes that as a side effect: the four
 * writers' existing `pathFilter()` calls match this procedure by router
 * prefix. No writer changed in this commit; the key they were already
 * invalidating is now the key this screen reads.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { FileText, ChevronRight, AlertTriangle } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryClient } from "@/lib/queryClient";
import { MeetingListSkeleton } from "@/components/skeletons";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

type TemplateRow = RouterOutputs["agendaTemplate"]["listByTown"][number];

export async function clientLoader() {
  // Not wrapped in try/catch — conventions item 12: a rejection before mount
  // routes to `RouteErrorBoundary`, which is exported at the bottom of this
  // module. `listByTown` cannot 404 (an empty town is a legitimate answer),
  // so this is a prime, not a guard.
  await queryClient.ensureQueryData(trpc.agendaTemplate.listByTown.queryOptions());
  return {};
}

export default function TemplatesPage() {
  const {
    data: templates = [],
    isLoading,
    isError,
    error,
  } = useQuery(trpc.agendaTemplate.listByTown.queryOptions());

  const groups = useMemo(() => {
    const byBoard = new Map<string, { boardId: string; boardName: string; items: TemplateRow[] }>();
    for (const t of templates) {
      const boardId = t.board_id ?? "none";
      const boardName = t.board_name ?? "Unassigned";
      const g = byBoard.get(boardId) ?? { boardId, boardName, items: [] as TemplateRow[] };
      g.items.push(t);
      byBoard.set(boardId, g);
    }
    return [...byBoard.values()].sort((a, b) => a.boardName.localeCompare(b.boardName));
  }, [templates]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable agenda structures, grouped by board. Create and edit them in a board's Templates
          tab.
        </p>
      </div>

      {isError ? (
        // Conventions item 5: a failure AFTER mount (a refetch, a `staleTime`
        // expiry) never re-enters the route error boundary, so the screen owns
        // its own visible error state. Before this task there was none — the
        // read simply resolved to `[]` and the page rendered its empty state,
        // telling a clerk their town has no templates when the request failed.
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center"
        >
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="mt-3 font-medium">
            {isTRPCClientError(error) && error.data?.code === "NOT_FOUND"
              ? "These agenda templates could not be found."
              : "Something went wrong loading agenda templates."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try reloading the page. If the problem continues, contact support.
          </p>
        </div>
      ) : isLoading ? (
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
