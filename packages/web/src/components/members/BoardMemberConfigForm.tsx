/**
 * BoardMemberConfigForm — form for configuring a board member's seat,
 * term dates, government title, and recording secretary default.
 */

import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface BoardMemberFormData {
  seat_title: string;
  term_start: string;
  term_end: string;
  gov_title: string;
  is_default_rec_sec: boolean;
}

interface BoardMemberConfigFormProps {
  values: BoardMemberFormData;
  onChange: (values: BoardMemberFormData) => void;
  electionMethod: string;
}

export function BoardMemberConfigForm({
  values,
  onChange,
  electionMethod,
}: BoardMemberConfigFormProps) {
  const set = <K extends keyof BoardMemberFormData>(
    key: K,
    value: BoardMemberFormData[K],
  ) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* Seat title */}
      <div className="space-y-1.5">
        <Label>
          {electionMethod === "role_titled"
            ? "Seat title"
            : "Seat title (optional)"}
        </Label>
        <Input
          value={values.seat_title}
          onChange={(e) => set("seat_title", e.target.value)}
          placeholder={
            electionMethod === "role_titled"
              ? "e.g., Chair, Vice Chair"
              : "e.g., At-large"
          }
          maxLength={50}
        />
      </div>

      {/* Term dates */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Term start</Label>
          <Input
            type="date"
            value={values.term_start}
            onChange={(e) => set("term_start", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Term end (optional)</Label>
          <Input
            type="date"
            value={values.term_end}
            onChange={(e) => set("term_end", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave empty for indefinite terms
          </p>
        </div>
      </div>

      {/* Government title */}
      <div className="space-y-1.5">
        <Label>Government title (optional)</Label>
        <Input
          value={values.gov_title}
          onChange={(e) => set("gov_title", e.target.value)}
          placeholder="e.g., Chair, Vice Chair, 1st Selectman"
          maxLength={100}
        />
        <div className="flex items-start gap-1.5 mt-1">
          <Info className="mt-0.5 h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Government title is for display purposes only. Permissions are
            controlled separately.
          </p>
        </div>
      </div>

      {/* Recording secretary default */}
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <Switch
          id="rec-sec-default"
          checked={values.is_default_rec_sec}
          onCheckedChange={(checked) => set("is_default_rec_sec", checked)}
        />
        <Label htmlFor="rec-sec-default" className="text-sm leading-snug">
          Set as default recording secretary
          <span className="block text-xs text-muted-foreground">
            Can be overridden per meeting
          </span>
        </Label>
      </div>
    </div>
  );
}
