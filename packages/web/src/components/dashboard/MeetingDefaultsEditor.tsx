/**
 * MeetingDefaultsEditor — inline editor for meeting formality and minutes style.
 *
 * Town-level defaults that apply to all boards unless overridden per board.
 */

import { useCallback } from "react";
import { z } from "zod";
import { usePowerSync } from "@powersync/react";
import { MeetingFormality, MinutesStyle } from "@town-meeting/shared";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { useWizardForm } from "@/hooks/useWizardForm";

// ─── Schema ─────────────────────────────────────────────────────────

const MeetingDefaultsSchema = z.object({
  meeting_formality: z.enum([
    MeetingFormality.INFORMAL,
    MeetingFormality.SEMI_FORMAL,
    MeetingFormality.FORMAL,
  ]),
  minutes_style: z.enum([
    MinutesStyle.ACTION,
    MinutesStyle.SUMMARY,
    MinutesStyle.NARRATIVE,
  ]),
});

type MeetingDefaultsData = z.infer<typeof MeetingDefaultsSchema>;

// ─── Display labels ─────────────────────────────────────────────────

export const FORMALITY_OPTIONS = [
  {
    value: MeetingFormality.INFORMAL,
    label: "Open (informal)",
    description:
      "Discussion flows freely. The chair manages the conversation. Most small Maine towns operate this way.",
  },
  {
    value: MeetingFormality.SEMI_FORMAL,
    label: "Structured (semi-formal)",
    description:
      "Chair follows agenda in order. Members recognized before speaking. Motions follow a clear pattern.",
  },
  {
    value: MeetingFormality.FORMAL,
    label: "Formal (Robert's Rules)",
    description:
      "Strict parliamentary procedure. Members must be recognized. All discussion within context of a motion.",
  },
] as const;

export const MINUTES_STYLE_OPTIONS = [
  {
    value: MinutesStyle.ACTION,
    label: "Action minutes",
    description:
      "Records only decisions, motions, votes, and assignments. Shortest format.",
  },
  {
    value: MinutesStyle.SUMMARY,
    label: "Summary minutes",
    description:
      "Decisions plus brief discussion summaries. Most common for Maine municipal boards.",
  },
  {
    value: MinutesStyle.NARRATIVE,
    label: "Narrative minutes",
    description:
      "Detailed account including who said what. Most thorough but most time-consuming.",
  },
] as const;

// ─── Component ──────────────────────────────────────────────────────

interface MeetingDefaultsEditorProps {
  townId: string;
  initial: MeetingDefaultsData;
  onDone: () => void;
}

export function MeetingDefaultsEditor({
  townId,
  initial,
  onDone,
}: MeetingDefaultsEditorProps) {
  const powerSync = usePowerSync();
  const { values, isValid, setValue, validate } =
    useWizardForm<MeetingDefaultsData>(MeetingDefaultsSchema, initial);

  const handleSave = useCallback(async () => {
    const data = validate();
    if (!data) return;

    await powerSync.execute(
      `UPDATE towns SET meeting_formality = ?, minutes_style = ?, updated_at = ? WHERE id = ?`,
      [data.meeting_formality, data.minutes_style, new Date().toISOString(), townId]
    );
    onDone();
  }, [validate, powerSync, townId, onDone]);

  return (
    <div className="space-y-6">
      {/* Meeting formality */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Meeting Formality</Label>
        <RadioGroup
          value={values.meeting_formality}
          onValueChange={(val) =>
            setValue("meeting_formality", val as MeetingDefaultsData["meeting_formality"])
          }
          className="space-y-3"
        >
          {FORMALITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem value={opt.value} className="mt-0.5" />
              <div>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.description}</div>
              </div>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Minutes style */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Minutes Style</Label>
        <RadioGroup
          value={values.minutes_style}
          onValueChange={(val) =>
            setValue("minutes_style", val as MeetingDefaultsData["minutes_style"])
          }
          className="space-y-3"
        >
          {MINUTES_STYLE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem value={opt.value} className="mt-0.5" />
              <div>
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.description}</div>
              </div>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" disabled={!isValid} onClick={() => void handleSave()}>
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
