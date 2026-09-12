/**
 * AgendaBuilderPage — /meetings/:meetingId/agenda route
 *
 * Full agenda builder with sections, items, inline editing,
 * drag-and-drop reordering, exhibit uploads, and publish workflow.
 *
 * ─── Phase E, wave 4, Task 3 — the wiring ─────────────────────────────────
 *
 * Tasks 1 and 2 built `agendaItem` and `exhibit` and nothing called either.
 * This screen and its four child components now do. All five of this file's
 * reads and both of its writes are tRPC; `@/lib/supabase` is gone from it.
 *
 *   - `meeting.detail` (wave 3, Task 1, four columns added in this task) —
 *     the meeting row, including `board_id`, which is the value every
 *     board-scoped guard downstream needs. It is read HERE and passed down as
 *     a `boardId` prop rather than re-derived per component, so there is one
 *     source for it on this screen.
 *   - `board.detail` (unit 0) — the board's name for the preview dialog's
 *     letterhead. Nothing else on this screen reads the board.
 *   - `town.detail` (wave 1) — the town's name (letterhead) and `state` (the
 *     notice-compliance banner's statute lookup). It takes no input: it
 *     answers for the caller's own town, which is the only town a meeting on
 *     this screen can belong to.
 *   - `agendaItem.byMeeting` (Task 1) — flat and ordered, grouped into
 *     sections by the `sections` memo below exactly as before.
 *   - `exhibit.byMeeting` (Task 2) — replaces a read of EVERY exhibit row in
 *     the town, filtered to this meeting's items in the browser. See
 *     "What a clerk stops seeing" below; this is not a pure refactor.
 *
 * The two writes were raw `agenda_item` INSERT/UPDATEs with no authorization
 * check of any kind (`agenda_item_tenant_isolation` is tenancy-only): "Add
 * Section" is now `agendaItem.insert` and the section drag-reorder is
 * `agendaItem.reorder`, both A2 board-scoped. Both surface their refusal —
 * closing a hole makes FORBIDDEN reachable for the first time, and wave 3
 * shipped two silent refusals for exactly that reason.
 *
 * The two document-generation buttons stay on `apiJson`: `/api/meetings/:id/
 * agenda-packet` and `/api/meetings/:id/meeting-notice` are Fastify routes
 * that render a PDF, which no tRPC procedure replaces.
 *
 * ─── What a clerk stops seeing, stated because it is visible ──────────────
 *
 * `exhibit.byMeeting` applies rule 14 per row. A clerk holding A2 but not A3,
 * who is not a board member, used to see the titles of `admin_only` AND
 * `board_only` exhibits here (the raw query filtered nothing) and now sees
 * neither — measured against the built rule, not inferred, and pinned in
 * `exhibit.test.ts`. `board_only` is the tier a board packet lands in, so
 * this is a real change to what that clerk sees, and it is the correct
 * reading of rule 14: neither tier is granted by A2 alone.
 *
 * The screen degrades by simply having fewer exhibits, never by looking
 * broken: the "N exhibits" counters (the status bar, and each item's row)
 * count the rows this read actually returned, so they agree with the list
 * beneath them for every caller. That agreement is why `agendaItem.byMeeting`
 * lost its own unfiltered `exhibit_count` in this task — see that
 * procedure's doc comment.
 */

import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
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
  AlertTriangle,
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
import { apiJson } from "@/lib/api-client";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { AgendaSection } from "@/components/meetings/AgendaSection";
import { AgendaStatusBar } from "@/components/meetings/AgendaStatusBar";
import { AgendaPreviewDialog } from "@/components/meetings/AgendaPreviewDialog";
import { PublishAgendaDialog } from "@/components/meetings/PublishAgendaDialog";
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
import { queryKeys } from "@/lib/queryKeys";
import { queryClient } from "@/lib/queryClient";
import { trpc, refusalMessage } from "@/lib/trpc";
// The procedures' own row types, shared with every child component below —
// never `Record<string, unknown>` (conventions item 10).
import type { AgendaItem, SectionWithChildren } from "@/components/meetings/agenda-types";
import { getNoticeDeadline, type MeetingType, type ComplianceResult } from "@town-meeting/shared";

