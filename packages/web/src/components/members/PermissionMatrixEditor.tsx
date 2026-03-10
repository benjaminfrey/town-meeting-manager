/**
 * PermissionMatrixEditor — visual grid for configuring staff permissions.
 *
 * Organized by functional area per advisory 1.2. Each action row can be
 * toggled between Y (global true), N (global false), or Board-specific.
 * T1-T4 are admin-only and locked. V1-V5 are always allowed and locked.
 */

import { useCallback, useMemo } from "react";
import { Check, X, Lock, Building2 } from "lucide-react";
import {
  PERMISSIONS,
  ADMIN_ONLY_ACTIONS,
  BOARD_MEMBER_ALWAYS_ACTIONS,
  VIEW_ACTIONS,
} from "@town-meeting/shared";
import type {
  PermissionAction,
  PermissionsMatrix,
  BoardPermissionOverride,
} from "@town-meeting/shared";
import { Button } from "@/components/ui/button";

// ─── Permission labels & groups ───────────────────────────────────────

const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSIONS.T1]: "Manage town profile / settings",
  [PERMISSIONS.T2]: "Manage user accounts",
  [PERMISSIONS.T3]: "Manage board configuration",
  [PERMISSIONS.T4]: "Set staff/board member permissions",
  [PERMISSIONS.A1]: "Create a new meeting",
  [PERMISSIONS.A2]: "Build / edit agenda items",
  [PERMISSIONS.A3]: "Upload attachments (as staff)",
  [PERMISSIONS.A4]: "Upload files for review (board member)",
  [PERMISSIONS.A5]: "Publish agenda / meeting notice",
  [PERMISSIONS.A6]: "Generate agenda packet (PDF)",
  [PERMISSIONS.A7]: "Submit questions/comments (board member)",
  [PERMISSIONS.M1]: "Start / run a live meeting",
  [PERMISSIONS.M2]: "Record attendance",
  [PERMISSIONS.M3]: "Capture motions, seconds, votes",
  [PERMISSIONS.M4]: "Record a recusal (with reason)",
  [PERMISSIONS.M5]: "Serve as recording secretary",
  [PERMISSIONS.M6]: "Trigger executive session",
  [PERMISSIONS.M7]: "Manage speaker queue",
  [PERMISSIONS.M8]: "Vote as board member",
  [PERMISSIONS.R1]: "Edit draft minutes post-meeting",
  [PERMISSIONS.R2]: "Generate AI minutes draft",
  [PERMISSIONS.R3]: "Submit draft for board review",
  [PERMISSIONS.R4]: "View draft minutes",
  [PERMISSIONS.R5]: "Publish approved minutes",
  [PERMISSIONS.R6]: "Export minutes (PDF / DOCX)",
  [PERMISSIONS.C1]: "Create / send straw polls",
  [PERMISSIONS.C2]: "Manage notification settings",
  [PERMISSIONS.C3]: "Manage resident accounts",
  [PERMISSIONS.C4]: "Moderate public comments",
  [PERMISSIONS.C5]: "Configure public portal content",
  [VIEW_ACTIONS.V1]: "View agenda",
  [VIEW_ACTIONS.V2]: "Download agenda as PDF",
  [VIEW_ACTIONS.V3]: "View approved minutes",
  [VIEW_ACTIONS.V4]: "View meeting calendar",
  [VIEW_ACTIONS.V5]: "View board/member directory",
};

interface PermissionGroup {
  label: string;
  codes: string[];
  actions: PermissionAction[];
  locked?: "admin" | "board_member" | "always_on";
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "Town & System Management",
    codes: ["T1", "T2", "T3", "T4"],
    actions: [PERMISSIONS.T1, PERMISSIONS.T2, PERMISSIONS.T3, PERMISSIONS.T4],
    locked: "admin",
  },
  {
    label: "Agenda & Meeting Prep",
    codes: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"],
    actions: [
      PERMISSIONS.A1,
      PERMISSIONS.A2,
      PERMISSIONS.A3,
      PERMISSIONS.A4,
      PERMISSIONS.A5,
      PERMISSIONS.A6,
      PERMISSIONS.A7,
    ],
  },
  {
    label: "Live Meeting Operations",
    codes: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
    actions: [
      PERMISSIONS.M1,
      PERMISSIONS.M2,
      PERMISSIONS.M3,
      PERMISSIONS.M4,
      PERMISSIONS.M5,
      PERMISSIONS.M6,
      PERMISSIONS.M7,
      PERMISSIONS.M8,
    ],
  },
  {
    label: "Minutes & Records",
    codes: ["R1", "R2", "R3", "R4", "R5", "R6"],
    actions: [
      PERMISSIONS.R1,
      PERMISSIONS.R2,
      PERMISSIONS.R3,
      PERMISSIONS.R4,
      PERMISSIONS.R5,
      PERMISSIONS.R6,
    ],
  },
  {
    label: "Civic Engagement",
    codes: ["C1", "C2", "C3", "C4", "C5"],
    actions: [
      PERMISSIONS.C1,
      PERMISSIONS.C2,
      PERMISSIONS.C3,
      PERMISSIONS.C4,
      PERMISSIONS.C5,
    ],
  },
  {
    label: "View & Download",
    codes: ["V1", "V2", "V3", "V4", "V5"],
    actions: [
      VIEW_ACTIONS.V1,
      VIEW_ACTIONS.V2,
      VIEW_ACTIONS.V3,
      VIEW_ACTIONS.V4,
      VIEW_ACTIONS.V5,
    ] as PermissionAction[],
    locked: "always_on",
  },
];

