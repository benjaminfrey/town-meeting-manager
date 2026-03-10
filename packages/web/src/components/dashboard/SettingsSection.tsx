/**
 * SettingsSection — collapsible accordion sections for dashboard settings.
 *
 * Wraps each wizard-stage's settings in an accordion panel that shows
 * a read-only summary by default and an inline editor when "Edit" is clicked.
 */

import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

interface SettingsSectionProps {
  value: string;
  title: string;
  summary: ReactNode;
  editor: ReactNode;
  /** External control for edit mode (optional) */
  isEditing?: boolean;
  onEditToggle?: (editing: boolean) => void;
}

export function SettingsSection({
  value,
  title,
  summary,
  editor,
  isEditing: externalEditing,
  onEditToggle,
}: SettingsSectionProps) {
  const [internalEditing, setInternalEditing] = useState(false);
  const isEditing = externalEditing ?? internalEditing;
  const setEditing = onEditToggle ?? setInternalEditing;

  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent>
        <div className="rounded-lg border bg-card p-4 text-card-foreground">
          {isEditing ? (
            editor
          ) : (
            <div className="space-y-3">
              {summary}
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

/** Helper to display a label-value pair in the read-only summary. */
export function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="min-w-[140px] text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
