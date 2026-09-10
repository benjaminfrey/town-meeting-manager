/**
 * AgendaTemplateEditorPage — /boards/:boardId/templates/:templateId/edit
 *
 * Split-panel editor: left panel has the draggable section list,
 * right panel has the detail editor for the selected section.
 *
 * Named as the intended caller in both `agendaTemplate.detail`'s and
 * `agendaTemplate.update`'s own doc comments
 * (`packages/api/src/trpc/routers/agenda-template.ts`) since those
 * procedures shipped in wave 2, Task 1 — wired here in Phase E wave 4,
 * Task 0. The `templateRow` read and the save write now go through
 * `trpc.agendaTemplate.detail`/`trpc.agendaTemplate.update`; the board-name
 * breadcrumb read stays on raw Supabase (out of this marker's scope — see
 * the `board` query below). Converting the write also closes the
 * non-admin-can-write gap this file's header used to describe:
 * `agendaTemplate.update` carries `requireActor(assertCanUpdateAgendaTemplate)`
 * (declared before `.input()`, conventions item 2), so a non-admin save now
 * answers FORBIDDEN instead of writing silently.
 *
 * Cache keys: `queryKeys.agendaTemplates.detail(templateId)` had exactly one
 * reader and one writer in the whole tree — both in this file (checked via
 * `grep -rn "queryKeys\.agendaTemplates" packages/web/src`) — so migrating
 * this file's read is also retiring the last consumer, and its invalidation
 * is dropped rather than kept as a legacy line (conventions item 7: "the
 * legacy line stays because other, unmigrated screens still read that key ...
 * not before"; there is no "before" left here). `queryKeys.agendaTemplates.byBoard(boardId)`
 * is NOT dropped: `CreateTemplateDialog.tsx`, `DeleteTemplateDialog.tsx` and
 * `boards.$boardId.templates.tsx` still read it, so `handleSave` keeps
 * invalidating both that key and `trpc.agendaTemplate.pathFilter()` — the
 * latter also covers this file's own `agendaTemplate.detail` read, since
 * `pathFilter()` matches every procedure under the `agendaTemplate` router.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { AlertTriangle, ChevronRight, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import type { AgendaTemplateSection } from "@town-meeting/shared/types";
import type { Route } from "./+types/boards.$boardId.templates.$templateId.edit";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { SectionListPanel } from "@/components/templates/SectionListPanel";
import { SectionDetailPanel } from "@/components/templates/SectionDetailPanel";
import { parseSections, serializeSections } from "@/lib/agenda-template-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { queryClient as globalQueryClient } from "@/lib/queryClient";
import { trpc, errorMessage } from "@/lib/trpc";

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const templateId = params.templateId;
  // Not wrapped in try/catch: a nonexistent or foreign template answers
  // NOT_FOUND (`agendaTemplate.detail`'s own doc comment), and letting that
  // reject routes to `RouteErrorBoundary` below — the same shape
  // `boards.$boardId.tsx`'s loader uses (conventions item 12).
  await globalQueryClient.ensureQueryData(trpc.agendaTemplate.detail.queryOptions({ templateId }));
  return { boardId: params.boardId, templateId };
}

export default function AgendaTemplateEditorPage({ loaderData }: Route.ComponentProps) {
  const { boardId, templateId } = loaderData;
  const queryClient = useQueryClient();

  // ─── Queries ──────────────────────────────────────────────────────
  const { data: board } = useQuery({
    queryKey: queryKeys.boards.detail(boardId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("id, name")
        .eq("id", boardId)
        .single()
        .throwOnError();
      return data;
    },
  });

  const {
    data: templateRow,
    isError: isTemplateError,
    error: templateError,
  } = useQuery(trpc.agendaTemplate.detail.queryOptions({ templateId }));

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
      const raw = templateRow.sections;
      const parsed = parseSections(typeof raw === "string" ? raw : JSON.stringify(raw));
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
      setSections((prev) => prev.map((s, i) => (i === selectedIndex ? updated : s)));
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

  const updateTemplate = useMutation(trpc.agendaTemplate.update.mutationOptions());
  const { mutateAsync: updateTemplateAsync } = updateTemplate;

  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setIsSaving(true);
    try {
      const serialized = serializeSections(sections);
      await updateTemplateAsync({
        templateId,
        name: templateName,
        sections: JSON.parse(serialized),
      });
      setIsDirty(false);
      // `queryKeys.agendaTemplates.detail(templateId)` is NOT invalidated
      // here any more — this file's own `templateRow` read was its last
      // consumer in the tree, and that read moved onto
      // `trpc.agendaTemplate.detail` above (see this file's own header).
      // `queryKeys.agendaTemplates.byBoard(boardId)` stays: `CreateTemplateDialog.tsx`,
      // `DeleteTemplateDialog.tsx` and `boards.$boardId.templates.tsx` still
      // read it.
      queryClient.invalidateQueries({
        queryKey: queryKeys.agendaTemplates.byBoard(boardId),
      });
      // Also covers this file's own `agendaTemplate.detail` read —
      // `pathFilter()` matches every procedure under the `agendaTemplate`
      // router, not just `list` (`boards.$boardId.templates.tsx`'s own
      // reader).
      queryClient.invalidateQueries(trpc.agendaTemplate.pathFilter());
    } catch (err) {
      // A non-admin FORBIDDEN from the newly-guarded `agendaTemplate.update`
      // (see this file's header) has to surface somewhere — the raw
      // `.throwOnError()` this replaced was already silent here, but closing
      // that authorization hole is what makes the refusal reachable in the
      // first place, and a caught-and-dropped error is not actually
      // surfaced. Same shape as `AddPersonDialog`'s `onError` handlers.
      toast.error(errorMessage(err, "Couldn't save the template — please try again."));
    } finally {
      setIsSaving(false);
    }
  }, [isDirty, sections, templateName, templateId, boardId, queryClient, updateTemplateAsync]);

  // ─── Error / loading ──────────────────────────────────────────────
  if (isTemplateError) {
    const notFound = isTRPCClientError(templateError) && templateError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This template could not be found."
              : "Something went wrong loading this template."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {notFound
              ? "It may have been deleted, or it belongs to another board."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
          <Link
            to={`/boards/${boardId}/templates`}
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Back to Templates
          </Link>
        </div>
      </div>
    );
  }

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
          <Link to="/boards" className="hover:text-foreground transition-colors">
            Boards
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link to={`/boards/${boardId}`} className="hover:text-foreground transition-colors">
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

        <Button size="sm" onClick={() => void handleSave()} disabled={!isDirty || isSaving}>
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
            <SectionDetailPanel section={selectedSection} onChange={handleSectionChange} />
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
