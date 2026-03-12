/**
 * AgendaTemplateListPage — /boards/:boardId/templates route
 *
 * Lists agenda templates for a board with create, edit, clone, preview,
 * and delete actions. Auto-creates a default template when none exist.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import {
  getDefaultTemplateName,
  getDefaultTemplateSections,
} from "@town-meeting/shared";
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
import { supabase } from "@/lib/supabase";

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { boardId: params.boardId };
}

export default function AgendaTemplateListPage({
  loaderData,
}: Route.ComponentProps) {
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

  // ─── Queries ────────────────────────────────────────────────────────
  const { data: board } = useQuery({
    queryKey: queryKeys.boards.detail(boardId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("id, name, board_type")
        .eq("id", boardId)
        .single()
        .throwOnError();
      return data;
    },
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: queryKeys.agendaTemplates.byBoard(boardId),
    queryFn: async () => {
      const { data } = await supabase
        .from("agenda_template")
        .select("*")
        .eq("board_id", boardId)
        .order("is_default", { ascending: false })
        .order("name", { ascending: true })
        .throwOnError();
      return data ?? [];
    },
  });

  const boardName = String(board?.name ?? "");
  const boardType = String(board?.board_type ?? "other");

  // ─── Auto-create default template ──────────────────────────────────
  // IMPORTANT: Must wait for isLoading to be false before checking length.
  // useQuery initially returns { data: [], isLoading: true } — without this
  // guard the effect would fire on every mount and create duplicates.
  const autoCreatedRef = useRef(false);

  useEffect(() => {
    if (
      !templatesLoading &&
      templates.length === 0 &&
      !autoCreatedRef.current &&
      townId &&
      board
    ) {
      autoCreatedRef.current = true;
      void createDefaultTemplate(boardId, townId, boardType).then(() => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.agendaTemplates.byBoard(boardId),
        });
      });
    }
  }, [templatesLoading, templates, townId, board, boardId, boardType, queryClient]);

  // ─── Handlers ───────────────────────────────────────────────────────
  const handleClone = useCallback(
    async (template: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await supabase
        .from("agenda_template")
        .insert({
          id,
          board_id: template.board_id as string,
          town_id: template.town_id as string,
          name: `Copy of ${String(template.name)}`,
          is_default: false,
          sections: template.sections,
          created_at: now,
          updated_at: now,
        })
        .throwOnError();
      queryClient.invalidateQueries({
        queryKey: queryKeys.agendaTemplates.byBoard(boardId),
      });
    },
    [queryClient, boardId],
  );

  const handleSetDefault = useCallback(
    async (templateId: string) => {
      // Clear current default
      await supabase
        .from("agenda_template")
        .update({ is_default: false })
        .eq("board_id", boardId)
        .eq("is_default", true)
        .throwOnError();
      // Set new default
      await supabase
        .from("agenda_template")
        .update({ is_default: true })
        .eq("id", templateId)
        .throwOnError();
      queryClient.invalidateQueries({
        queryKey: queryKeys.agendaTemplates.byBoard(boardId),
      });
    },
    [queryClient, boardId],
  );

  // ─── Loading ────────────────────────────────────────────────────────
  if (!board) {
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
        <Link
          to="/dashboard"
          className="hover:text-foreground transition-colors"
        >
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to="/boards" className="hover:text-foreground transition-colors">
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
        <span className="text-foreground font-medium">Agenda Templates</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Agenda Templates
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage agenda templates for {boardName}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Template
        </Button>
      </div>

      {/* Template table */}
      {templates.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-card-foreground shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">
            Creating default template...
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Sections
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const id = String(t.id);
                const name = String(t.name ?? "");
                const isDefault = !!t.is_default;
                const sections = parseSections(
                  typeof t.sections === "string"
                    ? t.sections
                    : JSON.stringify(t.sections),
                );
                const sectionCount = sections.length;

                return (
                  <tr
                    key={id}
                    className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/boards/${boardId}/templates/${id}/edit`}
                        className="font-medium text-primary hover:underline"
                      >
                        {name}
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
                          onClick={() =>
                            void navigate(
                              `/boards/${boardId}/templates/${id}/edit`,
                            )
                          }
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
                              name,
                              sections: t.sections ?? "[]",
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
                          onClick={() => void handleClone(t as Record<string, unknown>)}
                          title="Clone"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          <span className="sr-only">Clone</span>
                        </Button>
                        {!isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void handleSetDefault(id)
                            }
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
                              id,
                              name,
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

// ─── Helpers ──────────────────────────────────────────────────────────

async function createDefaultTemplate(
  boardId: string,
  townId: string,
  boardType: string,
) {
  const sections = getDefaultTemplateSections(boardType);
  const name = getDefaultTemplateName(boardType);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await supabase
    .from("agenda_template")
    .insert({
      id,
      board_id: boardId,
      town_id: townId,
      name,
      is_default: true,
      sections,
      created_at: now,
      updated_at: now,
    })
    .throwOnError();
}

export { RouteErrorBoundary as ErrorBoundary };
