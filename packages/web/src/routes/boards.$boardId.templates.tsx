/**
 * AgendaTemplateListPage — /boards/:boardId/templates route
 *
 * Lists agenda templates for a board with create, edit, clone, preview,
 * and delete actions. Auto-creates a default template when none exist.
 *
 * Wave 2, Task 2 — this route's board read, templates read, and its four
 * writes against `agenda_template` (clone-insert, the two-step
 * clear-then-set default, and the auto-create insert) move onto
 * `trpc.board.detail`/`trpc.agendaTemplate.*`. `CreateTemplateDialog.tsx` and
 * `DeleteTemplateDialog.tsx` are separate components with their own writes
 * against the same table and are NOT in this task's file list — they still
 * read/write through `@/lib/supabase` and still read the legacy
 * `queryKeys.agendaTemplates.byBoard` key this route used to own, so every
 * write below invalidates BOTH that legacy key and
 * `trpc.agendaTemplate.pathFilter()` during the transition (conventions item
 * 7) — dropping the legacy invalidation would leave those two dialogs' own
 * reads (and `CreateMeetingDialog.tsx`'s board-scoped template picker, and
 * the template edit route's `.detail(templateId)` read) stale.
 *
 * `handleClone`'s forward hazard (flagged in Task 1's review): `sections`
 * from `agendaTemplate.list` is `unknown`, and `agendaTemplate.insert`
 * validates it against `AgendaTemplateSectionSchema` — a legacy or
 * hand-edited row that failed that schema would turn what used to be an
 * always-succeeding client-trusted copy into a `BAD_REQUEST`. Closed here by
 * running the clone's `sections` through `parseSections` (the same Zod
 * schema, client-side) before sending: a row that fails validation degrades
 * to a partial clone (parseSections drops only the sections that do not
 * parse) instead of failing the whole clone. The local `agenda_template`
 * table has 0 rows, so this is still reasoned rather than measured against a
 * real bad row — see the task report.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { getDefaultTemplateName, getDefaultTemplateSections } from "@town-meeting/shared";
import type { Route } from "./+types/boards.$boardId.templates";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { CreateTemplateDialog } from "@/components/templates/CreateTemplateDialog";
import { DeleteTemplateDialog } from "@/components/templates/DeleteTemplateDialog";
import { TemplatePreviewSheet } from "@/components/templates/TemplatePreviewSheet";
import { parseSections } from "@/lib/agenda-template-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, type RouterOutputs } from "@/lib/trpc";

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { boardId: params.boardId };
}

/** A template row as `agendaTemplate.list` returns it. */
type TemplateRow = RouterOutputs["agendaTemplate"]["list"][number];

/** `t.sections` is `unknown` off the wire — see `agendaTemplate.list`'s own doc comment. */
function sectionsAsJsonString(sections: unknown): string {
  return typeof sections === "string" ? sections : JSON.stringify(sections ?? []);
}

