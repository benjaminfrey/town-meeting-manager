/**
 * RoleConflictDialog — alerts the admin when a staff/board_member
 * mutual exclusivity conflict is detected.
 *
 * Per Maine conflict-of-interest law (30-A M.R.S.A. §2605), a person
 * cannot simultaneously serve as staff and a board member.
 *
 * Phase E, wave 2, Task 4 — the one write here (`archiveAccount`) moved onto
 * `person.archiveUserAccount`. This file's own single `.from("user_account")`
 * call matched the master plan's "measured scope" table exactly (1 site, 1
 * write) — a task dispatch describing this file as having "4 data-access
 * references" to check before assuming it needed migrating was counting
 * lines (`import`, the hook call, and the two-line statement itself), not
 * distinct operations; there was exactly one write. See this task's report.
 *
 * No cache invalidation existed here before this task — this component held
 * no `QueryClient` reference at all. Archiving the account changes what
 * `person.list` and `boardMember.roster` both report for this person
 * (`person.list`'s join drops an archived account's role entirely;
 * `boardMember.roster` selects `user_account_archived_at` unconditionally),
 * so both are invalidated below, per conventions item 7.
 *
 * Review round: added `onError` — this dialog had none before, and a refused
 * write (e.g. a stale `userAccountId` answering NOT_FOUND) left the button
 * re-enabled with no explanation, conventions item 5's exact failure mode.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { RoleConflictResult } from "@town-meeting/shared";
import { ROLE_LABELS } from "@town-meeting/shared";

/**
 * The message a CONFLICT carries; a generic one otherwise. Same gate
 * `AddPersonDialog.tsx`/`AddMemberDialog.tsx` already use. `archiveUserAccount`
 * does not throw CONFLICT today (its own refusals are FORBIDDEN/NOT_FOUND),
 * but the gate costs nothing to carry and matches every sibling in this file
 * family, rather than being a fourth, slightly different shape.
 */
function errorMessage(err: unknown, fallback: string): string {
  return isTRPCClientError(err) && err.data?.code === "CONFLICT" ? err.message : fallback;
}

interface RoleConflictDialogProps {
  personName: string;
  conflict: RoleConflictResult;
  userAccountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}

export function RoleConflictDialog({
  personName,
  conflict,
  userAccountId,
  open,
  onOpenChange,
  onResolved,
}: RoleConflictDialogProps) {
  const queryClient = useQueryClient();

  const existingLabel = conflict.existingRole
    ? (ROLE_LABELS[conflict.existingRole]?.toLowerCase() ?? conflict.existingRole)
    : "current";

  const archiveAccountMutation = useMutation(
    trpc.person.archiveUserAccount.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.person.pathFilter());
        void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
        onResolved();
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Couldn't archive this account — please try again."));
      },
    }),
  );
  const isArchiving = archiveAccountMutation.isPending;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Role Conflict — Staff and Board Member
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                <strong>{personName}</strong> currently has a {existingLabel} account. Under Maine
                conflict-of-interest law (30-A M.R.S.A. §2605), a person cannot simultaneously serve
                as staff and a board member.
              </p>
              <p>
                To proceed, their {existingLabel} account must be archived first. This will disable
                their current access but preserve all historical records.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isArchiving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => archiveAccountMutation.mutate({ userAccountId })}
            disabled={isArchiving}
          >
            {isArchiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Archive {existingLabel} Account & Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
