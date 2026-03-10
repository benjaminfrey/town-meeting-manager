import { Plus, Trash2, Lock } from "lucide-react";
import type { AgendaTemplateSection } from "@town-meeting/shared/types";
import type { AgendaItemSectionType, MinutesBehavior } from "@town-meeting/shared";
import { SECTION_TYPE_LABELS, MINUTES_BEHAVIOR_LABELS } from "./template-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Standard fixed section titles (cannot rename or change type) ───

const STANDARD_FIXED_TITLES = new Set([
  "Call to Order",
  "Amendments to the Agenda",
  "Minutes of Previous Meeting(s)",
  "Public Comments",
  "New Business",
  "Fiscal Warrants",
  "Adjournment",
]);

// ─── Props ───────────────────────────────────────────────────────────

interface SectionDetailPanelProps {
  section: AgendaTemplateSection;
  onChange: (updated: AgendaTemplateSection) => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function SectionDetailPanel({
  section,
  onChange,
}: SectionDetailPanelProps) {
  const isStandardFixed =
    section.is_fixed && STANDARD_FIXED_TITLES.has(section.title);

  function handleChange<K extends keyof AgendaTemplateSection>(
    field: K,
    value: AgendaTemplateSection[K],
  ) {
    onChange({ ...section, [field]: value });
  }

  function handleDefaultItemChange(index: number, value: string) {
    const items = [...section.default_items];
    items[index] = value;
    handleChange("default_items", items);
  }

  function handleAddDefaultItem() {
    handleChange("default_items", [...section.default_items, ""]);
  }

  function handleRemoveDefaultItem(index: number) {
    const items = section.default_items.filter((_, i) => i !== index);
    handleChange("default_items", items);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b flex items-center gap-2">
        <h3 className="text-sm font-semibold">Section Details</h3>
        {section.is_fixed && (
          <Badge variant="outline" className="text-xs gap-1">
            <Lock className="h-3 w-3" />
            Fixed
          </Badge>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="section-title">Title</Label>
          <Input
            id="section-title"
            value={section.title}
            onChange={(e) => handleChange("title", e.target.value)}
            disabled={isStandardFixed}
          />
        </div>

        {/* Section type */}
        <div className="space-y-1.5">
          <Label>Section Type</Label>
          <Select
            value={section.section_type}
            onValueChange={(v) =>
              handleChange("section_type", v as AgendaItemSectionType)
            }
            disabled={isStandardFixed}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SECTION_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Minutes behavior */}
        <div className="space-y-1.5">
          <Label>Minutes Behavior</Label>
          <Select
            value={section.minutes_behavior}
            onValueChange={(v) =>
              handleChange("minutes_behavior", v as MinutesBehavior)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MINUTES_BEHAVIOR_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Show item commentary */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-commentary"
            checked={section.show_item_commentary}
            onCheckedChange={(checked) =>
              handleChange("show_item_commentary", checked === true)
            }
          />
          <Label htmlFor="show-commentary" className="text-sm">
            Show item commentary
          </Label>
        </div>

        {/* Is fixed (only for custom sections) */}
        {section.section_type === "other" && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="is-fixed"
              checked={section.is_fixed}
              onCheckedChange={(checked) =>
                handleChange("is_fixed", checked === true)
              }
            />
            <Label htmlFor="is-fixed" className="text-sm">
              Fixed section (cannot be removed from meetings)
            </Label>
          </div>
        )}

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="section-description">Description (optional)</Label>
          <Input
            id="section-description"
            value={section.description ?? ""}
            onChange={(e) =>
              handleChange(
                "description",
                e.target.value || null,
              )
            }
            placeholder="Brief description of this section"
          />
        </div>

        {/* Default items */}
        <div className="space-y-2">
          <Label>Default Items</Label>
          <p className="text-xs text-muted-foreground">
            Standing items that appear in this section by default.
          </p>
          <div className="space-y-2">
            {section.default_items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={item}
                  onChange={(e) => handleDefaultItemChange(i, e.target.value)}
                  placeholder={`Item ${i + 1}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 shrink-0"
                  onClick={() => handleRemoveDefaultItem(i)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddDefaultItem}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Item
          </Button>
        </div>
      </div>
    </div>
  );
}
