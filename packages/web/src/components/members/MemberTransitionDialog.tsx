/**
 * MemberTransitionDialog — handles role transitions for board members.
 *
 * Supports: archive membership, move to different board, convert to staff,
 * convert from staff to board member. Enforces mutual exclusivity rules.
 */

import { useState, useMemo, useCallback } from "react";
import { usePowerSync, useQuery } from "@powersync/react";
import { Loader2 } from "lucide-react";
import { checkRoleMutualExclusivity } from "@town-meeting/shared";
import type { PermissionsMatrix, PermissionAction, UserRole } from "@town-meeting/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RoleConflictDialog } from "./RoleConflictDialog";
import { StaffAccountFlow } from "./StaffAccountFlow";
import { BoardMemberConfigForm } from "./BoardMemberConfigForm";
import type { BoardMemberFormData } from "./BoardMemberConfigForm";
import type { StaffAccountResult } from "./StaffAccountFlow";

interface MemberTransitionDialogProps {
  member: {
    id: string;
    person_id: string;
    name: string;
    role: string | null;
    user_account_id: string | null;
  };
  boardId: string;
  boardName: string;
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TransitionType =
  | "archive"
  | "move_board"
  | "to_staff"
  | "to_board_member";

export function MemberTransitionDialog({
  member,
  boardId,
  boardName,
  townId,
  open,
  onOpenChange,
}: MemberTransitionDialogProps) {
  const powerSync = usePowerSync();
  const [transition, setTransition] = useState<TransitionType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [pendingTransition, setPendingTransition] =
    useState<TransitionType | null>(null);
  const [targetBoardId, setTargetBoardId] = useState<string>("");

  // Board member config for "to_board_member" transition
  const [bmConfig, setBmConfig] = useState<BoardMemberFormData>({
    seat_title: "",
    term_start: new Date().toISOString().split("T")[0]!,
    term_end: "",
    gov_title: "",
    is_default_rec_sec: false,
  });

  // Active boards for "move to different board"
  const { data: boardRows } = useQuery(
    "SELECT id, name, election_method FROM boards WHERE town_id = ? AND archived_at IS NULL AND id != ? ORDER BY name",
    [townId, boardId],
  );
  const otherBoards = useMemo(
    () =>
      ((boardRows ?? []) as Record<string, unknown>[]).map((b) => ({
        id: String(b.id),
        name: String(b.name),
        election_method: String(b.election_method ?? "at_large"),
      })),
    [boardRows],
  );

  // Check for other active board memberships
  const { data: otherMembershipRows } = useQuery(
    "SELECT COUNT(*) as count FROM board_members WHERE person_id = ? AND board_id != ? AND status = 'active'",
    [member.person_id, boardId],
  );
  const otherActiveMemberships = Number(
    (otherMembershipRows?.[0] as Record<string, unknown>)?.count ?? 0,
  );

  // Mutual exclusivity check
  const conflict = useMemo(() => {
    if (transition === "to_staff") {
      return checkRoleMutualExclusivity(
        member.role as "board_member" | null,
        "staff",
      );
    }
    if (transition === "to_board_member") {
      return checkRoleMutualExclusivity(
        member.role as "staff" | null,
        "board_member",
      );
    }
    return { conflict: false };
  }, [transition, member.role]);

  const handleTransitionSelect = (value: TransitionType) => {
    setTransition(value);

    // Check mutual exclusivity for role changes
    if (value === "to_staff" || value === "to_board_member") {
      const check = checkRoleMutualExclusivity(
        (member.role as string | null) as UserRole | null,
        value === "to_staff" ? "staff" : "board_member",
      );
      if (check.conflict && member.user_account_id) {
        setPendingTransition(value);
        setShowConflictDialog(true);
        return;
      }
    }
  };

  const handleConflictResolved = () => {
    // Conflict was resolved (account archived), continue with transition
    setShowConflictDialog(false);
    setTransition(pendingTransition);
  };

  // ─── Execute transitions ───────────────────────────────────────────

  const handleArchive = useCallback(async () => {
    setIsSaving(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      await powerSync.execute(
        "UPDATE board_members SET status = 'archived', term_end = ? WHERE id = ?",
        [today, member.id],
      );
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [powerSync, member.id, onOpenChange]);

  const handleMoveBoard = useCallback(async () => {
    if (!targetBoardId) return;
    setIsSaving(true);
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const today = now.split("T")[0];

      await powerSync.execute(
        `INSERT INTO board_members (id, person_id, board_id, town_id, seat_title, term_start, term_end, status, is_default_rec_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          member.person_id,
          targetBoardId,
          townId,
          null,
          today,
          null,
          "active",
          0,
          now,
        ],
      );

      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [powerSync, member.person_id, targetBoardId, townId, onOpenChange]);

  const handleToStaff = useCallback(
    async (staffResult: StaffAccountResult) => {
      setIsSaving(true);
      try {
        const now = new Date().toISOString();
        const today = now.split("T")[0];

        // Archive all active board memberships
        await powerSync.execute(
          "UPDATE board_members SET status = 'archived', term_end = ? WHERE person_id = ? AND status = 'active'",
          [today, member.person_id],
        );

        if (member.user_account_id) {
          // Update existing user_account to staff role
          await powerSync.execute(
            "UPDATE user_accounts SET role = 'staff', permissions = ?, gov_title = ?, archived_at = NULL WHERE id = ?",
            [
              JSON.stringify(staffResult.permissions),
              staffResult.gov_title || null,
              member.user_account_id,
            ],
          );
        } else {
          // Create new staff user_account
          const uaId = crypto.randomUUID();
          await powerSync.execute(
            `INSERT INTO user_accounts (id, person_id, town_id, role, gov_title, permissions, auth_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              uaId,
              member.person_id,
              townId,
              "staff",
              staffResult.gov_title || null,
              JSON.stringify(staffResult.permissions),
              "",
              now,
            ],
          );
        }

        onOpenChange(false);
      } finally {
        setIsSaving(false);
      }
    },
    [powerSync, member.person_id, member.user_account_id, townId, onOpenChange],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transition Member</DialogTitle>
            <DialogDescription>
              Choose a transition for{" "}
              <strong>{member.name}</strong> on {boardName}.
            </DialogDescription>
          </DialogHeader>

          {!transition && (
            <div className="space-y-4">
              <RadioGroup
                value=""
                onValueChange={(val) =>
                  handleTransitionSelect(val as TransitionType)
                }
                className="space-y-2"
              >
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                  <RadioGroupItem value="archive" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium">
                      Archive board membership
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Archive this membership. Term end set to today. Historical
                      records preserved.
                    </div>
                  </div>
                </label>

                {otherBoards.length > 0 && (
                  <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                    <RadioGroupItem value="move_board" className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">
                        Add to different board
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Add a new board membership (multi-board is allowed).
                        Current membership remains active.
                      </div>
                    </div>
                  </label>
                )}

                {member.role === "board_member" && (
                  <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                    <RadioGroupItem value="to_staff" className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">
                        Convert to staff
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Archive all board memberships and change role to staff.
                        Requires mutual exclusivity check.
                      </div>
                    </div>
                  </label>
                )}
              </RadioGroup>
            </div>
          )}

          {/* Archive confirmation */}
          {transition === "archive" && (
            <div className="space-y-3">
              <p className="text-sm">
                This will archive {member.name}'s membership on {boardName}.
              </p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                <li>Term end set to today, status changed to archived</li>
                <li>Historical records preserved</li>
                {otherActiveMemberships === 0 && (
                  <li>No other active board memberships</li>
                )}
              </ul>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setTransition(null)}
                  disabled={isSaving}
                >
                  Back
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleArchive()}
                  disabled={isSaving}
                >
                  {isSaving && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Archive Membership
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Move to different board */}
          {transition === "move_board" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Select board</Label>
                <Select value={targetBoardId} onValueChange={setTargetBoardId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a board" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherBoards.map((board) => (
                      <SelectItem key={board.id} value={board.id}>
                        {board.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setTransition(null)}
                  disabled={isSaving}
                >
                  Back
                </Button>
                <Button
                  onClick={() => void handleMoveBoard()}
                  disabled={!targetBoardId || isSaving}
                >
                  {isSaving && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Add to Board
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Convert to staff */}
          {transition === "to_staff" && (
            <StaffAccountFlow
              townId={townId}
              onComplete={(result) => void handleToStaff(result)}
              onBack={() => setTransition(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Role conflict dialog */}
      {showConflictDialog && member.user_account_id && (
        <RoleConflictDialog
          personName={member.name}
          conflict={conflict}
          userAccountId={member.user_account_id}
          open={showConflictDialog}
          onOpenChange={setShowConflictDialog}
          onResolved={handleConflictResolved}
        />
      )}
    </>
  );
}
