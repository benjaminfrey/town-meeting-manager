/**
 * InlineItemForm — inline create/edit form for agenda items.
 *
 * Used inside AgendaSection (for adding) and AgendaItemRow (for editing).
 * Supports commentary fields (staff_resource, background, recommendation,
 * suggested_motion) toggled by showCommentary prop.
 */

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
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
  townId: string;
  parentItemId: string;
  sectionType: string;
  sortOrder: number;
  existingItem?: Record<string, unknown>;
  showCommentary?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

export function InlineItemForm({
  meetingId,
  townId,
  parentItemId,
  sectionType,
  sortOrder,
  existingItem,
  showCommentary = false,
  onSaved,
  onCancel,
}: InlineItemFormProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isEditing = !!existingItem;

  const initial: ItemFormData = {
    title: isEditing ? String(existingItem.title ?? "") : "",
    description: isEditing ? (existingItem.description as string) ?? null : null,
    presenter: isEditing ? (existingItem.presenter as string) ?? null : null,
    estimated_duration: isEditing
      ? existingItem.estimated_duration != null
        ? Number(existingItem.estimated_duration)
        : null
      : null,
    staff_resource: isEditing ? (existingItem.staff_resource as string) ?? null : null,
    background: isEditing ? (existingItem.background as string) ?? null : null,
    recommendation: isEditing ? (existingItem.recommendation as string) ?? null : null,
    suggested_motion: isEditing ? (existingItem.suggested_motion as string) ?? null : null,
  };

  const { values, errors, isValid, setValue, handleBlur, validate } =
    useWizardForm(ItemFormSchema, initial);

  const handleSave = useCallback(async () => {
    const data = validate();
    if (!data) return;

    setIsSaving(true);
    try {
      const now = new Date().toISOString();

      if (isEditing) {
        const { error } = await supabase
          .from('agenda_item')
          .update({
            title: data.title,
            description: data.description,
            presenter: data.presenter,
            estimated_duration: data.estimated_duration,
            staff_resource: data.staff_resource,
            background: data.background,
            recommendation: data.recommendation,
            suggested_motion: data.suggested_motion,
            updated_at: now,
          })
          .eq('id', String(existingItem.id));
        if (error) throw error;
      } else {
        const id = crypto.randomUUID();
        const { error } = await supabase.from('agenda_item').insert({
          id,
          meeting_id: meetingId,
          town_id: townId,
          section_type: sectionType,
          sort_order: sortOrder,
          title: data.title,
          description: data.description,
          presenter: data.presenter,
          estimated_duration: data.estimated_duration,
          parent_item_id: parentItemId,
          status: 'pending',
          staff_resource: data.staff_resource,
          background: data.background,
          recommendation: data.recommendation,
          suggested_motion: data.suggested_motion,
          created_at: now,
          updated_at: now,
        });
        if (error) throw error;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
      onSaved();
    } finally {
      setIsSaving(false);
    }
  }, [
    validate,
    isEditing,
    existingItem,
    supabase,
    queryClient,
    meetingId,
    townId,
    sectionType,
    sortOrder,
    parentItemId,
    onSaved,
  ]);

  const handleDelete = useCallback(async () => {
    if (!existingItem) return;
    const itemId = String(existingItem.id);
    // Delete exhibits first
    const { error: exhibitError } = await supabase
      .from('exhibit')
      .delete()
      .eq('agenda_item_id', itemId);
    if (exhibitError) throw exhibitError;
    // Delete child items
    const { error: childError } = await supabase
      .from('agenda_item')
      .delete()
      .eq('parent_item_id', itemId);
    if (childError) throw childError;
    // Delete the item itself
    const { error } = await supabase
      .from('agenda_item')
      .delete()
      .eq('id', itemId);
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byMeeting(meetingId) });
    setConfirmDelete(false);
    onSaved();
  }, [existingItem, supabase, queryClient, meetingId, onSaved]);

  return (
    <div className="space-y-3">
      {/* Delete confirmation */}
      {confirmDelete && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Item</AlertDialogTitle>
              <AlertDialogDescription>
                Delete "{values.title}"? This will also remove any sub-items and
                exhibits.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
        {errors.title && (
          <p className="text-xs text-destructive">{errors.title}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
          value={values.description ?? ""}
          onChange={(e) =>
            setValue("description", e.target.value || null)
          }
          placeholder="Optional description"
        />
      </div>

      {/* Presenter + Duration */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Presenter</Label>
          <Input
            value={values.presenter ?? ""}
            onChange={(e) =>
              setValue("presenter", e.target.value || null)
            }
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
              setValue(
                "estimated_duration",
                e.target.value ? parseInt(e.target.value) : null,
              )
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
              onChange={(e) =>
                setValue("staff_resource", e.target.value || null)
              }
              placeholder="Staff person or department"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Background</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={values.background ?? ""}
              onChange={(e) =>
                setValue("background", e.target.value || null)
              }
              placeholder="Background information"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Recommendation</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={values.recommendation ?? ""}
              onChange={(e) =>
                setValue("recommendation", e.target.value || null)
              }
              placeholder="Staff recommendation"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Suggested motion</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              value={values.suggested_motion ?? ""}
              onChange={(e) =>
                setValue("suggested_motion", e.target.value || null)
              }
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
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!isValid || isSaving}
          >
            {isSaving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEditing ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </div>
  );
}
