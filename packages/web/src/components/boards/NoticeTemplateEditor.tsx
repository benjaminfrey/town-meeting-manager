/**
 * NoticeTemplateEditor — block-based editor for meeting notice templates.
 *
 * Renders the list of template blocks in order, with drag-to-reorder,
 * add/remove/edit per block, and a save button that writes to
 * board.notice_template_blocks.
 */

import { useState, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/queryKeys";
import type {
  NoticeTemplateBlock,
  NoticeBlockType,
  LetterheadConfig,
  MeetingDetailsConfig,
  AgendaSummaryConfig,
  RichTextConfig,
  StatutoryFooterConfig,
  SignatureBlockConfig,
  SpacerConfig,
} from "@town-meeting/shared";
import { NOTICE_BLOCK_LABELS, SINGLETON_BLOCK_TYPES } from "@town-meeting/shared";

// ─── Default configs per block type ─────────────────────────────────

function defaultConfig(type: NoticeBlockType): Record<string, unknown> {
  switch (type) {
    case "letterhead":
      return { logoPosition: "center", showSeal: true, fontSize: "md" } satisfies LetterheadConfig;
    case "meeting_details":
      return { dateLabel: "Date", timeLabel: "Time", locationLabel: "Location", showVirtualLink: false } satisfies MeetingDetailsConfig;
    case "agenda_summary":
      return { includeSubItems: true, maxItems: 0 } satisfies AgendaSummaryConfig;
    case "rich_text":
      return { content: "" } satisfies RichTextConfig;
    case "statutory_footer":
      return { statuteCitation: "" } satisfies StatutoryFooterConfig;
    case "signature_block":
      return { name: "" } satisfies SignatureBlockConfig;
    case "spacer":
      return { height: "md" } satisfies SpacerConfig;
  }
}

// ─── Block config editors ───────────────────────────────────────────

function LetterheadEditor({ config, onChange }: { config: LetterheadConfig; onChange: (c: LetterheadConfig) => void }) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-muted-foreground">
        Logo Position
        <select
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={config.logoPosition}
          onChange={(e) => onChange({ ...config, logoPosition: e.target.value as LetterheadConfig["logoPosition"] })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={config.showSeal}
          onChange={(e) => onChange({ ...config, showSeal: e.target.checked })}
          className="rounded"
        />
        Show Town Seal
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        Font Size
        <select
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={config.fontSize}
          onChange={(e) => onChange({ ...config, fontSize: e.target.value as LetterheadConfig["fontSize"] })}
        >
          <option value="sm">Small</option>
          <option value="md">Medium</option>
          <option value="lg">Large</option>
        </select>
      </label>
    </div>
  );
}

function MeetingDetailsEditor({ config, onChange }: { config: MeetingDetailsConfig; onChange: (c: MeetingDetailsConfig) => void }) {
  return (
    <div className="space-y-3">
      {(["dateLabel", "timeLabel", "locationLabel"] as const).map((field) => (
        <label key={field} className="block text-xs font-medium text-muted-foreground">
          {field.replace("Label", " Label")}
          <input
            type="text"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={config[field]}
            onChange={(e) => onChange({ ...config, [field]: e.target.value })}
          />
        </label>
      ))}
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={config.showVirtualLink}
          onChange={(e) => onChange({ ...config, showVirtualLink: e.target.checked })}
          className="rounded"
        />
        Show Virtual Meeting Link
      </label>
    </div>
  );
}

function AgendaSummaryEditor({ config, onChange }: { config: AgendaSummaryConfig; onChange: (c: AgendaSummaryConfig) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={config.includeSubItems}
          onChange={(e) => onChange({ ...config, includeSubItems: e.target.checked })}
          className="rounded"
        />
        Include Sub-Items
      </label>
      <label className="block text-xs font-medium text-muted-foreground">
        Max Items (0 = all)
        <input
          type="number"
          min={0}
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={config.maxItems}
          onChange={(e) => onChange({ ...config, maxItems: parseInt(e.target.value) || 0 })}
        />
      </label>
    </div>
  );
}

