import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface DeleteTemplateDialogProps {
  template: { id: string; name: string; is_default: boolean | number | null };
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteTemplateDialog({
  template,
  boardId,
  open,
  onOpenChange,
}: DeleteTemplateDialogProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const isDefault = !!template.is_default;

  const { mutate: deleteTemplate, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('agenda_template')
        .delete()
        .eq('id', template.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaTemplates.byBoard(boardId) });
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{template.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this agenda template. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isDefault && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            This is the default template for this board. Consider setting
            another template as default before deleting.
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => deleteTemplate()}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Template
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
