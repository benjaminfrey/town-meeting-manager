/**
 * MemberArchiveDialog — confirms archival of a board member.
 *
 * Archives the board_members entry (status='archived', term_end=today).
 * If the person has no other active board memberships, optionally
 * archives the user_account.
 *
 * Phase E, wave 2, Task 4 — moved onto `boardMember.otherActiveCount` and
 * `boardMember.archiveMembership`. The master plan's own "measured scope"
 * table already counted this file at 3 sites / 2 writes (unchanged since
 * wave 1) — a task dispatch that described it as "already fully migrated,
 * 0 supabase calls" was checked against the file directly and was wrong;
 * see this task's report.
 *
 * `otherActiveMemberships` and the "also archive account" decision now both
 * happen server-side in `archiveMembership` — the client sends
 * `archiveAccount` as a request, not an instruction; the server recomputes
 * whether another active membership exists and silently declines to archive
 * the account if one does, rather than trusting a stale client toggle. See
 * that procedure's own doc comment. `onSuccess` reads the server's own
 * `{ archivedAccount }` answer back, not the client's `willArchiveAccount`
 * guess, to decide whether `trpc.person.pathFilter()` needs invalidating —
 * review round: the first version of this file branched on the client's own
 * value here, which would have under-invalidated on exactly the race the
 * server-side recompute exists to handle.
 *
 * Review round: added `onError` — designed refusals (there are none today on
 * this specific mutation, but the shape is shared with `MemberTransitionDialog`'s
 * `addToBoard`/`convertToStaff`, which do throw `CONFLICT`) must not be
 * silently swallowed, per conventions item 5.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, errorMessage } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface MemberArchiveDialogProps {
  member: {
    id: string;
    person_id: string;
    name: string;
    user_account_id: string | null;
    role: string | null;
    gov_title: string | null;
  };
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// `errorMessage` (the message a CONFLICT carries; a generic one otherwise —
// only a designed refusal's own message is safe to show verbatim) moved to
// `@/lib/trpc` in this wave's whole-branch review: this file,
// `AddPersonDialog.tsx`, `MemberTransitionDialog.tsx` and
// `RoleConflictDialog.tsx` each carried an identical copy.

export function MemberArchiveDialog({
  member,
  boardId,
  open,
  onOpenChange,
}: MemberArchiveDialogProps) {
  const queryClient = useQueryClient();
  const [archiveAccount, setArchiveAccount] = useState(false);

  // Check for other active board memberships
  const { data: otherActiveMemberships = 0 } = useQuery({
    ...trpc.boardMember.otherActiveCount.queryOptions({
      personId: member.person_id,
      excludeBoardId: boardId,
    }),
    enabled: !!member.person_id,
  });
  const hasOtherMemberships = otherActiveMemberships > 0;

  const willArchiveAccount = archiveAccount && !hasOtherMemberships;

  const archiveMemberMutation = useMutation(
    trpc.boardMember.archiveMembership.mutationOptions({
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
        // `MemberRoster.tsx` reads its roster through `boardMember.roster` now
        // (Phase E, wave 2, Task 3) — unconditionally, unlike the
        // `trpc.person.pathFilter()` call below: archiving JUST the board seat
        // still changes that read's own `status` column for this row.
        void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
        // `result.archivedAccount` — the SERVER's own answer — not the
        // client's `willArchiveAccount` guess: `archiveMembership` recomputes
        // whether the account was actually archived (see this file's header
        // and that procedure's own doc comment), so this is the one place
        // that recompute's result is worth reading back, not re-derived.
        if (result.archivedAccount) {
          // `queryKeys.userAccounts.byTown` invalidation removed (Phase E,
          // wave 2, Task 3 fix round) — that key has no reader left anywhere
          // in the app (see `AddPersonDialog.tsx`'s identical comment for the
          // grep). `trpc.boardMember.pathFilter()` above already covers the
          // account-archived case this key used to reach.
          // Archiving the account changes what `person.list` reports for this
          // person (role/gov_title both go null) — `people.tsx` reads that
          // through `person.list` now (Phase E, wave 1, Task 3). No such
          // invalidation is needed when only the board seat is archived: that
          // does not touch `person`/`user_account`, which is all `person.list`
          // selects (see that router's own doc comment on the board_member
          // join it deliberately omits).
          void queryClient.invalidateQueries(trpc.person.pathFilter());
        }
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Couldn't archive this membership — please try again."));
      },
    }),
  );
  const isArchiving = archiveMemberMutation.isPending;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive Board Member</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Are you sure you want to archive <strong>{member.name}</strong>'s membership on this
                board?
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Board membership will be archived and term end set to today</li>
                <li>
                  Name and government title retained indefinitely (public record per Maine law)
                </li>
                <li>Historical records (votes, motions, attendance) preserved forever</li>
                <li>Personal contact info scrubbed after retention period (default 1 year)</li>
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Archive user account option */}
        {member.user_account_id && !hasOtherMemberships && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Switch
              id="archive-account"
              checked={archiveAccount}
              onCheckedChange={setArchiveAccount}
            />
            <Label htmlFor="archive-account" className="text-sm leading-snug">
              Also archive user account (disables login)
              <span className="block text-xs text-muted-foreground">
                {member.name} has no other active board memberships
              </span>
            </Label>
          </div>
        )}

        {hasOtherMemberships && member.user_account_id && (
          <p className="text-xs text-muted-foreground px-1">
            {member.name} has {otherActiveMemberships} other active board membership
            {otherActiveMemberships !== 1 ? "s" : ""}. Their user account will remain active.
          </p>
        )}

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isArchiving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              archiveMemberMutation.mutate({
                boardMemberId: member.id,
                archiveAccount: willArchiveAccount,
              })
            }
            disabled={isArchiving}
          >
            {isArchiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Archive Member
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