// ─── Compliance Banner ──────────────────────────────────────────────

const COMPLIANCE_COLORS: Record<string, string> = {
  ok: "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  danger:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
  overdue:
    "border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200",
};

function NoticeComplianceBanner({
  meetingDate,
  meetingTime,
  meetingType,
  state,
}: {
  meetingDate: string;
  meetingTime: string;
  meetingType: string;
  state: string;
}) {
  const result = useMemo<ComplianceResult>(() => {
    if (!meetingDate || !state) {
      return {
        rule: null,
        deadlineDate: null,
        daysUntilDeadline: null,
        warningLevel: "ok",
        advisoryMessage: "",
        statuteCitation: null,
      };
    }
    return getNoticeDeadline({
      meetingDate: new Date(meetingDate + "T00:00:00"),
      meetingTime: meetingTime || undefined,
      state,
      meetingType: meetingType as MeetingType,
    });
  }, [meetingDate, meetingTime, meetingType, state]);

  if (!result.rule) return null;

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${COMPLIANCE_COLORS[result.warningLevel] ?? ""}`}
    >
      <p className="font-medium">{result.advisoryMessage}</p>
    </div>
  );
}

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const meetingId = params.meetingId;

  // Not wrapped in try/catch: a nonexistent or foreign meeting answers
  // NOT_FOUND and letting that reject routes to `RouteErrorBoundary` below —
  // visible, rather than the indefinite "Loading meeting..." the old
  // `select("*").single()` produced for the same case (conventions item 12).
  await Promise.all([
    queryClient.ensureQueryData(trpc.meeting.detail.queryOptions({ meetingId })),
    queryClient.ensureQueryData(trpc.agendaItem.byMeeting.queryOptions({ meetingId })),
  ]);

  return { meetingId };
}

export default function AgendaBuilderPage({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const navigate = useNavigate();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [addingSectionType, setAddingSectionType] = useState<string | null>(null);
  const [addingSectionTitle, setAddingSectionTitle] = useState("");
  const [generatingPacket, setGeneratingPacket] = useState(false);
  const [generatingNotice, setGeneratingNotice] = useState(false);

  // ─── Queries ──────────────────────────────────────────────────────
  const {
    data: meeting,
    isLoading: isMeetingLoading,
    isError: isMeetingError,
    error: meetingError,
  } = useQuery(trpc.meeting.detail.queryOptions({ meetingId }));

  const boardId = meeting?.board_id ?? "";

  const { data: board } = useQuery({
    ...trpc.board.detail.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  // No `enabled` and no argument: `town.detail` answers for the caller's own
  // town, read off the bridged session rather than off this meeting's row.
  const { data: town } = useQuery(trpc.town.detail.queryOptions());

  const { data: itemRows } = useQuery(trpc.agendaItem.byMeeting.queryOptions({ meetingId }));

  const {
    data: exhibitRows,
    isError: isExhibitsError,
    error: exhibitsError,
  } = useQuery(trpc.exhibit.byMeeting.queryOptions({ meetingId }));

  const allItems = useMemo(() => itemRows ?? [], [itemRows]);
  // No client-side filter to this meeting's items any more: `exhibit.byMeeting`
  // already joins through `agenda_item` to this meeting, and applies rule 14
  // per row on top of that (see this file's header).
  const allExhibits = useMemo(() => exhibitRows ?? [], [exhibitRows]);

  // Group items: sections (parent_item_id is null) and children
  const sections: SectionWithChildren[] = useMemo(() => {
    const parents = allItems.filter((item) => !item.parent_item_id);
    return parents.map((section) => {
      const children = allItems
        .filter((item) => item.parent_item_id === section.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      return { ...section, children };
    });
  }, [allItems]);

  // Stats
  const totalItems = allItems.length;
  const totalDuration = allItems.reduce((sum, item) => sum + (item.estimated_duration ?? 0), 0);
  // The rows this caller actually received, so the count agrees with the list
  // for a caller rule 14 hides rows from — see this file's header.
  const totalExhibits = allExhibits.length;

  // Meeting info
  const meetingTitle = meeting?.title ?? "";
  const meetingStatus = meeting?.status ?? "draft";
  const agendaStatus = meeting?.agenda_status ?? "draft";
  const boardName = board?.name ?? "";
  const townName = town?.name ?? "";
  const scheduledDate = meeting?.scheduled_date ?? "";
  const scheduledTime = meeting?.scheduled_time ?? "";
  const location = meeting?.location ?? "";

  const agendaPacketUrl = meeting?.agenda_packet_url ?? null;
  const agendaPacketGeneratedAt = meeting?.agenda_packet_generated_at ?? null;
  const meetingNoticeUrl = meeting?.meeting_notice_url ?? null;
  const meetingNoticeGeneratedAt = meeting?.meeting_notice_generated_at ?? null;

  const isCancelled = meetingStatus === "cancelled";
  const isPublished = agendaStatus === "published";

  // ─── Mutations ────────────────────────────────────────────────────
  //
  // Both were raw Supabase writes with no authorization check. Both now
  // surface their refusal: `agendaItem.insert`/`reorder` are guarded by A2
  // for this board, so FORBIDDEN is reachable here for the first time and a
  // silent no-op would be indistinguishable from a saved change.

  const addSection = useMutation(
    trpc.agendaItem.insert.mutationOptions({
      onSuccess: () => {
        // Legacy key: `review.tsx` still reads it (conventions item 7 — the
        // legacy line goes when the last legacy reader does). `live.tsx` left
        // it in wave 5 and `SourceDataPanel.tsx` in wave 6, Task 3.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agendaItems.byMeeting(meetingId),
        });
        // INSERTs a new section row: this screen's own list, and the "N items"
        // count `routes/meetings.$meetingId.tsx`'s shell reads through
        // `trpc.agendaItem.countByMeeting`.
        void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
        setAddingSectionType(null);
        setAddingSectionTitle("");
      },
      onError: (err) => toast.error(refusalMessage(err, "add a section to this agenda")),
    }),
  );

  const reorderSections = useMutation(
    trpc.agendaItem.reorder.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agendaItems.byMeeting(meetingId),
        });
        // Reorders `agenda_item` rows — no count change, but an `agenda_item`
        // write, invalidated at the router per conventions item 7.
        void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
      },
      onError: (err) => toast.error(refusalMessage(err, "reorder this agenda")),
    }),
  );

  // ─── Document Generation ──────────────────────────────────────────
  const handleGeneratePacket = useCallback(async () => {
    setGeneratingPacket(true);
    try {
      const data = await apiJson<{ url: string }>(`/api/meetings/${meetingId}/agenda-packet`, {
        method: "POST",
      });
      // Invalidate meeting to pick up new packet URL
      await queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
      void queryClient.invalidateQueries(trpc.meeting.pathFilter());
      toast.success("Agenda packet generated", {
        action: {
          label: "Download",
          onClick: () => window.open(data.url, "_blank"),
        },
      });
    } catch (err) {
      toast.error(
        `Failed to generate agenda packet: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setGeneratingPacket(false);
    }
  }, [meetingId]);

  const handleGenerateNotice = useCallback(async () => {
    setGeneratingNotice(true);
    try {
      const data = await apiJson<{ url: string }>(`/api/meetings/${meetingId}/meeting-notice`, {
        method: "POST",
      });
      // Invalidate meeting to pick up new notice URL
      await queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
      void queryClient.invalidateQueries(trpc.meeting.pathFilter());
      toast.success("Meeting notice generated", {
        action: {
          label: "Download",
          onClick: () => window.open(data.url, "_blank"),
        },
      });
    } catch (err) {
      toast.error(
        `Failed to generate meeting notice: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setGeneratingNotice(false);
    }
  }, [meetingId]);

  // ─── DnD for section reordering ─────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  const handleSectionDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...sections];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved!);

      // One request, not N. The procedure writes `sort_order = <position in
      // this list>` for every id; the client used to skip rows whose value
      // already matched, which reaches the identical end state.
      reorderSections.mutate({ boardId, itemIds: reordered.map((s) => s.id) });
    },
    [sections, boardId, reorderSections],
  );

  // ─── Add section handler ────────────────────────────────────────────
  const handleAddSection = useCallback(() => {
    if (!addingSectionType || !addingSectionTitle.trim()) return;

    const maxSort = sections.reduce((max, s) => Math.max(max, s.sort_order ?? 0), -1);

    addSection.mutate({
      boardId,
      meetingId,
      parentItemId: null,
      sectionType: addingSectionType,
      sortOrder: maxSort + 1,
      title: addingSectionTitle.trim(),
      description: null,
      presenter: null,
      estimatedDuration: null,
      staffResource: null,
      background: null,
      recommendation: null,
      suggestedMotion: null,
    });
  }, [addingSectionType, addingSectionTitle, sections, meetingId, boardId, addSection]);

  // ─── Error state ────────────────────────────────────────────────────
  //
  // A failure AFTER mount — a refetch, a `staleTime` expiry. The loader above
  // covers the before-mount case through `RouteErrorBoundary`; conventions
  // item 12 requires both and neither substitutes for the other.

  if (isMeetingError) {
    const notFound = isTRPCClientError(meetingError) && meetingError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This meeting could not be found."
              : "Something went wrong loading this agenda."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {notFound
              ? "It may have been deleted, or it belongs to another town."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
          <Link to="/meetings" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to Meetings
          </Link>
        </div>
      </div>
    );
  }

  // ─── Loading ────────────────────────────────────────────────────────
  if (isMeetingLoading || !meeting) {
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
        scheduledTime={scheduledTime ?? ""}
        location={location ?? ""}
        sections={sections}
        allExhibits={allExhibits}
      />
      <PublishAgendaDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        meetingId={meetingId}
        boardId={boardId}
        sections={sections}
      />

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
            <NoticeComplianceBanner
              meetingDate={scheduledDate}
              meetingTime={scheduledTime ?? ""}
              meetingType={meeting.meeting_type}
              state={town?.state ?? "ME"}
            />
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
                <Button
                  variant="default"
                  onClick={() => void navigate(`/meetings/${meetingId}/live`)}
                >
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
                  <span>Packet generated {new Date(agendaPacketGeneratedAt).toLocaleString()}</span>
                )}
                {meetingNoticeGeneratedAt && (
                  <span>
                    Notice generated {new Date(meetingNoticeGeneratedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Exhibits failed to load — the items still render, so say which half
          is missing rather than blanking the page (conventions item 5). */}
      {isExhibitsError && (
        <div
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          role="alert"
        >
          <p className="font-medium">Attachments could not be loaded.</p>
          <p className="text-xs">
            {isTRPCClientError(exhibitsError) && exhibitsError.data?.code === "NOT_FOUND"
              ? "This meeting could not be found."
              : "The agenda below is complete; only its exhibits are missing. Try reloading."}
          </p>
        </div>
      )}

      {/* Sections with DnD reordering */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {sections.map((section, sectionIndex) => (
              <SortableSection
                key={section.id}
                id={section.id}
                readOnly={isCancelled || isPublished}
              >
                <AgendaSection
                  section={section}
                  sectionIndex={sectionIndex}
                  children_items={section.children}
                  meetingId={meetingId}
                  boardId={boardId}
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
                <Select value={addingSectionType} onValueChange={setAddingSectionType}>
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
                onClick={handleAddSection}
                disabled={!addingSectionTitle.trim() || addSection.isPending}
              >
                {addSection.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-50" : ""}>
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
