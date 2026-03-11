/**
 * AgendaBuilderPage — /meetings/:meetingId/agenda route
 *
 * Full agenda builder with sections, items, inline editing,
 * drag-and-drop reordering, exhibit uploads, and publish workflow.
 */

import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { usePowerSync, useQuery } from "@powersync/react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRight,
  Eye,
  FileText,
  GripVertical,
  Loader2,
  Play,
  Plus,
  ScrollText,
  Send,
} from "lucide-react";
import type { Route } from "./+types/meetings.$meetingId.agenda";
import { useAuth } from "@/providers/AuthProvider";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { AgendaSection } from "@/components/meetings/AgendaSection";
import { AgendaStatusBar } from "@/components/meetings/AgendaStatusBar";
import { AgendaPreviewDialog } from "@/components/meetings/AgendaPreviewDialog";
import { PublishAgendaDialog } from "@/components/meetings/PublishAgendaDialog";
import { InlineItemForm } from "@/components/meetings/InlineItemForm";
import {
  MEETING_STATUS_LABELS,
  MEETING_STATUS_COLORS,
  AGENDA_STATUS_LABELS,
  AGENDA_STATUS_COLORS,
} from "@/components/meetings/meeting-labels";
import { SECTION_TYPE_LABELS } from "@/components/templates/template-labels";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { meetingId: params.meetingId };
}

