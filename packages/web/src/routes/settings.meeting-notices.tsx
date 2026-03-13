import { Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/queryKeys";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import type { NoticeTemplateBlock } from "@town-meeting/shared";

interface BoardWithTemplate {
  id: string;
  name: string;
  notice_template_blocks: NoticeTemplateBlock[] | null;
}

export default function MeetingNoticesSettingsPage() {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;

  const { data: boards = [], isLoading } = useQuery({
    queryKey: [...queryKeys.boards.byTown(townId ?? ""), "noticeTemplates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("board")
        .select("id, name, notice_template_blocks")
        .eq("town_id", townId!)
        .order("name");
      if (error) throw error;
      return data as BoardWithTemplate[];
    },
    enabled: !!townId,
  });

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
        <h1 className="text-2xl font-bold tracking-tight">
          Meeting Notice Templates
        </h1>
        <p className="mt-1 text-muted-foreground">
          Each board needs a notice template configured. Templates define the
          structure and content of meeting notices.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading boards...</div>
      ) : boards.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
          No boards found. Create a board first.
        </div>
      ) : (
        <div className="space-y-3">
          {boards.map((board) => (
            <BoardTemplateCard
              key={board.id}
              board={board}
              configuredBoards={configuredBoards}
            />
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

  const copyMutation = useMutation({
    mutationFn: async (sourceBoardId: string) => {
      const sourceBoard = configuredBoards.find((b) => b.id === sourceBoardId);
      if (!sourceBoard?.notice_template_blocks) throw new Error("Source board has no template");
      const { error } = await supabase
        .from("board")
        .update({ notice_template_blocks: sourceBoard.notice_template_blocks as unknown as Record<string, unknown>[] })
        .eq("id", board.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(board.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.byTown("") });
      setShowCopyDropdown(false);
    },
  });

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
                    onClick={() => copyMutation.mutate(source.id)}
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
