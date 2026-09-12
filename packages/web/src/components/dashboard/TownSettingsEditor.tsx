/**
 * TownSettingsEditor — inline editor for town identity settings.
 *
 * Edits town name, state, municipality type, population range,
 * contact name, and contact role.
 *
 * Stage 1, Phase E, Task 2 — the write is `town.updateProfile` now, not a raw
 * Supabase `update()`. The mutation invalidates BOTH the legacy
 * `queryKeys.towns.detail(townId)` key and `trpc.town.pathFilter()`
 * (conventions item 7).
 *
 * **Corrected in wave 6 Task 4's fix round.** This header previously named
 * `boards.tsx`, `boards.$boardId.tsx`,
 * `meetings.$meetingId.{agenda,review,minutes}.tsx` and
 * `settings.minutes-workflow.tsx` as still reading the town row through the
 * legacy key. None does: `agenda.tsx` migrated in wave 4, `minutes.tsx` in
 * wave 6 Task 3, `review.tsx` in wave 6 Task 4 (this same task), and
 * `boards.tsx` / `boards.$boardId.tsx` / `settings.minutes-workflow.tsx` all
 * read `trpc.town.detail` directly. `queryKeys.towns.detail` has **no reader
 * left at all** — see `boards.$boardId.tsx`'s own header (corrected first,
 * in this same fix round) for the up-to-date state. The legacy invalidation
 * line stays anyway, for the sequencing reason in
 * `cache-key-parity.test.ts`'s "Why a dead legacy line is not removed on
 * sight" — NOT because a reader remains.
 *
 * Mechanical note for whoever greps next: the three files this correction
 * touched (this one, `SetPortalAddressModal.tsx`, and
 * `settings.minutes-workflow.tsx`) all named the three now-migrated route
 * files in BRACE form (`meetings.$meetingId.{agenda,review,minutes}.tsx`),
 * so a literal `grep -n "review.tsx"` against any of them finds nothing —
 * one level deeper than conventions item 14's third widening ("grep the
 * whole document for the exact string before claiming absence"): the string
 * was never present to grep for, only its brace-compressed form.
 */

import { useCallback } from "react";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import { MunicipalityType, PopulationRange, NEW_ENGLAND_STATES } from "@town-meeting/shared";
import { Input } from "@/components/ui/input";
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

// ─── Schema ─────────────────────────────────────────────────────────

const TOWN_NAME_REGEX = /^[a-zA-Z0-9\s\-'.]+$/;

const TownSettingsSchema = z.object({
  name: z
    .string()
    .min(2, "Town name must be at least 2 characters")
    .max(100, "Town name must be less than 100 characters")
    .regex(TOWN_NAME_REGEX, "Invalid characters in town name"),
  state: z.enum(["ME", "NH", "VT", "MA", "CT", "RI"]),
  municipality_type: z.enum([
    MunicipalityType.TOWN,
    MunicipalityType.CITY,
    MunicipalityType.PLANTATION,
  ]),
  population_range: z.enum([
    PopulationRange.UNDER_1000,
    PopulationRange.FROM_1000_TO_2500,
    PopulationRange.FROM_2500_TO_5000,
    PopulationRange.FROM_5000_TO_10000,
    PopulationRange.OVER_10000,
  ]),
  contact_name: z.string().min(2, "Contact name must be at least 2 characters").max(100),
  contact_role: z.string().min(1, "Contact role is required").max(100),
});

type TownSettingsData = z.infer<typeof TownSettingsSchema>;

// ─── Display helpers ────────────────────────────────────────────────

const POPULATION_LABELS: Record<string, string> = {
  under_1000: "Under 1,000",
  "1000_to_2500": "1,000–2,500",
  "2500_to_5000": "2,500–5,000",
  "5000_to_10000": "5,000–10,000",
  over_10000: "Over 10,000",
};

const MUNICIPALITY_LABELS: Record<string, string> = {
  town: "Town",
  city: "City",
  plantation: "Plantation",
};

// ─── Component ──────────────────────────────────────────────────────

interface TownSettingsEditorProps {
  townId: string;
  initial: TownSettingsData;
  onDone: () => void;
}

export function TownSettingsEditor({ townId, initial, onDone }: TownSettingsEditorProps) {
  const queryClient = useQueryClient();
  const { values, errors, isValid, setValue, handleBlur, validate } =
    useWizardForm<TownSettingsData>(TownSettingsSchema, initial);

  const mutation = useMutation(
    trpc.town.updateProfile.mutationOptions({
      onSuccess: () => {
        // Legacy key stays: see this file's header comment. `pathFilter()`
        // is what `settings.town.tsx`'s own `town.detail` read invalidates
        // under now.
        void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
        void queryClient.invalidateQueries(trpc.town.pathFilter());
        onDone();
      },
    }),
  );

  const handleSave = useCallback(() => {
    const data = validate();
    if (!data) return;
    mutation.mutate(data);
  }, [validate, mutation]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Town name */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="edit-name">Town name</Label>
          <Input
            id="edit-name"
            value={values.name}
            onChange={(e) => setValue("name", e.target.value)}
            onBlur={() => handleBlur("name")}
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>

        {/* State */}
        <div className="space-y-1.5">
          <Label>State</Label>
          <Select
            value={values.state}
            onValueChange={(val) => setValue("state", val as TownSettingsData["state"])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NEW_ENGLAND_STATES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Municipality type */}
        <div className="space-y-1.5">
          <Label>Municipality type</Label>
          <Select
            value={values.municipality_type}
            onValueChange={(val) =>
              setValue("municipality_type", val as TownSettingsData["municipality_type"])
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MUNICIPALITY_LABELS).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Population range */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Population range</Label>
          <Select
            value={values.population_range}
            onValueChange={(val) =>
              setValue("population_range", val as TownSettingsData["population_range"])
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(POPULATION_LABELS).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Contact name */}
        <div className="space-y-1.5">
          <Label htmlFor="edit-contact-name">Contact name</Label>
          <Input
            id="edit-contact-name"
            value={values.contact_name}
            onChange={(e) => setValue("contact_name", e.target.value)}
            onBlur={() => handleBlur("contact_name")}
          />
          {errors.contact_name && <p className="text-xs text-destructive">{errors.contact_name}</p>}
        </div>

        {/* Contact role */}
        <div className="space-y-1.5">
          <Label htmlFor="edit-contact-role">Contact role</Label>
          <Input
            id="edit-contact-role"
            value={values.contact_role}
            onChange={(e) => setValue("contact_role", e.target.value)}
            onBlur={() => handleBlur("contact_role")}
          />
          {errors.contact_role && <p className="text-xs text-destructive">{errors.contact_role}</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" disabled={!isValid || mutation.isPending} onClick={handleSave}>
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export { POPULATION_LABELS, MUNICIPALITY_LABELS };
