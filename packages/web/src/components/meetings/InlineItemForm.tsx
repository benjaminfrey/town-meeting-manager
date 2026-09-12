/**
 * InlineItemForm — inline create/edit form for agenda items.
 *
 * Used inside AgendaSection (for adding) and AgendaItemRow (for editing).
 * Supports commentary fields (staff_resource, background, recommendation,
 * suggested_motion) toggled by showCommentary prop.
 *
 * ─── Phase E, wave 4, Task 3 ──────────────────────────────────────────────
 *
 * Three raw `agenda_item` writes, none of which had any authorization check
 * (`agenda_item_tenant_isolation` is tenancy-only), replaced by
 * `agendaItem.insert` / `agendaItem.update` / `agendaItem.delete` — all three
 * A2, board-scoped.
 *
 * **The delete is the one worth naming.** It used to be three unwrapped round
 * trips — every `exhibit` for the item, then every child `agenda_item`, then
 * the item — with no transaction, so any failure left a half-deleted item;
 * and it carried no `TODO(phase-e-wave-*)` marker, so item 11's completeness
 * sweep read this file as done. It is now ONE statement inside one
 * transaction, because both FKs are already `ON DELETE CASCADE`
 * (`agenda_item_parent_item_id_fkey`, `exhibit_agenda_item_id_fkey`); the
 * database removes exactly the same rows. See `agenda-item.ts`'s header.
 *
 * `town_id`, `id`, `status` and `created_at`/`updated_at` are no longer sent
 * from the browser: the procedures take `town_id` from the caller's own
 * session, mint the id with the column's `gen_random_uuid()` default, and
 * hardcode `'pending'` (see `agendaItem.insert`'s doc comment for why the
 * status is not an input). `ItemFormSchema` below stays as the form's own
 * validation — `agenda-item.ts`'s `itemFields` carries the identical bounds
 * on purpose, and says so.
 */

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage } from "@/lib/trpc";
import type { AgendaItem } from "./agenda-types";
import { Loader2, Trash2 } from "lucide-react";
import { z } from "zod";
import { useWizardForm } from "@/hooks/useWizardForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Schema ──────────────────────────────────────────────────────────

const ItemFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).nullable(),
  presenter: z.string().max(100).nullable(),
  estimated_duration: z.number().int().min(0).max(480).nullable(),
  staff_resource: z.string().max(200).nullable(),
  background: z.string().max(5000).nullable(),
  recommendation: z.string().max(2000).nullable(),
  suggested_motion: z.string().max(1000).nullable(),
});

type ItemFormData = z.infer<typeof ItemFormSchema>;

// ─── Component ───────────────────────────────────────────────────────

interface InlineItemFormProps {
  meetingId: string;
  /** The meeting's board — every write below authorizes against it. */
  boardId: string;
  parentItemId: string;
  sectionType: string;
  sortOrder: number;
  existingItem?: AgendaItem;
  showCommentary?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

export function InlineItemForm({
  meetingId,
  boardId,
  parentItemId,
  sectionType,
  sortOrder,
  existingItem,
  showCommentary = false,
  onSaved,
  onCancel,
}: InlineItemFormProps) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = !!existingItem;

  const initial: ItemFormData = {
    title: existingItem?.title ?? "",
    description: existingItem?.description ?? null,
    presenter: existingItem?.presenter ?? null,
    estimated_duration: existingItem?.estimated_duration ?? null,
    staff_resource: existingItem?.staff_resource ?? null,
    background: existingItem?.background ?? null,
    recommendation: existingItem?.recommendation ?? null,
    suggested_motion: existingItem?.suggested_motion ?? null,
  };

  const { values, errors, isValid, setValue, handleBlur, validate } = useWizardForm(
    ItemFormSchema,
    initial,
  );

