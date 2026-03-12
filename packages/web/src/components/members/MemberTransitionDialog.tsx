/**
 * MemberTransitionDialog — handles role transitions for board members.
 *
 * Supports: archive membership, move to different board, convert to staff,
 * convert from staff to board member. Enforces mutual exclusivity rules.
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { Loader2 } from "lucide-react";
import { checkRoleMutualExclusivity } from "@town-meeting/shared";
import type { PermissionsMatrix, UserRole } from "@town-meeting/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RoleConflictDialog } from "./RoleConflictDialog";
import { StaffAccountFlow } from "./StaffAccountFlow";
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
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [transition, setTransition] = useState<TransitionType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [pendingTransition, setPendingTransition] =
    useState<TransitionType | null>(null);
  const [targetBoardId, setTargetBoardId] = useState<string>("");

  // Active boards for "move to different board"
  const { data: boardRows = [] } = useQuery({
    queryKey: [...queryKeys.boards.byTown(townId), 'otherBoards', boardId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('board')
        .select('id, name, election_method')
        .eq('town_id', townId)
        .is('archived_at', null)
        .neq('id', boardId)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!townId,
  });
  const otherBoards = useMemo(
    () =>
      boardRows.map((b) => ({
        id: String(b.id),
        name: String(b.name),
        election_method: String(b.election_method ?? "at_large"),
      })),
    [boardRows],
  );

  // Check for other active board memberships
  const { data: otherActiveMemberships = 0 } = useQuery({
    queryKey: [...queryKeys.members.byPerson(member.person_id), 'otherActive', boardId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('board_member')
        .select('*', { count: 'exact', head: true })
        .eq('person_id', member.person_id)
        .neq('board_id', boardId)
        .eq('status', 'active');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!member.person_id,
  });

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

  const { mutate: archiveMembership, isPending: isArchivingPending } = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { error } = await supabase
        .from('board_member')
        .update({ status: 'archived', term_end: today })
        .eq('id', member.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      onOpenChange(false);
    },
  });

  const { mutate: moveMembership, isPending: isMovingPending } = useMutation({
    mutationFn: async () => {
      if (!targetBoardId) throw new Error("No target board selected");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const today = now.split("T")[0];
      const { error } = await supabase.from('board_member').insert({
        id,
        person_id: member.person_id,
        board_id: targetBoardId,
        town_id: townId,
        seat_title: null,
        term_start: today,
        term_end: null,
        status: "active",
        is_default_rec_sec: false,
        created_at: now,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(targetBoardId) });
      onOpenChange(false);
    },
  });

  const { mutate: convertToStaff, isPending: isConvertingPending } = useMutation({
    mutationFn: async (staffResult: StaffAccountResult) => {
      const now = new Date().toISOString();
      const today = now.split("T")[0];

      // Archive all active board memberships
      const { error: archiveError } = await supabase
        .from('board_member')
        .update({ status: 'archived', term_end: today })
        .eq('person_id', member.person_id)
        .eq('status', 'active');
      if (archiveError) throw archiveError;

      if (member.user_account_id) {
        // Update existing user_account to staff role
        const { error } = await supabase
          .from('user_account')
          .update({
            role: 'staff',
            permissions: staffResult.permissions,
            gov_title: staffResult.gov_title || null,
            archived_at: null,
          })
          .eq('id', member.user_account_id);
        if (error) throw error;
      } else {
        // Create new staff user_account
        const uaId = crypto.randomUUID();
        const { error } = await supabase.from('user_account').insert({
          id: uaId,
          person_id: member.person_id,
          town_id: townId,
          role: "staff",
          gov_title: staffResult.gov_title || null,
          permissions: staffResult.permissions,
          auth_user_id: "",
          created_at: now,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.userAccounts.byTown(townId) });
      onOpenChange(false);
    },
  });

  const handleArchive = useCallback(() => {
    archiveMembership();
  }, [archiveMembership]);

  const handleMoveBoard = useCallback(() => {
    moveMembership();
  }, [moveMembership]);

  const handleToStaff = useCallback(
    (staffResult: StaffAccountResult) => {
      convertToStaff(staffResult);
    },
    [convertToStaff],
  );

  const isPendingAny = isArchivingPending || isMovingPending || isConvertingPending || isSaving;

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
                  disabled={isPendingAny}
                >
                  Back
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleArchive}
                  disabled={isPendingAny}
                >
                  {isArchivingPending && (
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
                  disabled={isPendingAny}
                >
                  Back
                </Button>
                <Button
                  onClick={handleMoveBoard}
                  disabled={!targetBoardId || isPendingAny}
                >
                  {isMovingPending && (
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
              onComplete={(result) => handleToStaff(result)}
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
