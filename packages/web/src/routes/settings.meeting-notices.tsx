/**
 * Meeting Notice Templates — /settings/meeting-notices
 *
 * Stage 1, Phase E, wave 1, Task 4 — moved onto `board.list` (Task 4's own
 * addition to `board.ts`, alongside `board.copyNoticeTemplate`) from a
 * Supabase `select("id, name, notice_template_blocks")` scan. `board.list`'s
 * loading and error states now get their own visible states (conventions
 * item 5), matching `settings.town.tsx`'s pattern for the same reason.
 *
 * Per-block editing of a board's own template still lives on the board's own
 * Settings tab (`<NoticeTemplateEditor>`, out of this task's scope) — this
 * screen is only the town-wide overview and the "copy from board" shortcut.
 */

import { Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { ArrowLeft, AlertTriangle, Check, Copy } from "lucide-react";
import { useState } from "react";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

type BoardWithTemplate = RouterOutputs["board"]["list"][number];

// No `ensureQueryData` priming — this route has no path param, and what
// decides whether to show it at all is `useCurrentUser().townId`, only known
// after `AuthProvider` resolves. Same choice, same reason, as
// `settings.town.tsx`'s own `clientLoader`.
export async function clientLoader() {
  return {};
}

export default function MeetingNoticesSettingsPage() {
  const { data: boards = [], isLoading, isError, error } = useQuery(trpc.board.list.queryOptions());

  const configuredBoards = boards.filter((b) => b.notice_template_blocks !== null);
  const unconfiguredBoards = boards.filter((b) => b.notice_template_blocks === null);

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Meeting Notice Templates</h1>
        <p className="mt-1 text-muted-foreground">
          Each board needs a notice template configured. Templates define the structure and content
          of meeting notices.
        </p>
      </div>

      {isError ? (
        <div
          className="rounded-lg border bg-card p-6 text-center text-card-foreground"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {isTRPCClientError(error) && error.data?.code === "NOT_FOUND"
              ? "This town's boards could not be found."
              : "Something went wrong loading your boards."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try reloading the page. If the problem continues, contact support.
          </p>
        </div>
      ) : isLoading ? (
        <div className="text-sm text-muted-foreground">Loading boards...</div>
      ) : boards.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
          No boards found. Create a board first.
        </div>
      ) : (
        <div className="space-y-3">
          {boards.map((board) => (
            <BoardTemplateCard key={board.id} board={board} configuredBoards={configuredBoards} />
          ))}

          <div className="mt-4 text-sm text-muted-foreground">
            {configuredBoards.length} of {boards.length} board
            {boards.length !== 1 ? "s" : ""} configured
          </div>
        </div>
      )}
    </div>
  );
}

function BoardTemplateCard({
  board,
  configuredBoards,
}: {
  board: BoardWithTemplate;
  configuredBoards: BoardWithTemplate[];
}) {
  const queryClient = useQueryClient();
  const isConfigured = board.notice_template_blocks !== null;
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);

  const copyMutation = useMutation(
    trpc.board.copyNoticeTemplate.mutationOptions({
      onSuccess: () => {
        // Both invalidations run during the transition (conventions item 7):
        // `queryKeys.boards.detail(board.id)` is still read directly by
        // several unmigrated screens (`useQuorumCheck`,
        // `meetings.$meetingId.tsx`, `boards.$boardId.meetings.tsx`, and
        // others — see `grep -rn "queryKeys.boards.detail" packages/web/src`),
        // and `trpc.board.pathFilter()` is this screen's own read
        // (`board.list`) plus the board's `board.detail`. The PREVIOUS
        // version of this write invalidated `queryKeys.boards.byTown("")` —
        // an empty, always-wrong town id — which this replaces with the
        // correctly-scoped per-board key instead of carrying the bug
        // forward.
        void queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(board.id) });
        void queryClient.invalidateQueries(trpc.board.pathFilter());
        setShowCopyDropdown(false);
      },
    }),
  );

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">{board.name}</p>
          <div className="flex items-center gap-2 mt-1">
            {isConfigured ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
                <Check className="h-3 w-3" />
                Configured
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Not configured
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!isConfigured && configuredBoards.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCopyDropdown(!showCopyDropdown)}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              <Copy className="h-3 w-3" />
              Copy from board
            </button>
            {showCopyDropdown && (
              <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border bg-popover p-1 shadow-md">
                {configuredBoards.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() =>
                      copyMutation.mutate({ sourceBoardId: source.id, targetBoardId: board.id })
                    }
                    disabled={copyMutation.isPending}
                    className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                  >
                    {source.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <Link
          to={`/boards/${board.id}?tab=settings`}
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {isConfigured ? "Edit Template" : "Configure Template"}
        </Link>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
