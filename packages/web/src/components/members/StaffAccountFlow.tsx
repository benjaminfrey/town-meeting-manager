/**
 * StaffAccountFlow — three-step flow for creating a staff account.
 *
 * Step 1: Select permission template (5 options per advisory 1.2)
 * Step 2: Customize permissions via PermissionMatrixEditor
 * Step 3: Select boards for board-specific templates (conditional)
 */

import { useState, useMemo } from "react";
import { useQuery } from "@powersync/react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DEFAULT_PERMISSION_TEMPLATES,
  buildPermissionsFromTemplate,
  ALL_PERMISSION_ACTIONS,
} from "@town-meeting/shared";
import type {
  PermissionsMatrix,
  PermissionAction,
  PermissionTemplateDefinition,
} from "@town-meeting/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { PermissionMatrixEditor } from "./PermissionMatrixEditor";

export interface StaffAccountResult {
  permissions: PermissionsMatrix;
  gov_title: string;
}

interface StaffAccountFlowProps {
  townId: string;
  onComplete: (result: StaffAccountResult) => void;
  onBack: () => void;
}

export function StaffAccountFlow({
  townId,
  onComplete,
  onBack,
}: StaffAccountFlowProps) {
  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] =
    useState<PermissionTemplateDefinition | null>(null);
  const [permissions, setPermissions] = useState<PermissionsMatrix>({
    global: {} as Record<PermissionAction, boolean>,
    board_overrides: [],
  });
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);
  const [govTitle, setGovTitle] = useState("");

  // Fetch active boards for board-specific selection
  const { data: boardRows } = useQuery(
    "SELECT id, name FROM boards WHERE town_id = ? AND archived_at IS NULL ORDER BY name",
    [townId],
  );
  const boards = useMemo(
    () =>
      ((boardRows ?? []) as Record<string, unknown>[]).map((b) => ({
        id: String(b.id),
        name: String(b.name),
      })),
    [boardRows],
  );

  const needsBoardSelection =
    selectedTemplate?.scope === "designated_boards" &&
    selectedBoardIds.length === 0;

  // ─── Step 1: Template selection ─────────────────────────────────────
  const handleSelectTemplate = (template: PermissionTemplateDefinition) => {
    setSelectedTemplate(template);
    const global = buildPermissionsFromTemplate(template);
    if (template.scope === "designated_boards") {
      // For board-specific templates, start with all false globally
      // and we'll apply to overrides when boards are selected
      const emptyGlobal = {} as Record<PermissionAction, boolean>;
      for (const action of ALL_PERMISSION_ACTIONS) {
        emptyGlobal[action] = false;
      }
      setPermissions({ global: emptyGlobal, board_overrides: [] });
    } else {
      setPermissions({ global, board_overrides: [] });
    }
    setStep(2);
  };

  // ─── Step 3: Apply board-specific permissions ───────────────────────
  const handleBoardSelectionComplete = () => {
    if (selectedTemplate?.scope === "designated_boards") {
      const templatePerms = buildPermissionsFromTemplate(selectedTemplate);
      const overrides = selectedBoardIds.map((boardId) => ({
        board_id: boardId,
        permissions: Object.entries(templatePerms)
          .filter(([, v]) => v)
          .reduce(
            (acc, [k]) => ({ ...acc, [k]: true }),
            {} as Partial<Record<PermissionAction, boolean>>,
          ),
      }));
      setPermissions((prev) => ({ ...prev, board_overrides: overrides }));
    }
    onComplete({ permissions, gov_title: govTitle.trim() });
  };

  // ─── Step 2 complete ───────────────────────────────────────────────
  const handleStep2Next = () => {
    if (selectedTemplate?.scope === "designated_boards") {
      setStep(3);
    } else {
      onComplete({ permissions, gov_title: govTitle.trim() });
    }
  };

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={step === 1 ? "font-medium text-foreground" : ""}>
          1. Template
        </span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className={step === 2 ? "font-medium text-foreground" : ""}>
          2. Customize
        </span>
        {selectedTemplate?.scope === "designated_boards" && (
          <>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className={step === 3 ? "font-medium text-foreground" : ""}>
              3. Boards
            </span>
          </>
        )}
      </div>

      {/* Step 1: Template Selection */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select a permission template as a starting point. You can customize
            individual permissions in the next step.
          </p>

          {/* Government title */}
          <div className="space-y-1.5">
            <Label>Government title (optional)</Label>
            <Input
              value={govTitle}
              onChange={(e) => setGovTitle(e.target.value)}
              placeholder="e.g., Town Clerk, Deputy Clerk, Town Planner"
              maxLength={100}
            />
            <div className="flex items-start gap-1.5">
              <Info className="mt-0.5 h-3 w-3 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">
                Display label only — has no effect on permissions.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {DEFAULT_PERMISSION_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => handleSelectTemplate(template)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{template.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {template.scope === "all_boards"
                      ? "All boards"
                      : "Designated boards"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {template.description}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {template.permissions.length} permission
                  {template.permissions.length !== 1 ? "s" : ""}
                </p>
              </button>
            ))}
          </div>

          <div className="flex justify-start">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Back
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Customize Permissions */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Customize permissions for this staff account. Click a permission to
            cycle through: Allowed → Denied → Board-specific.
          </p>

          <div className="max-h-[400px] overflow-y-auto">
            <PermissionMatrixEditor
              permissions={permissions}
              onChange={setPermissions}
              boards={boards}
              selectedBoardIds={selectedBoardIds}
              onSelectedBoardIdsChange={setSelectedBoardIds}
            />
          </div>

          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Back
            </Button>
            <Button size="sm" onClick={handleStep2Next}>
              {selectedTemplate?.scope === "designated_boards"
                ? "Select Boards"
                : "Complete"}
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Board Selection (for designated_boards templates) */}
      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select which boards these permissions apply to.
          </p>

          {boards.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No active boards found. Create boards first.
            </p>
          ) : (
            <div className="space-y-2">
              {boards.map((board) => (
                <label
                  key={board.id}
                  className="flex items-center gap-2 cursor-pointer rounded-lg border p-3 hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="checkbox"
                    checked={selectedBoardIds.includes(board.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedBoardIds([...selectedBoardIds, board.id]);
                      } else {
                        setSelectedBoardIds(
                          selectedBoardIds.filter((id) => id !== board.id),
                        );
                      }
                    }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">{board.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setStep(2)}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Back
            </Button>
            <Button
              size="sm"
              onClick={handleBoardSelectionComplete}
              disabled={selectedBoardIds.length === 0}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              Complete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
