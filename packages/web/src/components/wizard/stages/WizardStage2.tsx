/**
 * WizardStage2 — "Your Governing Board" form.
 *
 * Collects governing board configuration: board name, member count,
 * election method, seat titles (conditional), officer election method,
 * district-based seats, and staggered terms.
 *
 * Uses the same useWizardForm + Zod pattern as Stage 1.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Stage 2
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  WizardStage2Schema,
  type WizardStage2Data,
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useWizardForm } from "@/hooks/useWizardForm";
import { useWizard } from "@/providers/WizardProvider";

// ─── Constants ──────────────────────────────────────────────────────

const BOARD_NAME_SUGGESTIONS = [
  "Select Board",
  "Board of Selectmen",
  "Town Council",
  "Board of Aldermen",
];

const OFFICER_ELECTION_OPTIONS = [
  { value: "vote_of_board", label: "Vote of the board" },
  { value: "highest_vote_getter", label: "Highest vote-getter in election" },
  { value: "appointed_by_authority", label: "Appointed by authority" },
  { value: "rotation", label: "Rotation" },
] as const;

const DEFAULTS: WizardStage2Data = {
  boardName: "",
  memberCount: 3,
  electionMethod: "at_large",
  seatTitles: [],
  officerElectionMethod: "vote_of_board",
  districtBased: false,
  staggeredTerms: false,
};

// ─── Helpers ────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"] as const;
  const v = n % 100;
  const suffix = suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0];
  return `${n}${suffix}`;
}

function generateSeatTitle(index: number, boardName: string): string {
  const name = boardName.trim() || "Member";
  return `${ordinal(index + 1)} ${name}`;
}

// ─── Component ──────────────────────────────────────────────────────

interface WizardStage2Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: {
    validate: () => WizardStage2Data | null;
    getData?: () => WizardStage2Data;
  }) => void;
}

export function WizardStage2({ onValidityChange, onRegister }: WizardStage2Props) {
  const { state } = useWizard();

  // Initialize with saved wizard state or defaults
  const initialValues: WizardStage2Data = state.stage2.boardName
    ? state.stage2
    : DEFAULTS;

  const { values, errors, isValid, setValue, handleBlur, validate } =
    useWizardForm<WizardStage2Data>(WizardStage2Schema, initialValues);

  // Board name suggestion dropdown state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Per-seat-title error tracking
  const [seatTitleErrors, setSeatTitleErrors] = useState<Record<number, string>>({});

  // Notify parent of validity changes
  const prevValid = useRef(isValid);
  useEffect(() => {
    if (prevValid.current !== isValid) {
      prevValid.current = isValid;
      onValidityChange(isValid);
    }
  }, [isValid, onValidityChange]);

  // Report initial validity
  useEffect(() => {
    onValidityChange(isValid);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register validate and getData handlers for parent
  const getData = useCallback(() => values, [values]);
  useEffect(() => {
    onRegister({ validate, getData });
  }, [validate, getData, onRegister]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ─── Filtered suggestions ──────────────────────────────────────

  const filteredSuggestions = values.boardName
    ? BOARD_NAME_SUGGESTIONS.filter((s) =>
        s.toLowerCase().includes(values.boardName.toLowerCase())
      )
    : BOARD_NAME_SUGGESTIONS;

  // ─── Election method change ────────────────────────────────────

  const handleElectionMethodChange = useCallback(
    (method: string) => {
      setValue("electionMethod", method as WizardStage2Data["electionMethod"]);
      if (method === "role_titled") {
        // Populate seat titles to match member count
        const titles = Array.from({ length: values.memberCount }, (_, i) =>
          generateSeatTitle(i, values.boardName)
        );
        setValue("seatTitles", titles);
      } else {
        // Discard seat titles per advisory 2.1
        setValue("seatTitles", []);
        setSeatTitleErrors({});
      }
    },
    [setValue, values.memberCount, values.boardName]
  );

  // ─── Member count change ──────────────────────────────────────

  const handleMemberCountChange = useCallback(
    (raw: string) => {
      const parsed = parseInt(raw, 10);
      const newCount = isNaN(parsed) ? 0 : Math.max(0, Math.min(15, parsed));
      setValue("memberCount", newCount);

      if (values.electionMethod === "role_titled") {
        const current = values.seatTitles;
        if (newCount > current.length) {
          // Append new titles, preserve existing
          const newTitles = [...current];
          for (let i = current.length; i < newCount; i++) {
            newTitles.push(generateSeatTitle(i, values.boardName));
          }
          setValue("seatTitles", newTitles);
        } else if (newCount < current.length) {
          // Remove from end, preserve remaining
          setValue("seatTitles", current.slice(0, newCount));
          // Clean up errors for removed fields
          const cleaned: Record<number, string> = {};
          for (const [k, v] of Object.entries(seatTitleErrors)) {
            if (Number(k) < newCount) cleaned[Number(k)] = v;
          }
          setSeatTitleErrors(cleaned);
        }
      }
    },
    [setValue, values.electionMethod, values.seatTitles, values.boardName, seatTitleErrors]
  );

  // ─── Seat title handlers ──────────────────────────────────────

  const handleSeatTitleChange = useCallback(
    (index: number, title: string) => {
      const newTitles = [...values.seatTitles];
      newTitles[index] = title;
      setValue("seatTitles", newTitles);
      // Clear error for this index on change
      if (seatTitleErrors[index]) {
        setSeatTitleErrors((prev) => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
      }
    },
    [setValue, values.seatTitles, seatTitleErrors]
  );

  const handleSeatTitleBlur = useCallback(
    (index: number) => {
      const title = values.seatTitles[index] ?? "";
      if (title.length > 0 && title.length < 2) {
        setSeatTitleErrors((prev) => ({
          ...prev,
          [index]: "Must be at least 2 characters",
        }));
      } else if (title.length > 50) {
        setSeatTitleErrors((prev) => ({
          ...prev,
          [index]: "Must be less than 50 characters",
        }));
      } else {
        setSeatTitleErrors((prev) => {
          if (!(index in prev)) return prev;
          const next = { ...prev };
          delete next[index];
          return next;
        });
      }
    },
    [values.seatTitles]
  );

  // ─── Board name suggestion selection ──────────────────────────

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      setValue("boardName", suggestion);
      setShowSuggestions(false);
      // Update seat titles if role-titled
      if (values.electionMethod === "role_titled") {
        const newTitles = values.seatTitles.map((title, i) => {
          // Only update if the title matches a previously generated pattern
          const oldGenerated = generateSeatTitle(i, values.boardName);
          return title === oldGenerated
            ? generateSeatTitle(i, suggestion)
            : title;
        });
        setValue("seatTitles", newTitles);
      }
    },
    [setValue, values.electionMethod, values.seatTitles, values.boardName]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Governing Board</CardTitle>
        <CardDescription>
          Configure your town's primary governing board
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Board name with suggestions */}
          <div className="space-y-2">
            <Label htmlFor="boardName">Board Name</Label>
            <div className="relative">
              <Input
                ref={inputRef}
                id="boardName"
                placeholder="e.g., Select Board, Town Council"
                value={values.boardName}
                onChange={(e) => setValue("boardName", e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  // Delay to allow suggestion click
                  setTimeout(() => setShowSuggestions(false), 200);
                  handleBlur("boardName");
                }}
                aria-invalid={!!errors.boardName}
                autoComplete="off"
              />
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md"
                >
                  {filteredSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="flex w-full cursor-pointer items-center px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSuggestionSelect(suggestion);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {errors.boardName && (
              <p className="text-sm text-destructive">{errors.boardName}</p>
            )}
          </div>

          {/* Member count */}
          <div className="space-y-2">
            <Label htmlFor="memberCount">Number of Members</Label>
            <Input
              id="memberCount"
              type="number"
              min={0}
              max={15}
              value={values.memberCount}
              onChange={(e) => handleMemberCountChange(e.target.value)}
              onBlur={() => handleBlur("memberCount")}
              aria-invalid={!!errors.memberCount}
            />
            <p className="text-sm text-muted-foreground">
              How many seats does this board have?
            </p>
            {errors.memberCount && (
              <p className="text-sm text-destructive">{errors.memberCount}</p>
            )}
          </div>

          {/* Zero-member notice */}
          {values.memberCount === 0 && (
            <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50">
              <svg
                className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                You can add members later. Note: a board must have at least 3
                members to hold a meeting.
              </p>
            </div>
          )}

          {/* Election method */}
          <div className="space-y-3">
            <Label>Election Method</Label>
            <RadioGroup
              value={values.electionMethod}
              onValueChange={handleElectionMethodChange}
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="at_large" id="at_large" className="mt-0.5" />
                <div>
                  <Label htmlFor="at_large" className="font-normal cursor-pointer">
                    At-large
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    All members hold equal seats
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="role_titled" id="role_titled" className="mt-0.5" />
                <div>
                  <Label htmlFor="role_titled" className="font-normal cursor-pointer">
                    Role-titled
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Each seat has a specific title (e.g., 1st Selectman, 2nd
                    Selectman)
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Seat titles — conditional on role-titled + memberCount > 0 */}
          {values.electionMethod === "role_titled" && values.memberCount > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <Label>Seat Titles</Label>
              <p className="text-sm text-muted-foreground">
                Name each seat on the board
              </p>
              <div className="space-y-3">
                {values.seatTitles.map((title, index) => (
                  <div key={index} className="space-y-1">
                    <Label
                      htmlFor={`seatTitle-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      Seat {index + 1}
                    </Label>
                    <Input
                      id={`seatTitle-${index}`}
                      value={title}
                      onChange={(e) =>
                        handleSeatTitleChange(index, e.target.value)
                      }
                      onBlur={() => handleSeatTitleBlur(index)}
                      aria-invalid={!!seatTitleErrors[index]}
                      placeholder={`Title for seat ${index + 1}`}
                    />
                    {seatTitleErrors[index] && (
                      <p className="text-xs text-destructive">
                        {seatTitleErrors[index]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {errors.seatTitles && (
                <p className="text-sm text-destructive">{errors.seatTitles}</p>
              )}
            </div>
          )}

          {/* Officer election method */}
          <div className="space-y-2">
            <Label htmlFor="officerElectionMethod">
              How is the presiding officer chosen?
            </Label>
            <Select
              value={values.officerElectionMethod}
              onValueChange={(val) =>
                setValue(
                  "officerElectionMethod",
                  val as WizardStage2Data["officerElectionMethod"]
                )
              }
            >
              <SelectTrigger id="officerElectionMethod" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OFFICER_ELECTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* District-based seats + Staggered terms — side by side */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="districtBased">District-based seats</Label>
                <p className="text-sm text-muted-foreground">
                  Members represent specific geographic districts
                </p>
              </div>
              <Switch
                id="districtBased"
                checked={values.districtBased}
                onCheckedChange={(checked) =>
                  setValue("districtBased", checked === true)
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="staggeredTerms">Staggered terms</Label>
                <p className="text-sm text-muted-foreground">
                  Members serve overlapping terms to ensure continuity
                </p>
              </div>
              <Switch
                id="staggeredTerms"
                checked={values.staggeredTerms}
                onCheckedChange={(checked) =>
                  setValue("staggeredTerms", checked === true)
                }
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
