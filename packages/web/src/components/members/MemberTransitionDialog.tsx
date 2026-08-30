/**
 * MemberTransitionDialog — handles role transitions for board members.
 *
 * Supports: archive membership, move to different board, convert to staff,
 * convert from staff to board member. Enforces mutual exclusivity rules.
 *
 * Phase E, wave 2, Task 4 — moved onto `boardMember.otherActiveCount`,
 * `boardMember.archiveMembership`, `boardMember.addToBoard` and
 * `boardMember.convertToStaff`. This file's own plan brief already measured
 * it at 7 sites / 5 writes (the master plan's "measured scope" table, at
 * commit `a165049`) — a later task dispatch's scope note claimed only 2
 * remained; checked against the file directly and was wrong. See this
 * task's report for the corrected count.
 *
 * `otherBoards` (the "move to different board" picker) now reads
 * `board.listActive` — the same procedure `StaffAccountFlow.tsx` already
 * uses for the identical "every active board in this town" question — and
 * filters out the current board client-side. `listActive` orders
 * `is_governing_board DESC, name ASC`, not strict alphabetical; accepted as
 * a harmless reorder, same call `StaffAccountFlow.tsx`'s own doc comment
 * already made for this procedure.
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
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

type TransitionType = "archive" | "move_board" | "to_staff" | "to_board_member";

export function MemberTransitionDialog({
  member,
  boardId,
  boardName,
  townId,
  open,
  onOpenChange,
}: MemberTransitionDialogProps) {
  const queryClient = useQueryClient();
  const [transition, setTransition] = useState<TransitionType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<TransitionType | null>(null);
  const [targetBoardId, setTargetBoardId] = useState<string>("");

  // Active boards for "move to different board" — `townId` is not a query
  // input; `board.listActive` scopes to the caller's own tenant server-side.
  const { data: boardRows = [] } = useQuery({
    ...trpc.board.listActive.queryOptions(),
    enabled: !!townId,
  });
  const otherBoards = useMemo(
    () =>
      boardRows
        .filter((b) => b.id !== boardId)
        .map((b) => ({
          id: b.id,
          name: b.name,
          election_method: b.election_method ?? "at_large",
        })),
    [boardRows, boardId],
  );

  // Check for other active board memberships
  const { data: otherActiveMemberships = 0 } = useQuery({
    ...trpc.boardMember.otherActiveCount.queryOptions({
      personId: member.person_id,
      excludeBoardId: boardId,
    }),
    enabled: !!member.person_id,
  });

  // Mutual exclusivity check
  const conflict = useMemo(() => {
    if (transition === "to_staff") {
      return checkRoleMutualExclusivity(member.role as "board_member" | null, "staff");
    }
    if (transition === "to_board_member") {
      return checkRoleMutualExclusivity(member.role as "staff" | null, "board_member");
    }
    return { conflict: false };
  }, [transition, member.role]);

  const handleTransitionSelect = (value: TransitionType) => {
    setTransition(value);

    // Check mutual exclusivity for role changes
    if (value === "to_staff" || value === "to_board_member") {
      const check = checkRoleMutualExclusivity(
        member.role as string | null as UserRole | null,
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

  const archiveMembershipMutation = useMutation(
    trpc.boardMember.archiveMembership.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
        // `MemberRoster.tsx` reads its roster through `boardMember.roster` now
        // (Phase E, wave 2, Task 3) — this mutation changes that row's status.
        void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
        onOpenChange(false);
      },
    }),
  );
  const isArchivingPending = archiveMembershipMutation.isPending;

  const moveMembershipMutation = useMutation(
    trpc.boardMember.addToBoard.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(targetBoardId) });
        // This seats the person on a NEW board — both that board's roster and
        // the town-wide `boardMember.memberCount` change. Router-level filter,
        // not per-board, per conventions item 7 ("a writer should not have to
        // know which procedures some screen happens to call").
        void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
        onOpenChange(false);
      },
    }),
  );
  const isMovingPending = moveMembershipMutation.isPending;

  const convertToStaffMutation = useMutation(
    trpc.boardMember.convertToStaff.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
        // `queryKeys.userAccounts.byTown` invalidation removed (Phase E, wave
        // 2, Task 3 fix round) — see `AddPersonDialog.tsx`'s identical comment
        // for why: that key has no reader left anywhere in the app.
        // This mutation creates OR updates a `user_account` — `person.list`
        // (which `people.tsx` now reads through, Phase E wave 1 Task 3) would
        // otherwise show this person's stale role until the 60s `staleTime`
        // expired.
        void queryClient.invalidateQueries(trpc.person.pathFilter());
        // Archives the board seat AND writes `user_account` — both roster
        // fields `boardMember.roster` selects.
        void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
        onOpenChange(false);
      },
    }),
  );
  const isConvertingPending = convertToStaffMutation.isPending;

  const handleArchive = useCallback(() => {
    archiveMembershipMutation.mutate({ boardMemberId: member.id });
  }, [archiveMembershipMutation, member.id]);

  const handleMoveBoard = useCallback(() => {
    if (!targetBoardId) return;
    moveMembershipMutation.mutate({ personId: member.person_id, boardId: targetBoardId });
  }, [moveMembershipMutation, member.person_id, targetBoardId]);

  const handleToStaff = useCallback(
    (staffResult: StaffAccountResult) => {
      convertToStaffMutation.mutate({
        personId: member.person_id,
        govTitle: staffResult.gov_title || null,
        permissions: staffResult.permissions,
      });
    },
    [convertToStaffMutation, member.person_id],
  );

  const isPendingAny = isArchivingPending || isMovingPending || isConvertingPending || isSaving;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transition Member</DialogTitle>
            <DialogDescription>
              Choose a transition for <strong>{member.name}</strong> on {boardName}.
            </DialogDescription>
          </DialogHeader>

          {!transition && (
            <div className="space-y-4">
              <RadioGroup
                value=""
                onValueChange={(val) => handleTransitionSelect(val as TransitionType)}
                className="space-y-2"
              >
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                  <RadioGroupItem value="archive" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium">Archive board membership</div>
                    <div className="text-xs text-muted-foreground">
                      Archive this membership. Term end set to today. Historical records preserved.
                    </div>
                  </div>
                </label>

                {otherBoards.length > 0 && (
                  <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                    <RadioGroupItem value="move_board" className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">Add to different board</div>
                      <div className="text-xs text-muted-foreground">
                        Add a new board membership (multi-board is allowed). Current membership
                        remains active.
                      </div>
                    </div>
                  </label>
                )}

                {member.role === "board_member" && (
                  <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50">
                    <RadioGroupItem value="to_staff" className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">Convert to staff</div>
                      <div className="text-xs text-muted-foreground">
                        Archive all board memberships and change role to staff. Requires mutual
                        exclusivity check.
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
                {otherActiveMemberships === 0 && <li>No other active board memberships</li>}
              </ul>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setTransition(null)}
                  disabled={isPendingAny}
                >
                  Back
                </Button>
                <Button variant="destructive" onClick={handleArchive} disabled={isPendingAny}>
                  {isArchivingPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                <Button onClick={handleMoveBoard} disabled={!targetBoardId || isPendingAny}>
                  {isMovingPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