function RichTextEditor({ config, onChange }: { config: RichTextConfig; onChange: (c: RichTextConfig) => void }) {
  const mergeFields = [
    "{{board_name}}",
    "{{town_name}}",
    "{{meeting_date}}",
    "{{meeting_time}}",
    "{{meeting_location}}",
    "{{presiding_officer}}",
    "{{recording_secretary}}",
  ];

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-muted-foreground">
        Content
        <textarea
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[100px]"
          value={config.content}
          onChange={(e) => onChange({ ...config, content: e.target.value })}
          placeholder="Enter notice body text..."
        />
      </label>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">
          Insert Merge Field
        </p>
        <div className="flex flex-wrap gap-1">
          {mergeFields.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() =>
                onChange({ ...config, content: config.content + " " + field })
              }
              className="rounded border px-2 py-0.5 text-xs hover:bg-accent transition-colors"
            >
              {field}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatutoryFooterEditor({ config, onChange }: { config: StatutoryFooterConfig; onChange: (c: StatutoryFooterConfig) => void }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      Statute Citation
      <input
        type="text"
        className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
        value={config.statuteCitation}
        onChange={(e) => onChange({ ...config, statuteCitation: e.target.value })}
        placeholder="e.g. 1 M.R.S.A. §403"
      />
    </label>
  );
}

function SignatureBlockEditor({ config, onChange }: { config: SignatureBlockConfig; onChange: (c: SignatureBlockConfig) => void }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      Name
      <input
        type="text"
        className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
        value={config.name}
        onChange={(e) => onChange({ ...config, name: e.target.value })}
        placeholder="Clerk's name"
      />
    </label>
  );
}

function SpacerEditor({ config, onChange }: { config: SpacerConfig; onChange: (c: SpacerConfig) => void }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      Height
      <select
        className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
        value={config.height}
        onChange={(e) => onChange({ ...config, height: e.target.value as SpacerConfig["height"] })}
      >
        <option value="sm">Small</option>
        <option value="md">Medium</option>
        <option value="lg">Large</option>
      </select>
    </label>
  );
}

function BlockConfigEditor({
  block,
  onConfigChange,
}: {
  block: NoticeTemplateBlock;
  onConfigChange: (config: Record<string, unknown>) => void;
}) {
  const config = block.config;

  switch (block.type) {
    case "letterhead":
      return <LetterheadEditor config={config as unknown as LetterheadConfig} onChange={(c) => onConfigChange(c as unknown as Record<string, unknown>)} />;
    case "meeting_details":
      return <MeetingDetailsEditor config={config as unknown as MeetingDetailsConfig} onChange={(c) => onConfigChange(c as unknown as Record<string, unknown>)} />;
    case "agenda_summary":
      return <AgendaSummaryEditor config={config as unknown as AgendaSummaryConfig} onChange={(c) => onConfigChange(c as unknown as Record<string, unknown>)} />;
    case "rich_text":
      return <RichTextEditor config={config as unknown as RichTextConfig} onChange={(c) => onConfigChange(c as unknown as Record<string, unknown>)} />;
    case "statutory_footer":
      return <StatutoryFooterEditor config={config as unknown as StatutoryFooterConfig} onChange={(c) => onConfigChange(c as unknown as Record<string, unknown>)} />;
    case "signature_block":
      return <SignatureBlockEditor config={config as unknown as SignatureBlockConfig} onChange={(c) => onConfigChange(c as unknown as Record<string, unknown>)} />;
    case "spacer":
      return <SpacerEditor config={config as unknown as SpacerConfig} onChange={(c) => onConfigChange(c as unknown as Record<string, unknown>)} />;
    default:
      return null;
  }
}

function blockSummary(block: NoticeTemplateBlock): string {
  const c = block.config;
  switch (block.type) {
    case "letterhead":
      return `Logo ${(c as unknown as LetterheadConfig).logoPosition}, ${(c as unknown as LetterheadConfig).showSeal ? "seal" : "no seal"}, ${(c as unknown as LetterheadConfig).fontSize}`;
    case "meeting_details":
      return `${(c as unknown as MeetingDetailsConfig).showVirtualLink ? "Includes virtual link" : "In-person only"}`;
    case "agenda_summary": {
      const ac = c as unknown as AgendaSummaryConfig;
      return `${ac.maxItems === 0 ? "All items" : `Up to ${ac.maxItems}`}${ac.includeSubItems ? ", with sub-items" : ""}`;
    }
    case "rich_text": {
      const content = (c as unknown as RichTextConfig).content;
      return content.length > 60 ? content.slice(0, 60) + "..." : content || "(empty)";
    }
    case "statutory_footer":
      return (c as unknown as StatutoryFooterConfig).statuteCitation || "(no citation)";
    case "signature_block":
      return (c as unknown as SignatureBlockConfig).name || "(no name)";
    case "spacer":
      return `Height: ${(c as unknown as SpacerConfig).height}`;
  }
}

