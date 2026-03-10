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
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import type { AgendaTemplateSection } from "@town-meeting/shared/types";
import { cn } from "@/lib/utils";
import { SECTION_TYPE_LABELS } from "./template-labels";
import { Button } from "@/components/ui/button";

// ─── Props ───────────────────────────────────────────────────────────

interface SectionListPanelProps {
  sections: AgendaTemplateSection[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onReorder: (sections: AgendaTemplateSection[]) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

// ─── Sortable Item ───────────────────────────────────────────────────

function SortableSectionItem({
  section,
  index,
  isSelected,
  onSelect,
  onRemove,
}: {
  section: AgendaTemplateSection;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `section-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer border transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-transparent hover:bg-muted/50",
        isDragging && "opacity-50",
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Section info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{section.title}</div>
        <div className="text-xs text-muted-foreground">
          {SECTION_TYPE_LABELS[section.section_type] ?? section.section_type}
        </div>
      </div>

      {/* Fixed indicator */}
      {section.is_fixed && (
        <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}

      {/* Remove button (hidden for fixed sections) */}
      {!section.is_fixed && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove section"
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────

export function SectionListPanel({
  sections,
  selectedIndex,
  onSelect,
  onReorder,
  onAdd,
  onRemove,
}: SectionListPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = parseInt(String(active.id).split("-")[1]!);
      const newIndex = parseInt(String(over.id).split("-")[1]!);
      const reordered = arrayMove(sections, oldIndex, newIndex);
      onReorder(reordered);
      // Keep selection following the moved item
      onSelect(newIndex);
    }
  }

  const items = sections.map((_, i) => `section-${i}`);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b">
        <h3 className="text-sm font-semibold">Sections</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items}
            strategy={verticalListSortingStrategy}
          >
            {sections.map((section, index) => (
              <SortableSectionItem
                key={`section-${index}`}
                section={section}
                index={index}
                isSelected={index === selectedIndex}
                onSelect={() => onSelect(index)}
                onRemove={() => onRemove(index)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <div className="p-2 border-t">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onAdd}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add Section
        </Button>
      </div>
    </div>
  );
}
