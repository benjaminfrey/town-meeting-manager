/**
 * WizardStage1 — "Your Town" form.
 *
 * Collects municipality identification and contact information.
 * Uses plain React state + Zod validation (via useWizardForm hook)
 * instead of react-hook-form to avoid dual-React instance issues
 * caused by @powersync/web's Vite dep optimization exclusion.
 *
 * Fields: Town name, State, Municipality type, Population range,
 * Primary contact name, Primary contact role.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Stage 1
 */

import { useEffect, useRef } from "react";
import {
  NEW_ENGLAND_STATES,
  WizardStage1Schema,
  type WizardStage1Data,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWizardForm } from "@/hooks/useWizardForm";
import { useWizard } from "@/providers/WizardProvider";

// ─── Dropdown options ────────────────────────────────────────────────

const MUNICIPALITY_TYPES = [
  { value: "town", label: "Town" },
  { value: "city", label: "City" },
  { value: "plantation", label: "Plantation" },
] as const;

const POPULATION_RANGES = [
  { value: "under_1000", label: "Under 1,000" },
  { value: "1000_to_2500", label: "1,000 \u2013 2,500" },
  { value: "2500_to_5000", label: "2,500 \u2013 5,000" },
  { value: "5000_to_10000", label: "5,000 \u2013 10,000" },
  { value: "over_10000", label: "Over 10,000" },
] as const;

// ─── Default values ──────────────────────────────────────────────────

const DEFAULTS: WizardStage1Data = {
  townName: "",
  state: "ME",
  municipalityType: "town",
  populationRange: "under_1000",
  contactName: "",
  contactRole: "",
};

// ─── Component ───────────────────────────────────────────────────────

interface WizardStage1Props {
  /** Called when form validity changes (drives the Next button state) */
  onValidityChange: (isValid: boolean) => void;
  /** Ref-like callback to expose validate + getData to the parent */
  onRegister: (handlers: {
    validate: () => WizardStage1Data | null;
  }) => void;
}

export function WizardStage1({ onValidityChange, onRegister }: WizardStage1Props) {
  const { state } = useWizard();

  // Initialize form with saved wizard state or defaults
  const initialValues: WizardStage1Data = state.stage1.townName
    ? state.stage1
    : DEFAULTS;

  const { values, errors, isValid, setValue, handleBlur, validate } =
    useWizardForm<WizardStage1Data>(WizardStage1Schema, initialValues);

  // Notify parent of validity changes
  const prevValid = useRef(isValid);
  useEffect(() => {
    if (prevValid.current !== isValid) {
      prevValid.current = isValid;
      onValidityChange(isValid);
    }
  }, [isValid, onValidityChange]);

  // Also report initial validity
  useEffect(() => {
    onValidityChange(isValid);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register validate handler for parent to call on Next click
  useEffect(() => {
    onRegister({ validate });
  }, [validate, onRegister]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Town</CardTitle>
        <CardDescription>
          Tell us about your municipality
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Town name — full width */}
          <div className="space-y-2">
            <Label htmlFor="townName">Town Name</Label>
            <Input
              id="townName"
              placeholder="e.g., Newcastle, Isle au Haut"
              value={values.townName}
              onChange={(e) => setValue("townName", e.target.value)}
              onBlur={() => handleBlur("townName")}
              aria-invalid={!!errors.townName}
            />
            {errors.townName && (
              <p className="text-sm text-destructive">{errors.townName}</p>
            )}
          </div>

          {/* State + Municipality type — side by side on desktop */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Select
                value={values.state}
                onValueChange={(val) =>
                  setValue("state", val as WizardStage1Data["state"])
                }
              >
                <SelectTrigger id="state" className="w-full">
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

            <div className="space-y-2">
              <Label htmlFor="municipalityType">Municipality Type</Label>
              <Select
                value={values.municipalityType}
                onValueChange={(val) =>
                  setValue(
                    "municipalityType",
                    val as WizardStage1Data["municipalityType"]
                  )
                }
              >
                <SelectTrigger id="municipalityType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MUNICIPALITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Population range — full width */}
          <div className="space-y-2">
            <Label htmlFor="populationRange">Population Range</Label>
            <Select
              value={values.populationRange}
              onValueChange={(val) =>
                setValue(
                  "populationRange",
                  val as WizardStage1Data["populationRange"]
                )
              }
            >
              <SelectTrigger id="populationRange" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POPULATION_RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contact name + Contact role — side by side on desktop */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactName">Primary Contact Name</Label>
              <Input
                id="contactName"
                placeholder="Your full name"
                value={values.contactName}
                onChange={(e) => setValue("contactName", e.target.value)}
                onBlur={() => handleBlur("contactName")}
                aria-invalid={!!errors.contactName}
              />
              {errors.contactName && (
                <p className="text-sm text-destructive">{errors.contactName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactRole">Primary Contact Role</Label>
              <Input
                id="contactRole"
                placeholder="e.g., Town Manager, Town Clerk"
                value={values.contactRole}
                onChange={(e) => setValue("contactRole", e.target.value)}
                onBlur={() => handleBlur("contactRole")}
                aria-invalid={!!errors.contactRole}
              />
              {errors.contactRole && (
                <p className="text-sm text-destructive">{errors.contactRole}</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