// ─── Types ────────────────────────────────────────────────────────────

type PermState = "Y" | "N" | "board_specific";

interface PermissionMatrixEditorProps {
  permissions: PermissionsMatrix;
  onChange: (permissions: PermissionsMatrix) => void;
  boards: Array<{ id: string; name: string }>;
  /** Which boards are selected for board-specific permissions */
  selectedBoardIds: string[];
  onSelectedBoardIdsChange: (boardIds: string[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────

export function PermissionMatrixEditor({
  permissions,
  onChange,
  boards,
  selectedBoardIds,
  onSelectedBoardIdsChange,
}: PermissionMatrixEditorProps) {
  // Determine state for an action
  const getState = useCallback(
    (action: PermissionAction): PermState => {
      // Check if any board override has this action
      const hasOverride = permissions.board_overrides?.some(
        (o) => action in o.permissions,
      );
      if (hasOverride && !permissions.global?.[action]) return "board_specific";
      if (permissions.global?.[action]) return "Y";
      return "N";
    },
    [permissions],
  );

  // Cycle through states: N → Y → board_specific → N
  const cycleState = useCallback(
    (action: PermissionAction) => {
      const current = getState(action);
      const newGlobal = { ...permissions.global };
      let newOverrides = [...(permissions.board_overrides ?? [])];

      if (current === "N") {
        // → Y
        newGlobal[action] = true;
        // Remove from overrides
        newOverrides = newOverrides.map((o) => {
          const p = { ...o.permissions };
          delete p[action];
          return { ...o, permissions: p };
        });
      } else if (current === "Y") {
        // → board_specific
        newGlobal[action] = false;
        // Add to selected board overrides
        for (const boardId of selectedBoardIds) {
          const existing = newOverrides.find((o) => o.board_id === boardId);
          if (existing) {
            existing.permissions = { ...existing.permissions, [action]: true };
          } else {
            newOverrides.push({
              board_id: boardId,
              permissions: { [action]: true },
            });
          }
        }
      } else {
        // board_specific → N
        newGlobal[action] = false;
        newOverrides = newOverrides.map((o) => {
          const p = { ...o.permissions };
          delete p[action];
          return { ...o, permissions: p };
        });
      }

      // Clean up empty overrides
      newOverrides = newOverrides.filter(
        (o) => Object.keys(o.permissions).length > 0,
      );

      onChange({
        global: newGlobal,
        board_overrides: newOverrides,
      });
    },
    [permissions, getState, selectedBoardIds, onChange],
  );

  const isActionLocked = (action: PermissionAction): boolean => {
    return (
      ADMIN_ONLY_ACTIONS.includes(action) ||
      BOARD_MEMBER_ALWAYS_ACTIONS.includes(action) ||
      Object.values(VIEW_ACTIONS).includes(action as string as never)
    );
  };

  const isBoardMemberOnly = (action: PermissionAction): boolean => {
    return BOARD_MEMBER_ALWAYS_ACTIONS.includes(action);
  };

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.label} className="rounded-lg border">
          <div className="border-b bg-muted/50 px-3 py-2">
            <h4 className="text-sm font-medium">{group.label}</h4>
          </div>
          <div className="divide-y">
            {group.actions.map((action, i) => {
              const code = group.codes[i];
              const label = PERMISSION_LABELS[action] ?? action;
              const locked = group.locked;
              const bmOnly = isBoardMemberOnly(action);
              const state = getState(action);

              return (
                <div
                  key={action}
                  className={`flex items-center gap-3 px-3 py-2 ${
                    locked || bmOnly ? "opacity-60" : ""
                  }`}
                >
                  <span className="w-8 text-xs font-mono text-muted-foreground">
                    {code}
                  </span>
                  <span className="flex-1 text-sm">{label}</span>

                  {locked === "admin" ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" />
                      <span>Admin only</span>
                    </div>
                  ) : locked === "always_on" ? (
                    <div className="flex items-center gap-1 text-xs text-green-600">
                      <Check className="h-3.5 w-3.5" />
                      <span>Always</span>
                    </div>
                  ) : bmOnly ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" />
                      <span>Board member only</span>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => cycleState(action)}
                    >
                      {state === "Y" && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Check className="h-3.5 w-3.5" />
                          <span className="text-xs">All boards</span>
                        </span>
                      )}
                      {state === "N" && (
                        <span className="flex items-center gap-1 text-red-500">
                          <X className="h-3.5 w-3.5" />
                          <span className="text-xs">Denied</span>
                        </span>
                      )}
                      {state === "board_specific" && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Building2 className="h-3.5 w-3.5" />
                          <span className="text-xs">Board-specific</span>
                        </span>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Board selector for board-specific permissions */}
      {boards.length > 0 && (
        <div className="rounded-lg border p-3 space-y-2">
          <h4 className="text-sm font-medium">
            Boards for board-specific permissions
          </h4>
          <p className="text-xs text-muted-foreground">
            When a permission is set to "Board-specific", it applies only to the
            boards selected here.
          </p>
          <div className="space-y-1.5">
            {boards.map((board) => (
              <label
                key={board.id}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedBoardIds.includes(board.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onSelectedBoardIdsChange([
                        ...selectedBoardIds,
                        board.id,
                      ]);
                    } else {
                      onSelectedBoardIdsChange(
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
        </div>
      )}
    </div>
  );
}
