/**
 * MeetingRolesEditor — inline editor for presiding officer and minutes recorder defaults.
 *
 * These set the default roles for new meetings; they can be overridden per meeting.
 */

import { useCallback } from "react";
import { z } from "zod";
import { usePowerSync } from "@powersync/react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useWizardForm } from "@/hooks/useWizardForm";

// ─── Options ────────────────────────────────────────────────────────

export const PRESIDING_OFFICER_OPTIONS = [
  { value: "chair_of_board", label: "Chair of the board" },
  { value: "town_manager", label: "Town Manager" },
  { value: "town_administrator", label: "Town Administrator" },
  { value: "mayor", label: "Mayor" },
  { value: "moderator", label: "Moderator" },
] as const;

export const MINUTES_RECORDER_OPTIONS = [
  { value: "town_clerk", label: "Town Clerk" },
  { value: "deputy_clerk", label: "Deputy Clerk" },
  { value: "recording_secretary_board", label: "Recording Secretary (board member)" },
  { value: "recording_secretary_staff", label: "Recording Secretary (staff)" },
  { value: "other_staff", label: "Other staff" },
] as const;

// ─── Schema ─────────────────────────────────────────────────────────

const MeetingRolesSchema = z.object({
  presiding_officer_default: z.string().min(1),
  minutes_recorder_default: z.string().min(1),
});

type MeetingRolesData = z.infer<typeof MeetingRolesSchema>;

// ─── Component ──────────────────────────────────────────────────────

interface MeetingRolesEditorProps {
  townId: string;
  initial: MeetingRolesData;
  onDone: () => void;
}

export function MeetingRolesEditor({
  townId,
  initial,
  onDone,
}: MeetingRolesEditorProps) {
  const powerSync = usePowerSync();
  const { values, isValid, setValue, validate } =
    useWizardForm<MeetingRolesData>(MeetingRolesSchema, initial);

  const handleSave = useCallback(async () => {
    const data = validate();
    if (!data) return;

    await powerSync.execute(
      `UPDATE towns SET presiding_officer_default = ?, minutes_recorder_default = ?, updated_at = ? WHERE id = ?`,
      [
        data.presiding_officer_default,
        data.minutes_recorder_default,
        new Date().toISOString(),
        townId,
      ]
    );
    onDone();
  }, [validate, powerSync, townId, onDone]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Presiding officer */}
        <div className="space-y-1.5">
          <Label>Presiding officer</Label>
          <Select
            value={values.presiding_officer_default}
            onValueChange={(val) => setValue("presiding_officer_default", val)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESIDING_OFFICER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Minutes recorder */}
        <div className="space-y-1.5">
          <Label>Minutes recorder</Label>
          <Select
            value={values.minutes_recorder_default}
            onValueChange={(val) => setValue("minutes_recorder_default", val)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINUTES_RECORDER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