export default function AgendaBuilderPage({
  loaderData,
}: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const navigate = useNavigate();
  const powerSync = usePowerSync();
  const { session } = useAuth();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [addingSectionType, setAddingSectionType] = useState<string | null>(null);
  const [addingSectionTitle, setAddingSectionTitle] = useState("");
  const [generatingPacket, setGeneratingPacket] = useState(false);
  const [generatingNotice, setGeneratingNotice] = useState(false);

  // ─── Queries (no JOINs — separate queries, merge in JS) ─────────────
  const { data: meetingRows } = useQuery(
    "SELECT * FROM meetings WHERE id = ? LIMIT 1",
    [meetingId],
  );
  const meeting = meetingRows?.[0] as Record<string, unknown> | undefined;
  const boardId_ = (meeting?.board_id as string) ?? "";
  const townId_ = (meeting?.town_id as string) ?? "";

  const { data: boardRows } = useQuery(
    "SELECT * FROM boards WHERE id = ? LIMIT 1",
    [boardId_],
  );
  const { data: townRows } = useQuery(
    "SELECT * FROM towns WHERE id = ? LIMIT 1",
    [townId_],
  );
  const { data: itemRows } = useQuery(
    "SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order ASC",
    [meetingId],
  );
  const { data: exhibitRows } = useQuery(
    "SELECT * FROM exhibits WHERE town_id = ? ORDER BY sort_order ASC",
    [townId_],
  );

  const board = boardRows?.[0] as Record<string, unknown> | undefined;
  const town = townRows?.[0] as Record<string, unknown> | undefined;
  const allItems = (itemRows ?? []) as Record<string, unknown>[];
  // Filter exhibits to only those belonging to this meeting's items
  const allItemIds = useMemo(() => new Set(allItems.map((i) => String(i.id))), [allItems]);
  const allExhibits = useMemo(
    () =>
      ((exhibitRows ?? []) as Record<string, unknown>[]).filter((e) =>
        allItemIds.has(String(e.agenda_item_id)),
      ),
    [exhibitRows, allItemIds],
  );

  // Group items: sections (parent_item_id is null) and children
  type SectionWithChildren = Record<string, unknown> & {
    children: Record<string, unknown>[];
  };
  const sections: SectionWithChildren[] = useMemo(() => {
    const parents = allItems.filter((item) => !item.parent_item_id);
    return parents.map((section) => {
      const children = allItems
        .filter((item) => item.parent_item_id === section.id)
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
      return { ...section, children } as SectionWithChildren;
    });
  }, [allItems]);

  // Stats
  const totalItems = allItems.length;
  const totalDuration = allItems.reduce(
    (sum, item) => sum + (Number(item.estimated_duration) || 0),
    0,
  );
  const totalExhibits = allExhibits.length;

  // Meeting info
  const meetingTitle = String(meeting?.title ?? "");
  const meetingStatus = String(meeting?.status ?? "draft");
  const agendaStatus = String(meeting?.agenda_status ?? "draft");
  const boardId = String(meeting?.board_id ?? "");
  const townId = String(meeting?.town_id ?? "");
  const boardName = String(board?.name ?? "");
  const townName = String(town?.name ?? "");
  const scheduledDate = String(meeting?.scheduled_date ?? "");
  const scheduledTime = String(meeting?.scheduled_time ?? "");
  const location = String(meeting?.location ?? "");

  const agendaPacketUrl = (meeting?.agenda_packet_url as string) || null;
  const agendaPacketGeneratedAt = (meeting?.agenda_packet_generated_at as string) || null;
  const meetingNoticeUrl = (meeting?.meeting_notice_url as string) || null;
  const meetingNoticeGeneratedAt = (meeting?.meeting_notice_generated_at as string) || null;

  const isCancelled = meetingStatus === "cancelled";
  const isPublished = agendaStatus === "published";

  // ─── Document Generation ──────────────────────────────────────────
  const handleGeneratePacket = useCallback(async () => {
    if (!session?.access_token) return;
    setGeneratingPacket(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/agenda-packet`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      const data = await res.json();
      toast.success("Agenda packet generated", {
        action: {
          label: "Download",
          onClick: () => window.open(data.url, "_blank"),
        },
      });
    } catch (err) {
      toast.error(`Failed to generate agenda packet: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setGeneratingPacket(false);
    }
  }, [meetingId, session?.access_token]);

  const handleGenerateNotice = useCallback(async () => {
    if (!session?.access_token) return;
    setGeneratingNotice(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/meeting-notice`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      const data = await res.json();
      toast.success("Meeting notice generated", {
        action: {
          label: "Download",
          onClick: () => window.open(data.url, "_blank"),
        },
      });
    } catch (err) {
      toast.error(`Failed to generate meeting notice: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setGeneratingNotice(false);
    }
  }, [meetingId, session?.access_token]);

  // ─── DnD for section reordering ─────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sectionIds = useMemo(
    () => sections.map((s) => String(s.id)),
    [sections],
  );

  const handleSectionDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sections.findIndex((s) => String(s.id) === active.id);
      const newIndex = sections.findIndex((s) => String(s.id) === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Update sort_order for affected sections
      const now = new Date().toISOString();
      const reordered = [...sections];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved!);

      for (let i = 0; i < reordered.length; i++) {
        const s = reordered[i]!;
        if (Number(s.sort_order) !== i) {
          await powerSync.execute(
            "UPDATE agenda_items SET sort_order = ?, updated_at = ? WHERE id = ?",
            [i, now, String(s.id)],
          );
        }
      }
    },
    [sections, powerSync],
  );

  // ─── Add section handler ────────────────────────────────────────────
  const handleAddSection = useCallback(async () => {
    if (!addingSectionType || !addingSectionTitle.trim()) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxSort = sections.reduce(
      (max, s) => Math.max(max, Number(s.sort_order ?? 0)),
      -1,
    );

    await powerSync.execute(
      `INSERT INTO agenda_items (id, meeting_id, town_id, section_type, sort_order, title, description, presenter, estimated_duration, parent_item_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        meetingId,
        townId,
        addingSectionType,
        maxSort + 1,
        addingSectionTitle.trim(),
        null,
        null,
        null,
        null,
        "pending",
        now,
        now,
      ],
    );

    setAddingSectionType(null);
    setAddingSectionTitle("");
  }, [addingSectionType, addingSectionTitle, sections, powerSync, meetingId, townId]);

  // ─── Loading ────────────────────────────────────────────────────────
  if (!meeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading meeting...</p>
      </div>
    );
  }

  const formattedDate = scheduledDate
    ? new Date(scheduledDate + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  return (
    <div className="p-6 pb-20">
      {/* Dialogs */}
      <AgendaPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        meetingTitle={meetingTitle}
        boardName={boardName}
        townName={townName}
        scheduledDate={formattedDate}
        scheduledTime={scheduledTime}
        location={location}
        sections={sections}
        allExhibits={allExhibits}
      />
      <PublishAgendaDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        meetingId={meetingId}
        sections={sections}
      />

      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link
          to="/dashboard"
          className="hover:text-foreground transition-colors"
        >
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to="/boards" className="hover:text-foreground transition-colors">
          Boards
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          to={`/boards/${boardId}`}
          className="hover:text-foreground transition-colors"
        >
          {boardName}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          to={`/boards/${boardId}/meetings`}
          className="hover:text-foreground transition-colors"
        >
          Meetings
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">Agenda</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{meetingTitle}</h1>
          <p className="mt-1 text-muted-foreground">
            {formattedDate}
            {scheduledTime ? ` at ${scheduledTime}` : ""}
            {location ? ` — ${location}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${MEETING_STATUS_COLORS[meetingStatus] ?? ""}`}
            >
              {MEETING_STATUS_LABELS[meetingStatus] ?? meetingStatus}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${AGENDA_STATUS_COLORS[agendaStatus] ?? ""}`}
            >
              Agenda: {AGENDA_STATUS_LABELS[agendaStatus] ?? agendaStatus}
            </span>
          </div>
        </div>
        {!isCancelled && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleGenerateNotice()}
                disabled={generatingNotice}
              >
                {generatingNotice ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ScrollText className="mr-2 h-4 w-4" />
                )}
                {meetingNoticeUrl ? "Regenerate Notice" : "Generate Notice"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleGeneratePacket()}
                disabled={generatingPacket || totalItems === 0}
              >
                {generatingPacket ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                {agendaPacketUrl ? "Regenerate Packet" : "Generate Packet"}
              </Button>
              <Button variant="outline" onClick={() => setPreviewOpen(true)}>
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </Button>
              {(meetingStatus === "noticed" || meetingStatus === "open") && (
                <Button variant="default" onClick={() => void navigate(`/meetings/${meetingId}/live`)}>
                  <Play className="mr-2 h-4 w-4" />
                  Run Meeting
                </Button>
              )}
              {!isPublished && (
                <Button onClick={() => setPublishOpen(true)}>
                  <Send className="mr-2 h-4 w-4" />
                  Publish Agenda
                </Button>
              )}
            </div>
            {(agendaPacketGeneratedAt || meetingNoticeGeneratedAt) && (
              <div className="flex gap-3 text-xs text-muted-foreground">
                {agendaPacketGeneratedAt && (
                  <span>
                    Packet generated{" "}
                    {new Date(agendaPacketGeneratedAt).toLocaleString()}
                  </span>
                )}
                {meetingNoticeGeneratedAt && (
                  <span>
                    Notice generated{" "}
                    {new Date(meetingNoticeGeneratedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sections with DnD reordering */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => void handleSectionDragEnd(e)}
      >
        <SortableContext
          items={sectionIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {sections.map((section, sectionIndex) => (
              <SortableSection
                key={String(section.id)}
                id={String(section.id)}
                readOnly={isCancelled || isPublished}
              >
                <AgendaSection
                  section={section}
                  sectionIndex={sectionIndex}
                  children_items={section.children}
                  meetingId={meetingId}
                  townId={townId}
                  exhibits={allExhibits.filter(
                    (e) =>
                      e.agenda_item_id === section.id ||
                      section.children.some((c) => c.id === e.agenda_item_id),
                  )}
                  readOnly={isCancelled || isPublished}
                />
              </SortableSection>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add Section */}
      {!isCancelled && !isPublished && (
        <div className="mt-6 rounded-lg border border-dashed bg-card p-4">
          {addingSectionType === null ? (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => setAddingSectionType("other")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Section
            </Button>
          ) : (
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium">Section title</label>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={addingSectionTitle}
                  onChange={(e) => setAddingSectionTitle(e.target.value)}
                  placeholder="New section title"
                  autoFocus
                />
              </div>
              <div className="w-48 space-y-1.5">
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={addingSectionType}
                  onValueChange={setAddingSectionType}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SECTION_TYPE_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => void handleAddSection()}
                disabled={!addingSectionTitle.trim()}
              >
                Add
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setAddingSectionType(null);
                  setAddingSectionTitle("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Status bar */}
      <AgendaStatusBar
        itemCount={totalItems}
        totalDuration={totalDuration}
        exhibitCount={totalExhibits}
        agendaStatus={agendaStatus}
      />
    </div>
  );
}

// ─── Sortable section wrapper ─────────────────────────────────────────

function SortableSection({
  id,
  readOnly,
  children,
}: {
  id: string;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-50" : ""}
    >
      {!readOnly && (
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center py-1 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      {children}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