// ─── Main component ────────────────────────────────────────────────

export function NoticeTemplateEditor({
  boardId,
  initialBlocks,
}: {
  boardId: string;
  initialBlocks: NoticeTemplateBlock[] | null;
}) {
  const queryClient = useQueryClient();
  const [blocks, setBlocks] = useState<NoticeTemplateBlock[]>(
    initialBlocks ?? []
  );
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ─── Drag state ────────────────────────────────────────────────
  const dragIdx = useRef<number | null>(null);

  const handleDragStart = useCallback((idx: number) => {
    dragIdx.current = idx;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (dragIdx.current === null || dragIdx.current === idx) return;
      setBlocks((prev) => {
        const next = [...prev];
        const removed = next.splice(dragIdx.current!, 1);
        const dragged = removed[0]!;
        next.splice(idx, 0, dragged);
        dragIdx.current = idx;
        return next.map((b, i) => ({ ...b, order: i }));
      });
      setDirty(true);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    dragIdx.current = null;
  }, []);

  // ─── Block CRUD ────────────────────────────────────────────────
  const addBlock = (type: NoticeBlockType) => {
    const newBlock: NoticeTemplateBlock = {
      id: crypto.randomUUID(),
      type,
      order: blocks.length,
      config: defaultConfig(type),
    };
    setBlocks((prev) => [...prev, newBlock]);
    setExpandedBlockId(newBlock.id);
    setShowAddMenu(false);
    setDirty(true);
  };

  const removeBlock = (blockId: string) => {
    setBlocks((prev) =>
      prev.filter((b) => b.id !== blockId).map((b, i) => ({ ...b, order: i }))
    );
    if (expandedBlockId === blockId) setExpandedBlockId(null);
    setDirty(true);
  };

  const updateBlockConfig = (blockId: string, config: Record<string, unknown>) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, config } : b))
    );
    setDirty(true);
  };

  // Available block types (respect singleton rules)
  const usedSingletonTypes = new Set(
    blocks.filter((b) => SINGLETON_BLOCK_TYPES.includes(b.type)).map((b) => b.type)
  );

  const ALL_BLOCK_TYPES: NoticeBlockType[] = [
    "letterhead",
    "meeting_details",
    "agenda_summary",
    "rich_text",
    "statutory_footer",
    "signature_block",
    "spacer",
  ];

  const availableTypes = ALL_BLOCK_TYPES.filter(
    (t) => !usedSingletonTypes.has(t)
  );

  // ─── Save ──────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("board")
        .update({ notice_template_blocks: blocks as unknown as Record<string, unknown>[] })
        .eq("id", boardId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(boardId) });
      setDirty(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Meeting Notice Template</h3>
          <p className="text-sm text-muted-foreground">
            {blocks.length === 0
              ? "No template configured. Add blocks to build a template."
              : `${blocks.length} block${blocks.length !== 1 ? "s" : ""} configured`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddMenu(!showAddMenu)}
              disabled={availableTypes.length === 0}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Block
            </Button>
            {showAddMenu && (
              <div className="absolute right-0 z-10 mt-1 w-52 rounded-md border bg-popover p-1 shadow-md">
                {availableTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addBlock(type)}
                    className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                  >
                    {NOTICE_BLOCK_LABELS[type]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="mr-1 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Template"}
          </Button>
        </div>
      </div>

      {saveMutation.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Failed to save template. Please try again.
        </div>
      )}

      {blocks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Click "Add Block" to start building your notice template.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {blocks.map((block, idx) => {
            const isExpanded = expandedBlockId === block.id;
            return (
              <div
                key={block.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className="rounded-lg border bg-card shadow-sm"
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {NOTICE_BLOCK_LABELS[block.type]}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {blockSummary(block)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedBlockId(isExpanded ? null : block.id)
                    }
                    className="rounded p-1 hover:bg-accent transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(block.id)}
                    className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="border-t px-4 py-3">
                    <BlockConfigEditor
                      block={block}
                      onConfigChange={(config) =>
                        updateBlockConfig(block.id, config)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
