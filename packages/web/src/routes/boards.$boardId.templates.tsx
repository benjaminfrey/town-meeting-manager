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
 * against the same table and were NOT in this task's original file list —
 * **corrected in the wave's final fix round: both are now migrated too.**
 * `DeleteTemplateDialog.tsx` moved onto `trpc.agendaTemplate.delete` in
 * `081a27e` (Task 3); `CreateTemplateDialog.tsx` was still a raw, tenancy-only
 * Supabase insert until the whole-branch review caught it as the one
 * user-facing path that bypassed `agendaTemplate.insert`'s admin gate — see
 * that dialog's own header comment. Both still read the legacy
 * `queryKeys.agendaTemplates.byBoard` key this route used to own (they
 * predate this route's own migration and there was no reason to touch that
 * line while converting the write next to it), so every write below still
 * invalidates BOTH that legacy key and `trpc.agendaTemplate.pathFilter()`
 * during the transition (conventions item 7) — dropping the legacy
 * invalidation would leave `CreateMeetingDialog.tsx`'s board-scoped template
 * picker and `routes/templates.tsx` (both still raw Supabase, no
 * `TODO(phase-e-wave-2)` marker on either — see the conventions doc's
 * Known-gaps entry) stale, along with the template edit route's
 * `.detail(templateId)` read.
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
 * real bad row — see the task report. A dropped section is never silent,
 * either: `handleClone` compares the raw section count against what
 * `parseSections` actually kept and surfaces the difference (see
 * `rawSectionCount` below).
 *
 * `handleClone`/`handleSetDefault` both call `agendaTemplate.insert`/
 * `setDefault`, which are admin-gated (Task 1's design). Both used to
 * `void`-reject silently on `FORBIDDEN` — a non-admin clicking Clone or the
 * default star saw nothing happen at all, the identical failure mode fixed
 * for the auto-create effect above. `actionError` now covers all three
 * write paths with one mechanism.
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

/**
 * How many sections a stored `sections` value held BEFORE `parseSections`
 * dropped any that failed `AgendaTemplateSectionSchema` — the same
 * double-encoding-tolerant parse `parseSections` itself does, duplicated
 * here (rather than changing that shared helper's return shape, which
 * `TemplatePreviewSheet.tsx` and the template edit route also depend on)
 * because `parseSections` only reports what survived, not what did not.
 */
function rawSectionCount(sections: unknown): number {
  try {
    let raw: unknown = JSON.parse(sectionsAsJsonString(sections));
    if (typeof raw === "string") raw = JSON.parse(raw);
    return Array.isArray(raw) ? raw.length : 0;
  } catch {
    return 0;
  }
}

/**
 * A human explanation for a rejected admin-gated write, shared by the
 * auto-create effect, `handleClone` and `handleSetDefault` — all three call
 * an `agendaTemplate.*` procedure gated by `assertCanInsert/UpdateAgendaTemplate`
 * (Task 1's design), so all three can answer FORBIDDEN for a non-admin.
 */
function describeActionError(err: unknown, action: string): string {
  if (isTRPCClientError(err) && err.data?.code === "FORBIDDEN") {
    return `Ask a town administrator to ${action}.`;
  }
  return "Something went wrong. Please try again.";
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
  /**
   * Set when `handleClone` or `handleSetDefault` rejects (most plausibly
   * `FORBIDDEN` for a non-admin, same reasoning as `autoCreateError` above).
   * Both used to `void`-reject with no `onError`/`isError` branch at all —
   * a refused click did nothing visible, which is the same silent-refusal
   * failure the auto-create effect was fixed for, just at two more call
   * sites.
   */
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * Set when `handleClone` succeeds but `parseSections` dropped one or more
   * sections that failed `AgendaTemplateSectionSchema` — see this file's
   * header comment on the forward hazard. Not an error: the clone did
   * succeed, just with fewer sections than the original, and that
   * difference is otherwise invisible (the table just shows a smaller
   * "N sections" count with no explanation of why).
   */
  const [cloneNotice, setCloneNotice] = useState<string | null>(null);

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
        setAutoCreateError(describeActionError(err, "set up this board's first agenda template"));
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
      const rawCount = rawSectionCount(template.sections);
      const sections = parseSections(sectionsAsJsonString(template.sections));
      try {
        await insertTemplate.mutateAsync({
          boardId,
          name: `Copy of ${template.name}`,
          sections,
          isDefault: false,
        });
        setActionError(null);
        setCloneNotice(
          sections.length < rawCount
            ? `Cloned "${template.name}" with ${sections.length} of ${rawCount} sections — ` +
                `the rest could not be copied.`
            : null,
        );
      } catch (err) {
        setCloneNotice(null);
        setActionError(describeActionError(err, "clone this template"));
      }
    },
    [insertTemplate, boardId],
  );

  const handleSetDefault = useCallback(
    async (templateId: string) => {
      try {
        await setDefaultTemplate.mutateAsync({ templateId });
        setActionError(null);
      } catch (err) {
        setActionError(describeActionError(err, "set this template as the default"));
      }
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
      <CreateTemplateDialog boardId={boardId} open={createOpen} onOpenChange={setCreateOpen} />
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

      {actionError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {actionError}
        </div>
      )}

      {cloneNotice && (
        <div
          role="status"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {cloneNotice}
        </div>
      )}

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
