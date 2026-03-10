import { Lock } from "lucide-react";
import { parseSections } from "@/lib/agenda-template-helpers";
import { SECTION_TYPE_LABELS, MINUTES_BEHAVIOR_LABELS } from "./template-labels";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface TemplatePreviewSheetProps {
  template: { name: string; sections: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplatePreviewSheet({
  template,
  open,
  onOpenChange,
}: TemplatePreviewSheetProps) {
  const sections = template ? parseSections(template.sections) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{template?.name ?? "Template Preview"}</SheetTitle>
          <SheetDescription>{sections.length} sections</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto flex-1 px-4 py-2">
          {sections.map((section, i) => (
            <div
              key={i}
              className="flex items-start gap-3 py-3 border-b last:border-b-0"
            >
              <span className="text-sm font-mono text-muted-foreground w-6 shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{section.title}</span>
                  {section.is_fixed && (
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <Badge variant="outline" className="text-xs">
                    {SECTION_TYPE_LABELS[section.section_type] ?? section.section_type}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {MINUTES_BEHAVIOR_LABELS[section.minutes_behavior] ?? section.minutes_behavior}
                  </Badge>
                  {section.show_item_commentary && (
                    <Badge variant="secondary" className="text-xs">
                      Commentary
                    </Badge>
                  )}
                </div>
                {section.default_items.length > 0 && (
                  <ul className="mt-1.5 ml-3 text-xs text-muted-foreground list-disc">
                    {section.default_items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
