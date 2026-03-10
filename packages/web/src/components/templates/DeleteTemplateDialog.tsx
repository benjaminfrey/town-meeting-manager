import { useCallback, useState } from "react";
import { usePowerSync } from "@powersync/react";
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
  template: { id: string; name: string; is_default: number | boolean };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteTemplateDialog({
  template,
  open,
  onOpenChange,
}: DeleteTemplateDialogProps) {
  const powerSync = usePowerSync();
  const [isDeleting, setIsDeleting] = useState(false);

  const isDefault = template.is_default === 1 || template.is_default === true;

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await powerSync.execute(
        `DELETE FROM agenda_templates WHERE id = ?`,
        [template.id],
      );
      onOpenChange(false);
    } finally {
      setIsDeleting(false);
    }
  }, [powerSync, template.id, onOpenChange]);

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
            onClick={() => void handleDelete()}
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
