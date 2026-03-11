import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  ChevronDown,
  ChevronRight,
  Check,
  Clock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentEditableField } from "./ContentEditableField";
import { SourceDataPanel } from "./SourceDataPanel";
import type {
  MinutesContentJson,
  MinutesContentSection,
  MinutesContentItem,
} from "@town-meeting/shared/types";

interface MinutesEditorProps {
  minutesDocId: string;
  meetingId: string;
  contentJson: MinutesContentJson;
  onSave: (updatedContentJson: MinutesContentJson) => Promise<void>;
}

type SaveStatus = "saved" | "unsaved" | "saving";

const AUTO_SAVE_INTERVAL_MS = 30_000;

export function MinutesEditor({
  minutesDocId,
  meetingId,
  contentJson,
  onSave,
}: MinutesEditorProps) {
  const [editableContent, setEditableContent] =
    useState<MinutesContentJson>(() => structuredClone(contentJson));
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(0);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(
    new Set(),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const editableContentRef = useRef(editableContent);
  const isDirtyRef = useRef(isDirty);

  // Keep refs in sync
  useEffect(() => {
    editableContentRef.current = editableContent;
  }, [editableContent]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const performSave = useCallback(async () => {
    if (!isDirtyRef.current) return;
    setSaveStatus("saving");
    try {
      await onSave(editableContentRef.current);
      setIsDirty(false);
      isDirtyRef.current = false;
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
    }
  }, [onSave]);

  // Auto-save interval
  useEffect(() => {
    const interval = setInterval(() => {
      if (isDirtyRef.current) {
        performSave();
      }
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [performSave]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (isDirtyRef.current) {
        onSave(editableContentRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    setSaveStatus("unsaved");
  }, []);

  const updateItemField = useCallback(
    (
      sectionIdx: number,
      itemIdx: number,
      field: keyof MinutesContentItem,
      value: string | null,
    ) => {
      setEditableContent((prev) => {
        const next = structuredClone(prev);
        (next.sections[sectionIdx].items[itemIdx] as Record<string, unknown>)[
          field
        ] = value;
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const updateSpeakerName = useCallback(
    (
      sectionIdx: number,
      itemIdx: number,
      speakerIdx: number,
      name: string,
    ) => {
      setEditableContent((prev) => {
        const next = structuredClone(prev);
        next.sections[sectionIdx].items[itemIdx].speakers[speakerIdx].name =
          name;
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const toggleSection = useCallback((idx: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  const handleSaveClick = useCallback(async () => {
    await performSave();
  }, [performSave]);

  return (
    <div className="flex h-full">
      {/* Left Panel — Editor (60%) */}
      <div className="flex w-[60%] flex-col border-r border-border">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Minutes Editor</h2>
          <div className="flex items-center gap-3">
            {/* Save status indicator */}
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs",
                saveStatus === "saved" && "text-green-600",
                saveStatus === "unsaved" && "text-amber-600",
                saveStatus === "saving" && "text-muted-foreground",
              )}
            >
              {saveStatus === "saved" && (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Saved
                </>
              )}
              {saveStatus === "unsaved" && <>Unsaved changes</>}
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              )}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveClick}
              disabled={saveStatus === "saving" || !isDirty}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        </div>

        {/* Sections list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {editableContent.sections.map(
            (section: MinutesContentSection, sectionIdx: number) => {
              const isCollapsed = collapsedSections.has(sectionIdx);
              const isSelected = selectedSectionIndex === sectionIdx;

              return (
                <div
                  key={sectionIdx}
                  className={cn(
                    "rounded-lg border",
                    isSelected
                      ? "border-primary/50 bg-primary/5"
                      : "border-border bg-card",
                  )}
                >
                  {/* Section header */}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
                    onClick={() => {
                      setSelectedSectionIndex(sectionIdx);
                      toggleSection(sectionIdx);
                    }}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span>{section.title}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] text-muted-foreground"
                    >
                      {section.section_type}
                    </Badge>
                  </button>

                  {/* Section items */}
                  {!isCollapsed && (
                    <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
                      {section.items.length === 0 && section.marked_none && (
                        <p className="text-xs italic text-muted-foreground">
                          Marked as none.
                        </p>
                      )}

                      {section.items.map(
                        (item: MinutesContentItem, itemIdx: number) => (
                          <div
                            key={itemIdx}
                            className="space-y-2 rounded border border-border bg-background p-3"
                            onClick={() =>
                              setSelectedSectionIndex(sectionIdx)
                            }
                          >
                            {/* Item title */}
                            <div>
                              <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase">
                                Title
                              </label>
                              <input
                                type="text"
                                value={item.title}
                                onChange={(e) =>
                                  updateItemField(
                                    sectionIdx,
                                    itemIdx,
                                    "title",
                                    e.target.value,
                                  )
                                }
                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>

                            {/* Timestamps */}
                            {(item.timestamp_start || item.timestamp_end) && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                <span>
                                  {item.timestamp_start ?? "--"} &rarr;{" "}
                                  {item.timestamp_end ?? "--"}
                                </span>
                              </div>
                            )}

                            {/* Discussion summary */}
                            <div>
                              <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase">
                                Discussion Summary
                              </label>
                              <ContentEditableField
                                value={item.discussion_summary ?? ""}
                                onChange={(html) =>
                                  updateItemField(
                                    sectionIdx,
                                    itemIdx,
                                    "discussion_summary",
                                    html || null,
                                  )
                                }
                                placeholder="Enter discussion summary..."
                              />
                            </div>

                            {/* Motions — read-only */}
                            {item.motions.length > 0 && (
                              <div>
                                <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase">
                                  Motions
                                </label>
                                <div className="space-y-2">
                                  {item.motions.map((motion, mIdx) => (
                                    <div
                                      key={mIdx}
                                      className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground"
                                    >
                                      <p className="mb-1">{motion.text}</p>
                                      <div className="flex flex-wrap gap-2">
                                        {motion.moved_by && (
                                          <span>
                                            Moved: {motion.moved_by}
                                          </span>
                                        )}
                                        {motion.seconded_by && (
                                          <span>
                                            Seconded: {motion.seconded_by}
                                          </span>
                                        )}
                                        {motion.vote && (
                                          <Badge
                                            variant="secondary"
                                            className="text-[10px]"
                                          >
                                            {motion.vote.result} (Y:
                                            {motion.vote.yeas} N:
                                            {motion.vote.nays} A:
                                            {motion.vote.abstentions})
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Speakers — editable names */}
                            {item.speakers.length > 0 && (
                              <div>
                                <label className="mb-1 block text-[10px] font-medium text-muted-foreground uppercase">
                                  Speakers
                                </label>
                                <div className="space-y-1.5">
                                  {item.speakers.map((speaker, sIdx) => (
                                    <div
                                      key={sIdx}
                                      className="flex items-center gap-2"
                                    >
                                      <input
                                        type="text"
                                        value={speaker.name}
                                        onChange={(e) =>
                                          updateSpeakerName(
                                            sectionIdx,
                                            itemIdx,
                                            sIdx,
                                            e.target.value,
                                          )
                                        }
                                        className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                      />
                                      {speaker.topic && (
                                        <span className="text-xs text-muted-foreground">
                                          {speaker.topic}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              );
            },
          )}
        </div>
      </div>

      {/* Right Panel — Source Data (40%) */}
      <div className="w-[40%] bg-muted/30">
        <SourceDataPanel
          meetingId={meetingId}
          selectedSectionIndex={selectedSectionIndex}
          contentJson={editableContent}
        />
      </div>
    </div>
  );
}
