/**
 * AgendaItemRow — a single item within an agenda section.
 *
 * Collapsed view shows title, presenter, duration.
 * Expanded view shows InlineItemForm for editing.
 * Supports sub-items (one level of nesting).
 */

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  GripVertical,
  Plus,
  User,
} from "lucide-react";
import { InlineItemForm } from "./InlineItemForm";
import { ExhibitUploader } from "./ExhibitUploader";
import { Button } from "@/components/ui/button";

interface AgendaItemRowProps {
  item: Record<string, unknown>;
  itemIndex: number;
  sectionType: string;
  sectionId: string;
  meetingId: string;
  townId: string;
  exhibits: Record<string, unknown>[];
  readOnly: boolean;
  isSubItem?: boolean;
}

export function AgendaItemRow({
  item,
  itemIndex,
  sectionType,
  sectionId,
  meetingId,
  townId,
  exhibits,
  readOnly,
  isSubItem,
}: AgendaItemRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddingSubItem, setIsAddingSubItem] = useState(false);

  const itemId = String(item.id);
  const title = String(item.title ?? "");
  const presenter = (item.presenter as string) || null;
  const duration = item.estimated_duration
    ? Number(item.estimated_duration)
    : null;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemId, disabled: readOnly || !!isSubItem });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isSubItem ? "ml-8" : ""} ${isDragging ? "opacity-50" : ""}`}
    >
      {/* Collapsed row */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/20 cursor-pointer transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {!readOnly && !isSubItem && (
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <button className="text-muted-foreground hover:text-foreground shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <span className="text-xs font-mono text-muted-foreground w-6">
          {isSubItem ? `${String.fromCharCode(105 + itemIndex)}.` : `${String.fromCharCode(65 + itemIndex)}.`}
        </span>
        <span className="flex-1 text-sm font-medium truncate">{title}</span>
        {presenter && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <User className="h-3 w-3" />
            {presenter}
          </span>
        )}
        {duration != null && duration > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            {duration}m
          </span>
        )}
        {exhibits.length > 0 && (
          <span className="text-xs text-muted-foreground shrink-0">
            {exhibits.length} exhibit{exhibits.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Expanded edit form */}
      {isExpanded && (
        <div className="border-t bg-muted/10 px-4 py-3">
          {readOnly ? (
            <div className="space-y-2 text-sm">
              {item.description ? (
                <p className="text-muted-foreground">
                  {String(item.description)}
                </p>
              ) : null}
              {item.background ? (
                <div>
                  <span className="font-medium">Background: </span>
                  <span className="text-muted-foreground">
                    {String(item.background)}
                  </span>
                </div>
              ) : null}
              {item.recommendation ? (
                <div>
                  <span className="font-medium">Recommendation: </span>
                  <span className="text-muted-foreground">
                    {String(item.recommendation)}
                  </span>
                </div>
              ) : null}
              {item.suggested_motion ? (
                <div>
                  <span className="font-medium">Suggested motion: </span>
                  <span className="text-muted-foreground">
                    {String(item.suggested_motion)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <InlineItemForm
              meetingId={meetingId}
              townId={townId}
              parentItemId={sectionId}
              sectionType={sectionType}
              sortOrder={itemIndex}
              existingItem={item}
              showCommentary={!isSubItem}
              onSaved={() => setIsExpanded(false)}
              onCancel={() => setIsExpanded(false)}
            />
          )}

          {/* Exhibits */}
          <ExhibitUploader
            agendaItemId={itemId}
            meetingId={meetingId}
            townId={townId}
            exhibits={exhibits}
            readOnly={readOnly}
          />

          {/* Sub-items / Add sub-item */}
          {!isSubItem && !readOnly && (
            <div className="mt-3 border-t pt-3">
              {isAddingSubItem ? (
                <div className="ml-8">
                  <InlineItemForm
                    meetingId={meetingId}
                    townId={townId}
                    parentItemId={itemId}
                    sectionType={sectionType}
                    sortOrder={0}
                    onSaved={() => setIsAddingSubItem(false)}
                    onCancel={() => setIsAddingSubItem(false)}
                  />
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-8 text-muted-foreground"
                  onClick={() => setIsAddingSubItem(true)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Sub-Item
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
