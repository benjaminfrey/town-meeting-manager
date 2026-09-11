/**
 * AgendaSection — a single section in the agenda builder.
 *
 * Displays a section header with type badge and item list.
 * Supports adding items and removing non-fixed sections.
 *
 * ─── Phase E, wave 4, Task 3 ──────────────────────────────────────────────
 *
 * Both writes were raw Supabase against `agenda_item`, under a tenancy-only
 * RLS policy and with no application-level check at all. Now:
 *
 *   - the child drag-reorder is `agendaItem.reorder` — ONE request writing
 *     `sort_order = <position>` for every id, replacing a loop that issued
 *     one UPDATE per moved row with no transaction around them;
 *   - "Remove section" is `agendaItem.delete` — ONE statement, replacing a
 *     per-child delete loop followed by a delete of the section. Both FKs are
 *     `ON DELETE CASCADE`, so the database removes the children (and their
 *     exhibits) itself; see `agenda-item.ts`'s header.
 *
 * Both are A2, board-scoped, so both can now answer FORBIDDEN — and both
 * surface it. A destructive button that silently does nothing is the failure
 * wave 3 shipped twice.
 *
 * Deleting a section cascades to its children's EXHIBITS, so both handlers
 * invalidate `trpc.exhibit.pathFilter()` as well as `trpc.agendaItem`'s —
 * the reorder does not touch exhibits and does not.
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage } from "@/lib/trpc";
import type { AgendaItem, MeetingExhibit, SectionWithChildren } from "./agenda-types";
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
} from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { SECTION_TYPE_LABELS } from "@/components/templates/template-labels";
import { AgendaItemRow } from "./AgendaItemRow";
import { InlineItemForm } from "./InlineItemForm";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AgendaSectionProps {
  section: SectionWithChildren;
  sectionIndex: number;
  children_items: AgendaItem[];
  meetingId: string;
  /** The meeting's board — every write below authorizes against it. */
  boardId: string;
  exhibits: MeetingExhibit[];
  readOnly: boolean;
}

export function AgendaSection({
  section,
  sectionIndex,
  children_items,
  meetingId,
  boardId,
  exhibits,
  readOnly,
}: AgendaSectionProps) {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectionId = section.id;
  const sectionTitle = section.title;
  const sectionType = section.section_type;
  const itemCount = children_items.length;

  // DnD for item reordering
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const itemIds = useMemo(() => children_items.map((item) => item.id), [children_items]);

  const reorderItems = useMutation(
    trpc.agendaItem.reorder.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agendaItems.byMeeting(meetingId),
        });
        // Reorders `agenda_item` rows — no count change, but an `agenda_item`
        // write all the same; invalidated at the router per conventions item 7
        // rather than encoding which of that router's procedures exist today.
        void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
      },
      onError: (err) => setError(refusalMessage(err, "reorder these items")),
    }),
  );

  const deleteSection = useMutation(
    trpc.agendaItem.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agendaItems.byMeeting(meetingId),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byMeeting(meetingId) });
        // DELETEs the section and every child item — this one really does move
        // the "N items" count `routes/meetings.$meetingId.tsx`'s shell renders
        // through `trpc.agendaItem.countByMeeting`.
        void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
        // …and cascades to those children's exhibits
        // (`exhibit_agenda_item_id_fkey` is ON DELETE CASCADE), which is a
        // separate router's read.
        void queryClient.invalidateQueries(trpc.exhibit.pathFilter());
        setConfirmDelete(false);
      },
      onError: (err) => setError(refusalMessage(err, "remove this section")),
    }),
  );

  const handleItemDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = children_items.findIndex((item) => item.id === active.id);
      const newIndex = children_items.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...children_items];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved!);

      setError(null);
      reorderItems.mutate({ boardId, itemIds: reordered.map((item) => item.id) });
    },
    [children_items, boardId, reorderItems],
  );

  const handleDeleteSection = useCallback(() => {
    setError(null);
    // One statement: the database cascades this section's child items and
    // their exhibits (see this file's header).
    deleteSection.mutate({ boardId, itemId: sectionId });
  }, [deleteSection, boardId, sectionId]);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Delete confirmation */}
      {confirmDelete && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Section</AlertDialogTitle>
              <AlertDialogDescription>
                Remove "{sectionTitle}" and its {itemCount} item
                {itemCount !== 1 ? "s" : ""}? This cannot be undone.
                {/* A refused delete leaves this dialog open, and Radix marks
                    everything outside it `aria-hidden` — see
                    `InlineItemForm`'s identical branch. */}
                {error && (
                  <span className="mt-2 block text-destructive" role="alert">
                    {error}
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteSection}
                disabled={deleteSection.isPending}
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* A refused or failed write — visible, not a button that does nothing. */}
      {error && !confirmDelete && (
        <p className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Section header */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-3">
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {sectionIndex + 1}. {SECTION_TYPE_LABELS[sectionType] ?? sectionType}
        </span>
        <h3 className="flex-1 text-sm font-semibold">{sectionTitle}</h3>
        <span className="text-xs text-muted-foreground">
          {itemCount} item{itemCount !== 1 ? "s" : ""}
        </span>
        {!readOnly && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setIsAdding(true)} title="Add item">
              <Plus className="h-3.5 w-3.5" />
              <span className="sr-only">Add item</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => (itemCount > 0 ? setConfirmDelete(true) : handleDeleteSection())}
              title="Remove section"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="sr-only">Remove section</span>
            </Button>
          </div>
        )}
      </div>

      {/* Items with DnD reordering */}
      {isExpanded && (
        <div className="divide-y">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleItemDragEnd}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {children_items.map((item, itemIndex) => (
                <AgendaItemRow
                  key={item.id}
                  item={item}
                  itemIndex={itemIndex}
                  sectionType={sectionType}
                  sectionId={sectionId}
                  meetingId={meetingId}
                  boardId={boardId}
                  exhibits={exhibits.filter((e) => e.agenda_item_id === item.id)}
                  readOnly={readOnly}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Inline add form */}
          {isAdding && !readOnly && (
            <div className="p-4">
              <InlineItemForm
                meetingId={meetingId}
                boardId={boardId}
                parentItemId={sectionId}
                sectionType={sectionType}
                sortOrder={itemCount}
                onSaved={() => setIsAdding(false)}
                onCancel={() => setIsAdding(false)}
              />
            </div>
          )}

          {/* Empty state */}
          {children_items.length === 0 && !isAdding && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">No items in this section.</p>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setIsAdding(true)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Item
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
