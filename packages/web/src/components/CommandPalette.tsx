/**
 * CommandPalette — Cmd+K global search
 *
 * Searches meetings and boards, plus quick actions.
 * Uses cmdk for the command palette primitives.
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
} from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MeetingResult {
  id: string;
  title: string;
  status: string;
  scheduled_date: string;
  board: { id: string; name: string } | null;
}

interface BoardResult {
  id: string;
  name: string;
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

  // Fetch meetings
  const { data: meetings = [] } = useQuery({
    queryKey: [...queryKeys.meetings.byTown(townId), "cmd-palette"],
    queryFn: async () => {
      const { data } = await supabase
        .from("meeting")
        .select("id, title, status, scheduled_date, board:board_id(id, name)")
        .eq("town_id", townId)
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: false })
        .limit(50)
        .throwOnError();
      // PostgREST infers the `board` to-one embed as an array, but a FK
      // relationship returns a single object at runtime — cast through unknown.
      return (data ?? []) as unknown as MeetingResult[];
    },
    enabled: !!townId && open,
  });

  // Fetch boards
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
      return (data ?? []) as BoardResult[];
    },
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
                    onSelect={() =>
                      runAction(() => navigate(`/boards/${board.id}`))
                    }
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
                    value={`meeting ${meeting.title} ${meeting.board?.name ?? ""} ${meeting.scheduled_date}`}
                    onSelect={() =>
                      runAction(() => navigate(`/meetings/${meeting.id}`))
                    }
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted/70"
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="truncate">{meeting.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {meeting.board?.name}
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
