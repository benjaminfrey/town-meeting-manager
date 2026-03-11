/**
 * PublishAgendaDialog — confirmation dialog for publishing an agenda.
 *
 * Validates at least 1 item exists.
 * Warns about unfilled placeholders (non-blocking).
 */

import { useCallback, useMemo, useState } from "react";
import { usePowerSync } from "@powersync/react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface PublishAgendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  sections: (Record<string, unknown> & {
    children: Record<string, unknown>[];
  })[];
}

export function PublishAgendaDialog({
  open,
  onOpenChange,
  meetingId,
  sections,
}: PublishAgendaDialogProps) {
  const powerSync = usePowerSync();
  const [isSaving, setIsSaving] = useState(false);

  // Validation
  const totalItems = sections.reduce(
    (sum, s) => sum + s.children.length,
    0,
  );
  const hasItems = totalItems > 0;

  // Check for placeholder warnings
  const placeholderWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const section of sections) {
      for (const item of section.children) {
        const motion = (item.suggested_motion as string) || "";
        if (motion.includes("___") || motion.includes("[TBD]")) {
          warnings.push(
            `"${String(item.title)}" has unfilled placeholders in suggested motion`,
          );
        }
      }
    }
    return warnings;
  }, [sections]);

  const handlePublish = useCallback(async () => {
    if (!hasItems) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      await powerSync.execute(
        `UPDATE meetings SET agenda_status = 'published', updated_at = ? WHERE id = ?`,
        [now, meetingId],
      );
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [hasItems, powerSync, meetingId, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish Agenda</AlertDialogTitle>
          <AlertDialogDescription>
            {hasItems
              ? `Publish the agenda with ${totalItems} item${totalItems !== 1 ? "s" : ""} across ${sections.length} section${sections.length !== 1 ? "s" : ""}?`
              : "The agenda has no items. Add at least one item before publishing."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {placeholderWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Unfilled placeholders
              </p>
            </div>
            <ul className="space-y-1">
              {placeholderWarnings.map((w, i) => (
                <li
                  key={i}
                  className="text-xs text-amber-700 dark:text-amber-300"
                >
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handlePublish()}
            disabled={!hasItems || isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
