/**
 * WizardStage3 — "Who Runs Your Meetings" form.
 *
 * Collects default meeting roles: presiding officer, minutes recorder,
 * and staff typically present. All fields have defaults, so the user
 * can advance without changing anything.
 *
 * The "None — volunteer board with no staff" checkbox has exclusive
 * behavior: selecting it unchecks all other staff roles, and selecting
 * any other role unchecks "None."
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Stage 3
 */

import { useCallback, useEffect, useRef } from "react";
import {
  WizardStage3Schema,
  type WizardStage3Data,
} from "@town-meeting/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useWizardForm } from "@/hooks/useWizardForm";
import { useWizard } from "@/providers/WizardProvider";

// ─── Constants ──────────────────────────────────────────────────────

const PRESIDING_OFFICER_OPTIONS = [
  { value: "chair_of_board", label: "Chair of the board" },
  { value: "town_manager", label: "Town Manager" },
  { value: "town_administrator", label: "Town Administrator" },
  { value: "mayor", label: "Mayor" },
  { value: "moderator", label: "Moderator" },
] as const;

const MINUTES_RECORDER_OPTIONS = [
  { value: "town_clerk", label: "Town Clerk" },
  { value: "deputy_clerk", label: "Deputy Clerk" },
  { value: "recording_secretary_board", label: "Recording Secretary (board member)" },
  { value: "recording_secretary_staff", label: "Recording Secretary (staff)" },
  { value: "other_staff", label: "Other staff" },
] as const;

const STAFF_ROLE_OPTIONS = [
  { value: "town_manager", label: "Town Manager" },
  { value: "town_administrator", label: "Town Administrator" },
  { value: "town_clerk", label: "Town Clerk" },
  { value: "deputy_clerk", label: "Deputy Clerk" },
] as const;

const DEFAULTS: WizardStage3Data = {
  presidingOfficer: "chair_of_board",
  minutesRecorder: "town_clerk",
  staffRolesPresent: [],
};

// ─── Component ──────────────────────────────────────────────────────

interface WizardStage3Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: {
    validate: () => WizardStage3Data | null;
    getData?: () => WizardStage3Data;
  }) => void;
}

export function WizardStage3({ onValidityChange, onRegister }: WizardStage3Props) {
  const { state } = useWizard();

  // Stage 3 always has defaults, so always initialize with saved state
  // (which itself defaults from WizardProvider)
  const initialValues: WizardStage3Data = state.stage3.presidingOfficer
    ? state.stage3
    : DEFAULTS;

  const { values, errors, isValid, setValue, validate } =
    useWizardForm<WizardStage3Data>(WizardStage3Schema, initialValues);

  // Notify parent of validity changes
  const prevValid = useRef(isValid);
  useEffect(() => {
    if (prevValid.current !== isValid) {
      prevValid.current = isValid;
      onValidityChange(isValid);
    }
  }, [isValid, onValidityChange]);

  // Report initial validity (Stage 3 is always valid with defaults)
  useEffect(() => {
    onValidityChange(isValid);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register validate and getData handlers for parent
  const getData = useCallback(() => values, [values]);
  useEffect(() => {
    onRegister({ validate, getData });
  }, [validate, getData, onRegister]);

  // ─── Exclusive "None" checkbox behavior ───────────────────────

  const handleStaffRoleToggle = useCallback(
    (role: string, checked: boolean) => {
      const current = values.staffRolesPresent;

      if (role === "none") {
        // "None" is exclusive: selecting it clears all others
        setValue("staffRolesPresent", checked ? ["none"] : []);
      } else if (checked) {
        // Adding a non-"none" role: remove "none" if present, add the role
        const without_none = current.filter((r) => r !== "none");
        setValue("staffRolesPresent", [...without_none, role]);
      } else {
        // Removing a non-"none" role
        setValue("staffRolesPresent", current.filter((r) => r !== role));
      }
    },
    [setValue, values.staffRolesPresent]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who Runs Your Meetings</CardTitle>
        <CardDescription>
          Identify the default roles for meeting operations
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Helper note */}
          <p className="text-sm text-muted-foreground">
            This does not create user accounts — it tells the system what your
            town's structure looks like.
          </p>

          {/* Presiding officer */}
          <div className="space-y-2">
            <Label htmlFor="presidingOfficer">
              Who presides over meetings?
            </Label>
            <Select
              value={values.presidingOfficer}
              onValueChange={(val) => setValue("presidingOfficer", val)}
            >
              <SelectTrigger id="presidingOfficer" className="w-full">
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
            {errors.presidingOfficer && (
              <p className="text-sm text-destructive">
                {errors.presidingOfficer}
              </p>
            )}
          </div>

          {/* Minutes recorder */}
          <div className="space-y-2">
            <Label htmlFor="minutesRecorder">
              Who records meeting minutes?
            </Label>
            <Select
              value={values.minutesRecorder}
              onValueChange={(val) => setValue("minutesRecorder", val)}
            >
              <SelectTrigger id="minutesRecorder" className="w-full">
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
            {errors.minutesRecorder && (
              <p className="text-sm text-destructive">
                {errors.minutesRecorder}
              </p>
            )}
          </div>

          {/* Staff roles present */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Staff typically present at meetings</Label>
              <p className="text-sm text-muted-foreground">Select all that apply</p>
            </div>

            <div className="space-y-3">
              {STAFF_ROLE_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-3">
                  <Checkbox
                    id={`staff-${opt.value}`}
                    checked={values.staffRolesPresent.includes(opt.value)}
                    onCheckedChange={(checked) =>
                      handleStaffRoleToggle(opt.value, checked === true)
                    }
                  />
                  <Label
                    htmlFor={`staff-${opt.value}`}
                    className="font-normal cursor-pointer"
                  >
                    {opt.label}
                  </Label>
                </div>
              ))}

              {/* Separator before "None" option */}
              <div className="border-t pt-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="staff-none"
                    checked={values.staffRolesPresent.includes("none")}
                    onCheckedChange={(checked) =>
                      handleStaffRoleToggle("none", checked === true)
                    }
                  />
                  <Label
                    htmlFor="staff-none"
                    className="font-normal cursor-pointer text-muted-foreground italic"
                  >
                    None — volunteer board with no staff
                  </Label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
