/**
 * MeetingsPage — / (main landing page)
 *
 * Minimalist 4-column Kanban: Draft | Noticed | Active | Done
 * Rice paper aesthetic — borderless cards, hover-reveal actions.
 * Drag-and-drop between columns with confirmation dialogs.
 */

import { useState, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  GripVertical,
  FileEdit,
  Play,
  Eye,
  FileText,
  ChevronRight,
} from "lucide-react";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateMeetingDialog } from "@/components/meetings/CreateMeetingDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermission } from "@/hooks/usePermission";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { MeetingListSkeleton } from "@/components/skeletons";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

interface MeetingRecord {
  id: string;
  title: string;
  status: string;
  meeting_type: string;
  scheduled_date: string;
  scheduled_time: string | null;
  board: { id: string; name: string } | null;
}

// ─── Column definitions (4 columns) ─────────────────────────────────

const KANBAN_COLUMNS = [
  { id: "draft", label: "Draft", statuses: ["draft"] },
  { id: "noticed", label: "Noticed", statuses: ["noticed"] },
  { id: "active", label: "Active", statuses: ["open", "in_progress"] },
  { id: "done", label: "Done", statuses: ["adjourned", "minutes_draft", "approved"] },
] as const;

type ColumnId = (typeof KANBAN_COLUMNS)[number]["id"];

