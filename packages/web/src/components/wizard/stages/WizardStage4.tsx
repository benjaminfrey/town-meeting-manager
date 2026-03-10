/**
 * WizardStage4 — "Your Boards & Committees" form.
 *
 * Displays standard Maine boards as a checklist. Checking a board
 * reveals inline sub-configuration (name, member count, elected/appointed).
 * Users can also add custom boards via a free-text input.
 *
 * No boards are required — a town with only the governing board is valid.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Stage 4
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  WizardStage4Schema,
  type WizardStage4Data,
  type WizardBoardEntry,
} from "@town-meeting/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useWizardForm } from "@/hooks/useWizardForm";
import { useWizard } from "@/providers/WizardProvider";

// ─── Standard Maine boards ──────────────────────────────────────────

const STANDARD_BOARDS: Array<{
  id: string;
  name: string;
  defaultType: "elected" | "appointed";
  note: string | null;
}> = [
  { id: "planning_board", name: "Planning Board", defaultType: "elected", note: null },
  { id: "zba", name: "Zoning Board of Appeals", defaultType: "appointed", note: null },
  { id: "budget_committee", name: "Budget Committee", defaultType: "elected", note: null },
  { id: "conservation_commission", name: "Conservation Commission", defaultType: "appointed", note: null },
  { id: "parks_recreation", name: "Parks & Recreation Committee", defaultType: "appointed", note: null },
  { id: "harbor_committee", name: "Harbor Committee", defaultType: "appointed", note: "Coastal towns" },
  { id: "shellfish_commission", name: "Shellfish Conservation Commission", defaultType: "appointed", note: "Coastal towns" },
  { id: "cemetery_committee", name: "Cemetery Committee", defaultType: "appointed", note: null },
  { id: "road_committee", name: "Road Committee", defaultType: "appointed", note: null },
  { id: "comprehensive_plan", name: "Comprehensive Plan Committee", defaultType: "appointed", note: "Formed as needed" },
  { id: "broadband_committee", name: "Broadband Committee", defaultType: "appointed", note: "Increasingly common" },
];

function buildInitialBoards(): WizardBoardEntry[] {
  return STANDARD_BOARDS.map((b) => ({
    id: b.id,
    name: b.name,
    memberCount: 5,
    electedOrAppointed: b.defaultType,
    isCustom: false,
    checked: false,
  }));
}

// ─── Component ──────────────────────────────────────────────────────

interface WizardStage4Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: {
    validate: () => WizardStage4Data | null;
    getData?: () => WizardStage4Data;
  }) => void;
}

export function WizardStage4({ onValidityChange, onRegister }: WizardStage4Props) {
  const { state } = useWizard();

  // Initialize with saved state or standard boards (all unchecked)
  const initialValues: WizardStage4Data =
    state.stage4.boards.length > 0 ? state.stage4 : { boards: buildInitialBoards() };

  const { values, isValid, setValue, validate } =
    useWizardForm<WizardStage4Data>(WizardStage4Schema, initialValues);

  // Custom board input state
  const [customBoardName, setCustomBoardName] = useState("");
  const [customBoardError, setCustomBoardError] = useState("");

  // Notify parent of validity changes
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

  // ─── Board handlers ───────────────────────────────────────────

  const updateBoard = useCallback(
    (index: number, updates: Partial<WizardBoardEntry>) => {
      const newBoards = values.boards.map((b, i) =>
        i === index ? { ...b, ...updates } : b
      );
      setValue("boards", newBoards);
    },
    [setValue, values.boards]
  );

  const toggleBoard = useCallback(
    (index: number, checked: boolean) => {
      updateBoard(index, { checked });
    },
    [updateBoard]
  );

  const addCustomBoard = useCallback(() => {
    const name = customBoardName.trim();
    if (name.length < 2) {
      setCustomBoardError("Board name must be at least 2 characters");
      return;
    }
    if (name.length > 100) {
      setCustomBoardError("Board name must be less than 100 characters");
      return;
    }
    const newBoard: WizardBoardEntry = {
      id: `custom_${Date.now()}`,
      name,
      memberCount: 0,
      electedOrAppointed: "appointed",
      isCustom: true,
      checked: true,
    };
    setValue("boards", [...values.boards, newBoard]);
    setCustomBoardName("");
    setCustomBoardError("");
  }, [customBoardName, setValue, values.boards]);

  const removeCustomBoard = useCallback(
    (index: number) => {
      setValue(
        "boards",
        values.boards.filter((_, i) => i !== index)
      );
    },
    [setValue, values.boards]
  );

  // Find note for standard boards
  const getNoteForBoard = (id: string) =>
    STANDARD_BOARDS.find((b) => b.id === id)?.note ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Boards &amp; Committees</CardTitle>
        <CardDescription>
          Register the boards and committees beyond your governing board
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Check any boards your town currently has. You can add more later.
          </p>

          {/* Board checklist */}
          <div className="space-y-2">
            {values.boards.map((board, index) => {
              const note = board.isCustom ? null : getNoteForBoard(board.id);
              return (
                <div key={board.id} className="rounded-lg border">
                  {/* Checkbox row */}
                  <div className="flex items-center gap-3 p-3">
                    <Checkbox
                      id={`board-${board.id}`}
                      checked={board.checked}
                      onCheckedChange={(checked) =>
                        toggleBoard(index, checked === true)
                      }
                    />
                    <Label
                      htmlFor={`board-${board.id}`}
                      className="flex-1 cursor-pointer font-normal"
                    >
                      {board.name}
                      {note && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({note})
                        </span>
                      )}
                    </Label>
                    {board.isCustom && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeCustomBoard(index)}
                      >
                        <span aria-hidden>×</span>
                        <span className="sr-only">Remove {board.name}</span>
                      </Button>
                    )}
                  </div>

                  {/* Sub-configuration — shown when checked */}
                  {board.checked && (
                    <div className="border-t bg-muted/20 px-3 pb-3 pt-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1">
                          <Label
                            htmlFor={`board-name-${board.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Board Name
                          </Label>
                          <Input
                            id={`board-name-${board.id}`}
                            value={board.name}
                            onChange={(e) =>
                              updateBoard(index, { name: e.target.value })
                            }
                          />
                        </div>

                        <div className="space-y-1">
                          <Label
                            htmlFor={`board-count-${board.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Members
                          </Label>
                          <Input
                            id={`board-count-${board.id}`}
                            type="number"
                            min={0}
                            max={25}
                            value={board.memberCount}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              updateBoard(index, {
                                memberCount: isNaN(v)
                                  ? 0
                                  : Math.max(0, Math.min(25, v)),
                              });
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">
                            Type
                          </span>
                          <RadioGroup
                            value={board.electedOrAppointed}
                            onValueChange={(val) =>
                              updateBoard(index, {
                                electedOrAppointed: val as "elected" | "appointed",
                              })
                            }
                            className="flex gap-4 pt-1"
                          >
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem
                                value="elected"
                                id={`board-elected-${board.id}`}
                              />
                              <Label
                                htmlFor={`board-elected-${board.id}`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                Elected
                              </Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <RadioGroupItem
                                value="appointed"
                                id={`board-appointed-${board.id}`}
                              />
                              <Label
                                htmlFor={`board-appointed-${board.id}`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                Appointed
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add custom board */}
          <div className="rounded-lg border border-dashed p-3">
            <Label className="text-sm font-medium">
              Add another board or committee
            </Label>
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Board or committee name"
                value={customBoardName}
                onChange={(e) => {
                  setCustomBoardName(e.target.value);
                  if (customBoardError) setCustomBoardError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomBoard();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustomBoard}
                disabled={customBoardName.trim().length < 2}
              >
                Add
              </Button>
            </div>
            {customBoardError && (
              <p className="mt-1 text-xs text-destructive">{customBoardError}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
