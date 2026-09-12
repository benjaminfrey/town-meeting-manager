/**
 * CommandPalette — Cmd+K global search
 *
 * Searches meetings and boards, plus quick actions.
 * Uses cmdk for the command palette primitives.
 *
 * Phase E, wave 6, Task 5. Both reads are tRPC now (`meeting.byTown`,
 * `board.listActive`). This file carried NO `TODO(phase-e-wave-*)` marker
 * through five waves despite two live raw Supabase reads, so item 11's
 * completeness sweep read it as done — it was findable only by the import
 * grep, which is why Task 0 made that grep the wave's completeness measure.
 *
 * ─── Two behaviour changes, stated rather than smuggled ──────────────────
 *
 * 1. **`.limit(50)` is gone.** `meeting.byTown` returns every non-cancelled
 *    meeting in the town. A search box that silently could not find the
 *    51st-oldest meeting is a defect, not a feature, and reproducing the cap
 *    would need either a new procedure or a `limit` argument on one whose
 *    other caller (the kanban) wants all of them. The palette renders inside a
 *    `max-h-72` scroller and `cmdk` filters by the typed query, so the cost is
 *    a longer client-side list, not a longer page.
 * 2. **The order is restored at the call site, not in the procedure.** The raw
 *    query was `scheduled_date` DESC (most recent first); `meeting.byTown` is
 *    ASC, because the kanban that owns it wants oldest-first. Sorting here
 *    keeps this screen's own order without changing the procedure out from
 *    under its other caller — the same "sort at the call site" choice
 *    `board.list`'s doc comment already records for `routes/boards.tsx`.
 *
 * And one for the board list: `board.listActive` orders governing-board-first
 * then alphabetically, where the raw read was plain `.order("name")`. Left as
 * the procedure gives it — this is a jump-to list, every entry is labelled,
 * and the town's governing board sorting first is if anything the better
 * answer. The archived filter is identical (`archived_at IS NULL`).
 */

import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Search,
  CalendarDays,
  List,
  Plus,
  Settings,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";
  const [search, setSearch] = useState("");

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Fetch meetings. `enabled` keeps both reads off the wire until the palette
  // is actually opened, exactly as before — the shell mounts this component on
  // every authenticated screen.
  const { data: meetingRows = [], isError: isMeetingsError } = useQuery({
    ...trpc.meeting.byTown.queryOptions(),
    enabled: !!townId && open,
  });

  // Most-recent-first, restoring the order the raw query had — see this
  // file's header for why it is sorted here rather than in the procedure.
  const meetings = useMemo(
    () => [...meetingRows].sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)),
    [meetingRows],
  );

  // Fetch boards
  const { data: boards = [], isError: isBoardsError } = useQuery({
    ...trpc.board.listActive.queryOptions(),
    enabled: !!townId && open,
  });

  function runAction(callback: () => void) {
    onOpenChange(false);
    callback();
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-foreground/10 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />

      {/* Command palette */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
        <Command
          className="w-full max-w-lg rounded-xl border border-border/60 bg-card shadow-2xl shadow-foreground/5"
          shouldFilter={true}
          loop
        >
          <div className="flex items-center gap-2 border-b border-border/40 px-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search meetings, boards..."
              className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/50 bg-muted/50 px-1.5 text-[10px] font-medium text-muted-foreground">
              esc
            </kbd>
          </div>

          <Command.List className="max-h-72 overflow-y-auto p-2">
            {/* A failed search read used to render as "No results found." —
                indistinguishable from a town with nothing in it (conventions
                item 5). Non-blocking: the quick actions below still work. */}
            {(isMeetingsError || isBoardsError) && (
              <div
                role="alert"
                aria-live="assertive"
                className="mx-2 mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <p>Couldn't load search results. Try again in a moment.</p>
              </div>
            )}

            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Quick actions */}
            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.65rem] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-muted-foreground/70 [&_[cmdk-group-heading]]:font-medium"
            >
              <Command.Item
                value="schedule new meeting"
                onSelect={() => runAction(() => navigate("/meetings"))}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted/70"
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                Schedule Meeting
              </Command.Item>
              <Command.Item
                value="go to settings"
                onSelect={() => runAction(() => navigate("/settings"))}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted/70"
              >
                <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                Settings
              </Command.Item>
            </Command.Group>

            {/* Boards */}
            {boards.length > 0 && (
              <Command.Group
                heading="Boards"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.65rem] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-muted-foreground/70 [&_[cmdk-group-heading]]:font-medium"
              >
                {boards.map((board) => (
                  <Command.Item
                    key={board.id}
                    value={`board ${board.name}`}
                    onSelect={() => runAction(() => navigate(`/boards/${board.id}`))}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted/70"
                  >
                    <List className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{board.name}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Meetings */}
            {meetings.length > 0 && (
              <Command.Group
                heading="Meetings"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.65rem] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.15em] [&_[cmdk-group-heading]]:text-muted-foreground/70 [&_[cmdk-group-heading]]:font-medium"
              >
                {meetings.map((meeting) => (
                  <Command.Item
                    key={meeting.id}
                    value={`meeting ${meeting.title} ${meeting.board_name} ${meeting.scheduled_date}`}
                    onSelect={() => runAction(() => navigate(`/meetings/${meeting.id}`))}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted/70"
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="truncate">{meeting.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {meeting.board_name}
                        {meeting.scheduled_date && ` \u00b7 ${formatDate(meeting.scheduled_date)}`}
                      </span>
                    </div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </>
  );
}