export default function AgendaTemplateListPage({ loaderData }: Route.ComponentProps) {
  const { boardId } = loaderData;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";

  // ─── State ──────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTemplate, setDeleteTemplate] = useState<{
    id: string;
    name: string;
    is_default: boolean;
  } | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<{
    name: string;
    sections: string;
  } | null>(null);
  /**
   * Set only if the auto-create effect's mutation rejects — most plausibly
   * `FORBIDDEN`, a real behavior change this migration introduces and worth
   * naming rather than leaving silent: `agendaTemplate.insert` is
   * admin-gated (`assertCanInsertAgendaTemplate` in `authorization/rules.ts`,
   * Task 1's own design, not something this task changes), where the
   * Supabase insert this replaces was tenancy-only. A non-admin opening a
   * brand-new board's Templates tab first now sees this instead of
   * "Creating default template..." staying true forever with no visible
   * explanation.
   */
  const [autoCreateError, setAutoCreateError] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────
  const {
    data: board,
    isLoading: isBoardLoading,
    isError: isBoardError,
    error: boardError,
  } = useQuery(trpc.board.detail.queryOptions({ boardId }));

  const { data: templates = [], isLoading: templatesLoading } = useQuery(
    trpc.agendaTemplate.list.queryOptions({ boardId }),
  );

  const boardName = board?.name ?? "";
  const boardType = board?.board_type ?? "other";

  // A read that already invalidates both keys below (see this file's own
  // header comment for why both are still owed during the transition).
  const invalidateTemplates = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agendaTemplates.byBoard(boardId) });
    void queryClient.invalidateQueries(trpc.agendaTemplate.pathFilter());
  }, [queryClient, boardId]);

  const insertTemplate = useMutation(
    trpc.agendaTemplate.insert.mutationOptions({ onSuccess: invalidateTemplates }),
  );
  const setDefaultTemplate = useMutation(
    trpc.agendaTemplate.setDefault.mutationOptions({ onSuccess: invalidateTemplates }),
  );

  // ─── Auto-create default template ──────────────────────────────────
  // IMPORTANT: Must wait for isLoading to be false before checking length.
  // useQuery initially returns { data: [], isLoading: true } — without this
  // guard the effect would fire on every mount and create duplicates.
  const autoCreatedRef = useRef(false);
  const { mutateAsync: insertTemplateAsync } = insertTemplate;

  useEffect(() => {
    if (!templatesLoading && templates.length === 0 && !autoCreatedRef.current && townId && board) {
      autoCreatedRef.current = true;
      insertTemplateAsync({
        boardId,
        name: getDefaultTemplateName(boardType),
        sections: getDefaultTemplateSections(boardType),
        isDefault: true,
      }).catch((err: unknown) => {
        setAutoCreateError(
          isTRPCClientError(err) && err.data?.code === "FORBIDDEN"
            ? "Ask a town administrator to set up this board's first agenda template."
            : "Something went wrong creating a default template.",
        );
      });
    }
  }, [templatesLoading, templates, townId, board, boardId, boardType, insertTemplateAsync]);

  // ─── Handlers ───────────────────────────────────────────────────────
  const handleClone = useCallback(
    async (template: TemplateRow) => {
      // See this file's own header comment: `parseSections` runs the same
      // Zod schema `agendaTemplate.insert` validates against, client-side,
      // so a section that would fail the server's validation is dropped here
      // instead of turning the whole clone into a BAD_REQUEST.
      const sections = parseSections(sectionsAsJsonString(template.sections));
      await insertTemplate.mutateAsync({
        boardId,
        name: `Copy of ${template.name}`,
        sections,
        isDefault: false,
      });
    },
    [insertTemplate, boardId],
  );

  const handleSetDefault = useCallback(
    async (templateId: string) => {
      await setDefaultTemplate.mutateAsync({ templateId });
    },
    [setDefaultTemplate],
  );

  // ─── Error / loading ────────────────────────────────────────────────
  // A screen that renders nothing and says nothing for a bad boardId is the
  // failure mode this migration exists to end (conventions item 5).
  if (isBoardError) {
    const notFound = isTRPCClientError(boardError) && boardError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This board could not be found."
              : "Something went wrong loading this board's templates."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {notFound
              ? "It may have been deleted, or it belongs to another town."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
          <Link to="/boards" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to Boards
          </Link>
        </div>
      </div>
    );
  }

  if (isBoardLoading || !board) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Dialogs */}
      <CreateTemplateDialog
        boardId={boardId}
        townId={townId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      {deleteTemplate && (
        <DeleteTemplateDialog
          template={deleteTemplate}
          boardId={boardId}
          open={!!deleteTemplate}
          onOpenChange={(open) => {
            if (!open) setDeleteTemplate(null);
          }}
        />
      )}
      <TemplatePreviewSheet
        template={previewTemplate}
        open={!!previewTemplate}
        onOpenChange={(open) => {
          if (!open) setPreviewTemplate(null);
        }}
      />

      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/dashboard" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to="/boards" className="hover:text-foreground transition-colors">
          Boards
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to={`/boards/${boardId}`} className="hover:text-foreground transition-colors">
          {boardName}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">Agenda Templates</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agenda Templates</h1>
          <p className="mt-1 text-muted-foreground">Manage agenda templates for {boardName}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Template
        </Button>
      </div>

      {/* Template table */}
      {templates.length === 0 ? (
        <div
          className="rounded-lg border bg-card p-12 text-center text-card-foreground shadow-sm"
          role={autoCreateError ? "alert" : undefined}
        >
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">
            {autoCreateError ?? "Creating default template..."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Sections</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const isDefault = !!t.is_default;
                const sections = parseSections(sectionsAsJsonString(t.sections));
                const sectionCount = sections.length;

                return (
                  <tr
                    key={t.id}
                    className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/boards/${boardId}/templates/${t.id}/edit`}
                        className="font-medium text-primary hover:underline"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {sectionCount} section{sectionCount !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3">
                      {isDefault && (
                        <Badge className="bg-blue-600 text-white hover:bg-blue-600">
                          <Star className="mr-1 h-3 w-3" />
                          Default
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void navigate(`/boards/${boardId}/templates/${t.id}/edit`)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPreviewTemplate({
                              name: t.name,
                              sections: sectionsAsJsonString(t.sections),
                            })
                          }
                          title="Preview"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span className="sr-only">Preview</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleClone(t)}
                          title="Clone"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          <span className="sr-only">Clone</span>
                        </Button>
                        {!isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleSetDefault(t.id)}
                            title="Set as default"
                          >
                            <Star className="h-3.5 w-3.5" />
                            <span className="sr-only">Set as default</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDeleteTemplate({
                              id: t.id,
                              name: t.name,
                              is_default: isDefault,
                            })
                          }
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