  /**
   * The legacy key plus the router filter (conventions item 7).
   * `queryKeys.agendaItems.byMeeting` now has NO reader left —
   * `review.tsx`, its last one, moved to `trpc.agendaItem.byMeeting` in
   * Phase E wave 6, Task 4 (`SourceDataPanel.tsx` in Task 3, `live.tsx` in
   * wave 5). The line stays anyway: `cache-key-parity.test.ts` keys off it,
   * and removing the last one from a file removes the tripwire for the next
   * writer added to it — see that file's "Why a dead legacy line is not
   * removed on sight".
   */
  const invalidateItems = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
    // The INSERT branch changes the "N items" count
    // `routes/meetings.$meetingId.tsx`'s shell renders through
    // `trpc.agendaItem.countByMeeting` — this is the exact "add two agenda
    // items, go back, still says 3" regression the `MIGRATED` entry for
    // `agendaItems` exists to catch. The UPDATE branch changes what this
    // screen's own `agendaItem.byMeeting` returns.
    void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
  }, [queryClient, meetingId]);

  const insertItem = useMutation(
    trpc.agendaItem.insert.mutationOptions({
      onSuccess: () => {
        invalidateItems();
        onSaved();
      },
      onError: (err) => setError(refusalMessage(err, "add an item to this agenda")),
    }),
  );

  const updateItem = useMutation(
    trpc.agendaItem.update.mutationOptions({
      onSuccess: () => {
        invalidateItems();
        onSaved();
      },
      onError: (err) => setError(refusalMessage(err, "edit this agenda item")),
    }),
  );

  const deleteItem = useMutation(
    trpc.agendaItem.delete.mutationOptions({
      onSuccess: () => {
        invalidateItems();
        void queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byMeeting(meetingId) });
        // The delete cascades to this item's own exhibits and to its
        // children's, so `exhibit.byMeeting` — this screen's exhibit read
        // since this task — is stale too.
        void queryClient.invalidateQueries(trpc.exhibit.pathFilter());
        setConfirmDelete(false);
        onSaved();
      },
      onError: (err) => setError(refusalMessage(err, "delete this agenda item")),
    }),
  );

  const isSaving = insertItem.isPending || updateItem.isPending;

  const handleSave = useCallback(() => {
    const data = validate();
    if (!data) return;
    setError(null);

    const fields = {
      title: data.title,
      description: data.description,
      presenter: data.presenter,
      estimatedDuration: data.estimated_duration,
      staffResource: data.staff_resource,
      background: data.background,
      recommendation: data.recommendation,
      suggestedMotion: data.suggested_motion,
    };

    if (existingItem) {
      updateItem.mutate({ boardId, itemId: existingItem.id, ...fields });
    } else {
      insertItem.mutate({
        boardId,
        meetingId,
        parentItemId,
        sectionType,
        sortOrder,
        ...fields,
      });
    }
  }, [
    validate,
    existingItem,
    boardId,
    meetingId,
    parentItemId,
    sectionType,
    sortOrder,
    insertItem,
    updateItem,
  ]);

  const handleDelete = useCallback(() => {
    if (!existingItem) return;
    setError(null);
    deleteItem.mutate({ boardId, itemId: existingItem.id });
  }, [existingItem, boardId, deleteItem]);

  return (
    <div className="space-y-3">
      {/* Delete confirmation */}
      {confirmDelete && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Item</AlertDialogTitle>
              <AlertDialogDescription>
                Delete "{values.title}"? This will also remove any sub-items and exhibits.
                {/* A refused delete leaves this dialog open (it closes in
                    `onSuccess`), and Radix marks everything outside it
                    `aria-hidden`, so the error has to be shown IN here or the
                    user is left with a Delete button that appears to do
                    nothing — the exact failure this task exists to avoid. */}
                {error && (
                  <span className="mt-2 block text-destructive" role="alert">
                    {error}
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteItem.isPending}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* A refused or failed write — visible, not a Save button that does
          nothing. These writes are guarded for the first time in this task,
          so FORBIDDEN is newly reachable here. */}
      {error && !confirmDelete && (
        <p
          className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Title */}
      <div className="space-y-1">
        <Label className="text-xs">Title</Label>
        <Input
          value={values.title}
          onChange={(e) => setValue("title", e.target.value)}
          onBlur={() => handleBlur("title")}
          placeholder="Item title"
          autoFocus={!isEditing}
        />
        {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
          value={values.description ?? ""}
          onChange={(e) => setValue("description", e.target.value || null)}
          placeholder="Optional description"
        />
      </div>

      {/* Presenter + Duration */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Presenter</Label>
          <Input
            value={values.presenter ?? ""}
            onChange={(e) => setValue("presenter", e.target.value || null)}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Duration (minutes)</Label>
          <Input
            type="number"
            min={0}
            max={480}
            value={values.estimated_duration ?? ""}
            onChange={(e) =>
              setValue("estimated_duration", e.target.value ? parseInt(e.target.value) : null)
            }
          />
        </div>
      </div>

      {/* Commentary fields */}
      {showCommentary && (
        <div className="space-y-3 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Item Commentary
          </p>
          <div className="space-y-1">
            <Label className="text-xs">Staff resource</Label>
            <Input
              value={values.staff_resource ?? ""}
              onChange={(e) => setValue("staff_resource", e.target.value || null)}
              placeholder="Staff person or department"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Background</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={values.background ?? ""}
              onChange={(e) => setValue("background", e.target.value || null)}
              placeholder="Background information"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Recommendation</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={values.recommendation ?? ""}
              onChange={(e) => setValue("recommendation", e.target.value || null)}
              placeholder="Staff recommendation"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Suggested motion</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={values.suggested_motion ?? ""}
              onChange={(e) => setValue("suggested_motion", e.target.value || null)}
              placeholder='e.g. "Move to approve ___ as presented."'
            />
            {values.suggested_motion &&
              (values.suggested_motion.includes("___") ||
                values.suggested_motion.includes("[TBD]")) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Contains placeholders that should be filled before publishing.
                </p>
              )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <div>
          {isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!isValid || isSaving}>
            {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEditing ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </div>
  );
}
