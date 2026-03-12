/**
 * TownSettingsEditor — inline editor for town identity settings.
 *
 * Edits town name, state, municipality type, population range,
 * contact name, and contact role.
 */

import { useCallback } from "react";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import {
  MunicipalityType,
  PopulationRange,
  NEW_ENGLAND_STATES,
} from "@town-meeting/shared";
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
  contact_name: z
    .string()
    .min(2, "Contact name must be at least 2 characters")
    .max(100),
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

export function TownSettingsEditor({
  townId,
  initial,
  onDone,
}: TownSettingsEditorProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { values, errors, isValid, setValue, handleBlur, validate } =
    useWizardForm<TownSettingsData>(TownSettingsSchema, initial);

  const mutation = useMutation({
    mutationFn: async (data: TownSettingsData) => {
      const { error } = await supabase
        .from("town")
        .update({
          name: data.name,
          state: data.state,
          municipality_type: data.municipality_type,
          population_range: data.population_range,
          contact_name: data.contact_name,
          contact_role: data.contact_role,
          updated_at: new Date().toISOString(),
        })
        .eq("id", townId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
      onDone();
    },
  });

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
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name}</p>
          )}
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
          {errors.contact_name && (
            <p className="text-xs text-destructive">{errors.contact_name}</p>
          )}
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
          {errors.contact_role && (
            <p className="text-xs text-destructive">{errors.contact_role}</p>
          )}
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
