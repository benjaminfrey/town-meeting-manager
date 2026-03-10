/**
 * PermissionOverrideView — shows a staff member's effective permissions
 * per board with differences from global defaults highlighted.
 */

import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { Check, X, Minus } from "lucide-react";
import { PERMISSIONS } from "@town-meeting/shared";
import type { PermissionsMatrix, PermissionAction } from "@town-meeting/shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSIONS.A1]: "Create meeting",
  [PERMISSIONS.A2]: "Edit agenda",
  [PERMISSIONS.A3]: "Upload attachments",
  [PERMISSIONS.A5]: "Publish agenda",
  [PERMISSIONS.A6]: "Generate packet",
  [PERMISSIONS.M1]: "Run meeting",
  [PERMISSIONS.M2]: "Record attendance",
  [PERMISSIONS.M3]: "Capture motions/votes",
  [PERMISSIONS.M4]: "Record recusal",
  [PERMISSIONS.M5]: "Recording secretary",
  [PERMISSIONS.M6]: "Executive session",
  [PERMISSIONS.M7]: "Speaker queue",
  [PERMISSIONS.R1]: "Edit minutes",
  [PERMISSIONS.R2]: "AI minutes draft",
  [PERMISSIONS.R3]: "Submit for review",
  [PERMISSIONS.R4]: "View drafts",
  [PERMISSIONS.R5]: "Publish minutes",
  [PERMISSIONS.R6]: "Export minutes",
  [PERMISSIONS.C1]: "Straw polls",
  [PERMISSIONS.C2]: "Notification settings",
  [PERMISSIONS.C3]: "Resident accounts",
  [PERMISSIONS.C4]: "Moderate comments",
  [PERMISSIONS.C5]: "Portal config",
};

interface PermissionOverrideViewProps {
  permissions: PermissionsMatrix;
  townId: string;
}

export function PermissionOverrideView({
  permissions,
  townId,
}: PermissionOverrideViewProps) {
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

  // Find boards that have overrides
  const overriddenBoards = useMemo(() => {
    if (!permissions.board_overrides?.length) return [];
    return permissions.board_overrides
      .filter((o) => Object.keys(o.permissions).length > 0)
      .map((o) => {
        const board = boards.find((b) => b.id === o.board_id);
        const diffs = Object.entries(o.permissions)
          .filter(([action]) => {
            const globalVal = permissions.global?.[action as PermissionAction];
            return o.permissions[action as PermissionAction] !== globalVal;
          })
          .map(([action, value]) => ({
            action: action as PermissionAction,
            label: PERMISSION_LABELS[action] ?? action,
            overrideValue: value ?? false,
            globalValue: permissions.global?.[action as PermissionAction] ?? false,
          }));

        return {
          boardId: o.board_id,
          boardName: board?.name ?? "Unknown board",
          diffs,
          totalOverrides: Object.keys(o.permissions).length,
        };
      })
      .filter((b) => b.diffs.length > 0 || b.totalOverrides > 0);
  }, [permissions, boards]);

  if (overriddenBoards.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No board-specific overrides. Global permissions apply to all boards.
      </p>
    );
  }

  return (
    <Accordion type="multiple" className="w-full">
      {overriddenBoards.map((board) => (
        <AccordionItem key={board.boardId} value={board.boardId}>
          <AccordionTrigger className="text-sm">
            <div className="flex items-center gap-2">
              <span>{board.boardName}</span>
              <Badge variant="outline" className="text-xs">
                {board.totalOverrides} override
                {board.totalOverrides !== 1 ? "s" : ""}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1">
              {board.diffs.map((diff) => (
                <div
                  key={diff.action}
                  className="flex items-center gap-2 text-sm"
                >
                  {diff.overrideValue ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span>{diff.label}</span>
                  <span className="text-xs text-muted-foreground">
                    (global: {diff.globalValue ? "Y" : "N"})
                  </span>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
