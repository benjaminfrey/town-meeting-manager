/**
 * AgendaTemplateListPage — /boards/:boardId/templates route
 *
 * Lists agenda templates for a board with create, edit, clone, preview,
 * and delete actions. Auto-creates a default template when none exist.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { usePowerSync, useQuery } from "@powersync/react";
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

// ─── Route ───────────────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { boardId: params.boardId };
}

export default function AgendaTemplateListPage({
  loaderData,
}: Route.ComponentProps) {
  const { boardId } = loaderData;
  const navigate = useNavigate();
  const powerSync = usePowerSync();
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";

  // ─── State ──────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTemplate, setDeleteTemplate] = useState<{
    id: string;
    name: string;
    is_default: number;
  } | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<{
    name: string;
    sections: string;
  } | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────
  const { data: boardRows } = useQuery(
    "SELECT id, name, board_type FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );
  const { data: templateRows } = useQuery(
    "SELECT * FROM agenda_templates WHERE board_id = ? ORDER BY is_default DESC, name ASC",
    [boardId],
  );

  const board = boardRows?.[0] as Record<string, unknown> | undefined;
  const boardName = String(board?.name ?? "");
  const boardType = String(board?.board_type ?? "other");
  const templates = (templateRows ?? []) as Record<string, unknown>[];

  // ─── Auto-create default template ──────────────────────────────────
  const autoCreatedRef = useRef(false);

  useEffect(() => {
    if (
      templateRows &&
      templateRows.length === 0 &&
      !autoCreatedRef.current &&
      townId &&
      board
    ) {
      autoCreatedRef.current = true;
      void createDefaultTemplate(powerSync, boardId, townId, boardType);
    }
  }, [templateRows, townId, board, powerSync, boardId, boardType]);

  // ─── Handlers ───────────────────────────────────────────────────────
  const handleClone = useCallback(
    async (template: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await powerSync.execute(
        `INSERT INTO agenda_templates (id, board_id, town_id, name, is_default, sections, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          template.board_id,
          template.town_id,
          `Copy of ${String(template.name)}`,
          0,
          template.sections,
          now,
          now,
        ],
      );
    },
    [powerSync],
  );

  const handleSetDefault = useCallback(
    async (templateId: string) => {
      await powerSync.execute(
        `UPDATE agenda_templates SET is_default = 0 WHERE board_id = ? AND is_default = 1`,
        [boardId],
      );
      await powerSync.execute(
        `UPDATE agenda_templates SET is_default = 1 WHERE id = ?`,
        [templateId],
      );
    },
    [powerSync, boardId],
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
                const isDefault = t.is_default === 1;
                const sections = parseSections(
                  (t.sections as string) ?? null,
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
                              sections: (t.sections as string) ?? "[]",
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
                              is_default: isDefault ? 1 : 0,
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
  powerSync: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
  boardId: string,
  townId: string,
  boardType: string,
) {
  const sections = getDefaultTemplateSections(boardType);
  const name = getDefaultTemplateName(boardType);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await powerSync.execute(
    `INSERT INTO agenda_templates (id, board_id, town_id, name, is_default, sections, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, boardId, townId, name, 1, JSON.stringify(sections), now, now],
  );
}

export { RouteErrorBoundary as ErrorBoundary };
