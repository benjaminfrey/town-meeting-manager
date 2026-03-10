/**
 * WizardStage5 — "Meeting Style & Minutes" form.
 *
 * Sets town-level defaults for meeting formality and minutes style.
 * Both fields have defaults, so the user can complete without changes.
 * Uses card-radio pattern for options with long descriptions.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Stage 5
 */

import { useCallback, useEffect, useRef } from "react";
import {
  WizardStage5Schema,
  type WizardStage5Data,
} from "@town-meeting/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useWizardForm } from "@/hooks/useWizardForm";
import { useWizard } from "@/providers/WizardProvider";

// ─── Option definitions ─────────────────────────────────────────────

const FORMALITY_OPTIONS = [
  {
    value: "informal",
    label: "Open (informal)",
    description:
      "Discussion flows freely. The chair manages the conversation. Motions are made when the board is ready. Most small Maine towns operate this way.",
  },
  {
    value: "semi_formal",
    label: "Structured (semi-formal)",
    description:
      "The chair follows the agenda in order. Members are recognized before speaking. Motions follow a clear pattern but without strict parliamentary procedure.",
  },
  {
    value: "formal",
    label: "Formal (Robert's Rules)",
    description:
      "Strict parliamentary procedure. Members must be recognized. All discussion occurs within the context of a motion. Formal points of order are observed.",
  },
] as const;

const MINUTES_OPTIONS = [
  {
    value: "action",
    label: "Action minutes",
    description:
      "Records only decisions, motions, votes, and assignments. Does not include discussion content. Shortest format.",
  },
  {
    value: "summary",
    label: "Summary minutes",
    description:
      "Records decisions and a brief summary of key discussion points. The most common style for Maine municipal boards.",
  },
  {
    value: "narrative",
    label: "Narrative minutes",
    description:
      "Records decisions and a detailed account of discussion, including who said what. Most thorough but most time-consuming to produce.",
  },
] as const;

const DEFAULTS: WizardStage5Data = {
  meetingFormality: "informal",
  minutesStyle: "summary",
};

// ─── Card-radio option component ────────────────────────────────────

function CardRadioOption({
  value,
  label,
  description,
  selected,
  onSelect,
  name,
}: {
  value: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: (value: string) => void;
  name: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/50"
      }`}
      onClick={() => onSelect(value)}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────────

interface WizardStage5Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: {
    validate: () => WizardStage5Data | null;
    getData?: () => WizardStage5Data;
  }) => void;
}

export function WizardStage5({ onValidityChange, onRegister }: WizardStage5Props) {
  const { state } = useWizard();

  const initialValues: WizardStage5Data = state.stage5.meetingFormality
    ? state.stage5
    : DEFAULTS;

  const { values, isValid, setValue, validate } =
    useWizardForm<WizardStage5Data>(WizardStage5Schema, initialValues);

  // Notify parent of validity
  const prevValid = useRef(isValid);
  useEffect(() => {
    if (prevValid.current !== isValid) {
      prevValid.current = isValid;
      onValidityChange(isValid);
    }
  }, [isValid, onValidityChange]);

  useEffect(() => {
    onValidityChange(isValid);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getData = useCallback(() => values, [values]);
  useEffect(() => {
    onRegister({ validate, getData });
  }, [validate, getData, onRegister]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting Style &amp; Minutes</CardTitle>
        <CardDescription>
          Set the town-level defaults for how meetings run
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-8">
          <p className="text-sm text-muted-foreground">
            These apply to all boards as defaults and can be overridden per board
            later.
          </p>

          {/* Meeting formality */}
          <div className="space-y-3">
            <Label>Meeting Formality</Label>
            <div className="space-y-3" role="radiogroup" aria-label="Meeting Formality">
              {FORMALITY_OPTIONS.map((opt) => (
                <CardRadioOption
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  description={opt.description}
                  selected={values.meetingFormality === opt.value}
                  onSelect={(v) =>
                    setValue(
                      "meetingFormality",
                      v as WizardStage5Data["meetingFormality"]
                    )
                  }
                  name="meetingFormality"
                />
              ))}
            </div>
          </div>

          {/* Minutes style */}
          <div className="space-y-3">
            <Label>Minutes Style</Label>
            <div className="space-y-3" role="radiogroup" aria-label="Minutes Style">
              {MINUTES_OPTIONS.map((opt) => (
                <CardRadioOption
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  description={opt.description}
                  selected={values.minutesStyle === opt.value}
                  onSelect={(v) =>
                    setValue(
                      "minutesStyle",
                      v as WizardStage5Data["minutesStyle"]
                    )
                  }
                  name="minutesStyle"
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
