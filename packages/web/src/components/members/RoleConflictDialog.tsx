/**
 * RoleConflictDialog — alerts the admin when a staff/board_member
 * mutual exclusivity conflict is detected.
 *
 * Per Maine conflict-of-interest law (30-A M.R.S.A. §2605), a person
 * cannot simultaneously serve as staff and a board member.
 */

import { useMutation } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
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
  const supabase = useSupabase();

  const existingLabel = conflict.existingRole
    ? ROLE_LABELS[conflict.existingRole]?.toLowerCase() ?? conflict.existingRole
    : "current";

  const { mutate: archiveAccount, isPending: isArchiving } = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('user_account')
        .update({ archived_at: now })
        .eq('id', userAccountId);
      if (error) throw error;
    },
    onSuccess: () => {
      onResolved();
      onOpenChange(false);
    },
  });

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
                <strong>{personName}</strong> currently has a {existingLabel}{" "}
                account. Under Maine conflict-of-interest law (30-A M.R.S.A.
                §2605), a person cannot simultaneously serve as staff and a
                board member.
              </p>
              <p>
                To proceed, their {existingLabel} account must be archived
                first. This will disable their current access but preserve all
                historical records.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isArchiving}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => archiveAccount()}
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
