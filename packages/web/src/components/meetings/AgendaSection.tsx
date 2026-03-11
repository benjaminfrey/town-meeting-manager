/**
 * AgendaSection — a single section in the agenda builder.
 *
 * Displays a section header with type badge and item list.
 * Supports adding items and removing non-fixed sections.
 */

import { useCallback, useMemo, useState } from "react";
import { usePowerSync } from "@powersync/react";
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
  section: Record<string, unknown> & {
    children: Record<string, unknown>[];
  };
  sectionIndex: number;
  children_items: Record<string, unknown>[];
  meetingId: string;
  townId: string;
  exhibits: Record<string, unknown>[];
  readOnly: boolean;
}

export function AgendaSection({
  section,
  sectionIndex,
  children_items,
  meetingId,
  townId,
  exhibits,
  readOnly,
}: AgendaSectionProps) {
  const powerSync = usePowerSync();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sectionId = String(section.id);
  const sectionTitle = String(section.title ?? "");
  const sectionType = String(section.section_type ?? "other");
  const itemCount = children_items.length;

  // DnD for item reordering
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const itemIds = useMemo(
    () => children_items.map((item) => String(item.id)),
    [children_items],
  );

  const handleItemDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = children_items.findIndex((item) => String(item.id) === active.id);
      const newIndex = children_items.findIndex((item) => String(item.id) === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const now = new Date().toISOString();
      const reordered = [...children_items];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved!);

      for (let i = 0; i < reordered.length; i++) {
        const item = reordered[i]!;
        if (Number(item.sort_order) !== i) {
          await powerSync.execute(
            "UPDATE agenda_items SET sort_order = ?, updated_at = ? WHERE id = ?",
            [i, now, String(item.id)],
          );
        }
      }
    },
    [children_items, powerSync],
  );

  const handleDeleteSection = useCallback(async () => {
    // Delete all children first
    for (const child of children_items) {
      await powerSync.execute("DELETE FROM agenda_items WHERE id = ?", [
        String(child.id),
      ]);
    }
    // Delete the section itself
    await powerSync.execute("DELETE FROM agenda_items WHERE id = ?", [
      sectionId,
    ]);
    setConfirmDelete(false);
  }, [powerSync, sectionId, children_items]);

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
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDeleteSection()}
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Section header */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-3">
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsAdding(true)}
              title="Add item"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="sr-only">Add item</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                itemCount > 0
                  ? setConfirmDelete(true)
                  : void handleDeleteSection()
              }
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
            onDragEnd={(e) => void handleItemDragEnd(e)}
          >
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              {children_items.map((item, itemIndex) => (
                <AgendaItemRow
                  key={String(item.id)}
                  item={item}
                  itemIndex={itemIndex}
                  sectionType={sectionType}
                  sectionId={sectionId}
                  meetingId={meetingId}
                  townId={townId}
                  exhibits={exhibits.filter(
                    (e) => e.agenda_item_id === item.id,
                  )}
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
                townId={townId}
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
              <p className="text-sm text-muted-foreground">
                No items in this section.
              </p>
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
