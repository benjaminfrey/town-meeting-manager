/**
 * AgendaTemplateEditorPage — /boards/:boardId/templates/:templateId/edit
 *
 * Split-panel editor: left panel has the draggable section list,
 * right panel has the detail editor for the selected section.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { usePowerSync, useQuery } from "@powersync/react";
import { ChevronRight, Loader2, Save } from "lucide-react";
import type { AgendaTemplateSection } from "@town-meeting/shared/types";
import type { Route } from "./+types/boards.$boardId.templates.$templateId.edit";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { SectionListPanel } from "@/components/templates/SectionListPanel";
import { SectionDetailPanel } from "@/components/templates/SectionDetailPanel";
import { parseSections, serializeSections } from "@/lib/agenda-template-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { boardId: params.boardId, templateId: params.templateId };
}

export default function AgendaTemplateEditorPage({
  loaderData,
}: Route.ComponentProps) {
  const { boardId, templateId } = loaderData;
  const powerSync = usePowerSync();

  // ─── Queries ──────────────────────────────────────────────────────
  const { data: boardRows } = useQuery(
    "SELECT id, name FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );
  const { data: templateRows } = useQuery(
    "SELECT * FROM agenda_templates WHERE id = ? LIMIT 1",
    [templateId],
  );

  const board = boardRows?.[0] as Record<string, unknown> | undefined;
  const templateRow = templateRows?.[0] as Record<string, unknown> | undefined;
  const boardName = String(board?.name ?? "");

  // ─── Local state ──────────────────────────────────────────────────
  const [templateName, setTemplateName] = useState("");
  const [sections, setSections] = useState<AgendaTemplateSection[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Initialize from query result
  useEffect(() => {
    if (templateRow && !initialized) {
      const parsed = parseSections((templateRow.sections as string) ?? null);
      setSections(parsed);
      setTemplateName(String(templateRow.name ?? ""));
      setInitialized(true);
    }
  }, [templateRow, initialized]);

  // ─── Handlers ─────────────────────────────────────────────────────

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);

  const handleNameChange = useCallback(
    (name: string) => {
      setTemplateName(name);
      markDirty();
    },
    [markDirty],
  );

  const handleReorder = useCallback(
    (reordered: AgendaTemplateSection[]) => {
      setSections(reordered);
      markDirty();
    },
    [markDirty],
  );

  const handleSectionChange = useCallback(
    (updated: AgendaTemplateSection) => {
      setSections((prev) =>
        prev.map((s, i) => (i === selectedIndex ? updated : s)),
      );
      markDirty();
    },
    [selectedIndex, markDirty],
  );

  const handleAddSection = useCallback(() => {
    const newSection: AgendaTemplateSection = {
      title: "New Section",
      sort_order: sections.length,
      section_type: "other",
      is_fixed: false,
      description: null,
      default_items: [],
      minutes_behavior: "summarize",
      show_item_commentary: false,
    };
    setSections((prev) => [...prev, newSection]);
    setSelectedIndex(sections.length);
    markDirty();
  }, [sections.length, markDirty]);

  const handleRemoveSection = useCallback(
    (index: number) => {
      setSections((prev) => prev.filter((_, i) => i !== index));
      if (selectedIndex >= index && selectedIndex > 0) {
        setSelectedIndex((prev) => prev - 1);
      }
      markDirty();
    },
    [selectedIndex, markDirty],
  );

  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setIsSaving(true);
    try {
      const serialized = serializeSections(sections);
      const now = new Date().toISOString();
      await powerSync.execute(
        `UPDATE agenda_templates SET name = ?, sections = ?, updated_at = ? WHERE id = ?`,
        [templateName, serialized, now, templateId],
      );
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [isDirty, sections, templateName, powerSync, templateId]);

  // ─── Loading ──────────────────────────────────────────────────────
  if (!templateRow || !initialized) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading template...</p>
      </div>
    );
  }

  const selectedSection = sections[selectedIndex];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link
            to="/boards"
            className="hover:text-foreground transition-colors"
          >
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
            to={`/boards/${boardId}/templates`}
            className="hover:text-foreground transition-colors"
          >
            Templates
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Input
            value={templateName}
            onChange={(e) => handleNameChange(e.target.value)}
            className="h-7 w-64 text-sm font-medium border-none bg-transparent px-1 focus-visible:ring-1"
          />
        </nav>

        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={!isDirty || isSaving}
        >
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
      </div>

      {/* Split panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — section list */}
        <div className="w-[320px] border-r flex flex-col overflow-hidden">
          <SectionListPanel
            sections={sections}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onReorder={handleReorder}
            onAdd={handleAddSection}
            onRemove={handleRemoveSection}
          />
        </div>

        {/* Right panel — section detail */}
        <div className="flex-1 overflow-hidden">
          {selectedSection ? (
            <SectionDetailPanel
              section={selectedSection}
              onChange={handleSectionChange}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Select a section to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