// Adjacent column transitions allowed via drag
const VALID_TRANSITIONS: Record<string, { target: string; message: string }[]> = {
  draft: [{ target: "noticed", message: "Mark as noticed? This confirms the meeting notice has been published." }],
  noticed: [{ target: "active", message: "Open this meeting for attendance?" }],
  // active → done requires the live meeting flow
  // done transitions require the full approval workflow
};

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader() {
  return {};
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getStatusDot(status: string): string {
  switch (status) {
    case "draft":
      return "bg-muted-foreground/30";
    case "noticed":
      return "bg-amber-400";
    case "open":
    case "in_progress":
      return "bg-emerald-500";
    case "adjourned":
      return "bg-blue-400";
    case "minutes_draft":
      return "bg-violet-400";
    case "approved":
      return "bg-muted-foreground/20";
    default:
      return "bg-muted-foreground/20";
  }
}

function getCardAction(status: string, meetingId: string) {
  switch (status) {
    case "draft":
      return { label: "Edit Agenda", icon: FileEdit, href: `/meetings/${meetingId}/agenda` };
    case "noticed":
      return { label: "Start Meeting", icon: Play, href: `/meetings/${meetingId}/live` };
    case "open":
    case "in_progress":
      return { label: "Rejoin", icon: Play, href: `/meetings/${meetingId}/live` };
    case "adjourned":
    case "minutes_draft":
      return { label: "Minutes", icon: FileText, href: `/meetings/${meetingId}/minutes` };
    case "approved":
      return { label: "View", icon: Eye, href: `/meetings/${meetingId}` };
    default:
      return { label: "View", icon: Eye, href: `/meetings/${meetingId}` };
  }
}

// ─── Component ───────────────────────────────────────────────────────

export default function MeetingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";
  const { allowed: canCreateMeeting } = usePermission("A1");
  const queryClient = useQueryClient();

  const [draggedMeeting, setDraggedMeeting] = useState<MeetingRecord | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    meeting: MeetingRecord;
    targetStatus: string;
    message: string;
  } | null>(null);
  const [boardPickerOpen, setBoardPickerOpen] = useState(() => searchParams.get("new") === "1");
  const [selectedBoard, setSelectedBoard] = useState<{ id: string; name: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Fetch all meetings for this town
  const { data: meetingRows = [], isLoading } = useQuery({
    queryKey: queryKeys.meetings.byTown(townId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting")
        .select("id, title, status, meeting_type, scheduled_date, scheduled_time, board:board_id(id, name)")
        .eq("town_id", townId)
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true });
      if (error) throw error;
      // PostgREST infers the `board` to-one embed as an array, but a FK
      // relationship returns a single object at runtime — cast through unknown.
      return (data ?? []) as unknown as MeetingRecord[];
    },
    enabled: !!townId,
  });

  // Boards for CreateMeetingDialog
  const { data: allBoards = [] } = useQuery({
    queryKey: queryKeys.boards.byTown(townId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("id, name")
        .eq("town_id", townId)
        .is("archived_at", null)
        .order("name")
        .throwOnError();
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: !!townId && canCreateMeeting,
  });

  // Status transition mutation
  const transitionMutation = useMutation({
    mutationFn: async ({ meetingId, newStatus }: { meetingId: string; newStatus: string }) => {
      const { error } = await supabase
        .from("meeting")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", meetingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meetings.byTown(townId) });
    },
  });

  // Group meetings by column
  const columnMeetings = useMemo(() => {
    const groups: Record<ColumnId, MeetingRecord[]> = {
      draft: [],
      noticed: [],
      active: [],
      done: [],
    };
    for (const m of meetingRows) {
      const col = KANBAN_COLUMNS.find((c) =>
        (c.statuses as readonly string[]).includes(m.status),
      );
      if (col) {
        groups[col.id].push(m);
      }
    }
    // Limit "Done" column to last 10
    if (groups.done.length > 10) {
      groups.done = groups.done.slice(-10);
    }
    return groups;
  }, [meetingRows]);

  // DnD handlers
  function handleDragStart(event: DragStartEvent) {
    const meeting = meetingRows.find((m) => m.id === event.active.id);
    if (meeting) setDraggedMeeting(meeting);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedMeeting(null);
    const { active, over } = event;
    if (!over || !active) return;

    const meeting = meetingRows.find((m) => m.id === active.id);
    if (!meeting) return;

    const targetColumnId = String(over.id);
    const targetColumn = KANBAN_COLUMNS.find((c) => c.id === targetColumnId);
    if (!targetColumn || (targetColumn.statuses as readonly string[]).includes(meeting.status))
      return;

    // Check if valid transition
    const transitions = VALID_TRANSITIONS[meeting.status];
    const transition = transitions?.find((t) => t.target === targetColumnId);
    if (!transition) return;

    setConfirmDialog({
      meeting,
      targetStatus: transition.target,
      message: transition.message,
    });
  }

  function handleConfirmTransition() {
    if (!confirmDialog) return;
    transitionMutation.mutate({
      meetingId: confirmDialog.meeting.id,
      newStatus: confirmDialog.targetStatus,
    });
    setConfirmDialog(null);
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col px-6 lg:px-10">
      {/* Kanban board */}
      {isLoading ? (
        <div className="py-12 px-4">
          <MeetingListSkeleton rows={5} />
        </div>
      ) : meetingRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-4 text-sm text-muted-foreground">
              No meetings yet
            </p>
            {canCreateMeeting && (
              <button
                onClick={() => setBoardPickerOpen(true)}
                className="mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Schedule your first meeting &rarr;
              </button>
            )}
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid flex-1 grid-cols-4 gap-6 py-6">
            {KANBAN_COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                meetings={columnMeetings[col.id]}
                onNavigate={(path) => void navigate(path)}
              />
            ))}
          </div>

          <DragOverlay>
            {draggedMeeting && (
              <KanbanCardContent meeting={draggedMeeting} isDragging />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Confirmation dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/10 backdrop-blur-[2px]">
          <div className="mx-4 max-w-md rounded-xl border border-border/60 bg-card p-6 shadow-2xl shadow-foreground/5">
            <h3 className="text-base font-medium">Confirm Status Change</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmDialog.message}
            </p>
            <p className="mt-3 text-sm">
              <span className="font-medium">{confirmDialog.meeting.title}</span>
              {confirmDialog.meeting.board && (
                <span className="text-muted-foreground">
                  {" "}&mdash; {confirmDialog.meeting.board.name}
                </span>
              )}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmTransition}
                disabled={transitionMutation.isPending}
              >
                {transitionMutation.isPending ? "Updating..." : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Board picker dialog */}
      <Dialog
        open={boardPickerOpen}
        onOpenChange={(open) => {
          setBoardPickerOpen(open);
          // Clear the ?new param when closing
          if (!open && searchParams.get("new")) {
            searchParams.delete("new");
            setSearchParams(searchParams, { replace: true });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select a Board</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {allBoards.map((board) => (
              <button
                key={board.id}
                type="button"
                onClick={() => {
                  setBoardPickerOpen(false);
                  setSelectedBoard(board);
                }}
                className="w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted/70 transition-colors"
              >
                {board.name}
              </button>
            ))}
            {allBoards.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No active boards found. Create a board first.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Meeting dialog */}
      {selectedBoard && (
        <CreateMeetingDialog
          boardId={selectedBoard.id}
          boardName={selectedBoard.name}
          townId={townId}
          open={!!selectedBoard}
          onOpenChange={(open) => {
            if (!open) setSelectedBoard(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Kanban Column ───────────────────────────────────────────────────

function KanbanColumn({
  id,
  label,
  meetings,
  onNavigate,
}: {
  id: string;
  label: string;
  meetings: MeetingRecord[];
  onNavigate: (path: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col transition-colors rounded-lg",
        isOver && "bg-muted/40",
      )}
    >
      {/* Column header — uppercase small caps */}
      <div className="flex items-baseline gap-2 px-1 pb-3">
        <h3 className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </h3>
        <span className="text-[0.6rem] text-muted-foreground/50">
          {meetings.length}
        </span>
      </div>
      <div className="h-px bg-border/40 mb-3" />

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {meetings.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground/40">
            &mdash;
          </p>
        ) : (
          meetings.map((meeting) => (
            <KanbanCard
              key={meeting.id}
              meeting={meeting}
              onNavigate={onNavigate}
            />
          ))
        )}

        {/* "View all past" link for Done column */}
        {id === "done" && meetings.length > 0 && (
          <button
            onClick={() => onNavigate("/meetings?view=list")}
            className="flex w-full items-center justify-center gap-1 py-3 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            View all past meetings
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Kanban Card (draggable wrapper) ─────────────────────────────────

function KanbanCard({
  meeting,
  onNavigate,
}: {
  meeting: MeetingRecord;
  onNavigate: (path: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: meeting.id,
    data: { type: "card", meeting },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <KanbanCardContent
        meeting={meeting}
        onNavigate={onNavigate}
        dragListeners={listeners}
      />
    </div>
  );
}

// ─── Card content ────────────────────────────────────────────────────

function KanbanCardContent({
  meeting,
  onNavigate,
  dragListeners,
  isDragging = false,
}: {
  meeting: MeetingRecord;
  onNavigate?: (path: string) => void;
  dragListeners?: Record<string, unknown>;
  isDragging?: boolean;
}) {
  const action = getCardAction(meeting.status, meeting.id);
  const ActionIcon = action.icon;

  return (
    <div
      className={cn(
        "group rounded-lg bg-card p-3 transition-all duration-150",
        isDragging
          ? "shadow-lg ring-1 ring-border"
          : "hover:shadow-sm hover:ring-1 hover:ring-border/60",
      )}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle — visible on hover */}
        {dragListeners && (
          <button
            {...(dragListeners as React.HTMLAttributes<HTMLButtonElement>)}
            className="mt-0.5 cursor-grab touch-none text-transparent group-hover:text-muted-foreground/30 active:cursor-grabbing transition-colors"
            aria-label="Drag to change status"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {/* Meeting title */}
          <p className="text-sm font-medium truncate">{meeting.title}</p>
          {/* Date + Board */}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", getStatusDot(meeting.status))} />
            {meeting.scheduled_date ? formatDate(meeting.scheduled_date) : "\u2014"}
            {meeting.board && (
              <>
                <span className="text-muted-foreground/30">&middot;</span>
                <span className="truncate">{meeting.board.name}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Action button — ghost, visible on hover */}
      {onNavigate && (
        <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onNavigate(action.href)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ActionIcon className="h-3 w-3" />
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
