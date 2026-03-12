/**
 * MemberArchiveDialog — confirms archival of a board member.
 *
 * Archives the board_members entry (status='archived', term_end=today).
 * If the person has no other active board memberships, optionally
 * archives the user_account.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
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
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemberArchiveDialog({
  member,
  boardId,
  townId: _townId,
  open,
  onOpenChange,
}: MemberArchiveDialogProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [archiveAccount, setArchiveAccount] = useState(false);

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
  const hasOtherMemberships = otherActiveMemberships > 0;

  const { mutate: archiveMember, isPending: isArchiving } = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const now = new Date().toISOString();

      // Archive board membership
      const { error: bmError } = await supabase
        .from('board_member')
        .update({ status: 'archived', term_end: today })
        .eq('id', member.id);
      if (bmError) throw bmError;

      // Optionally archive user account
      if (archiveAccount && member.user_account_id && !hasOtherMemberships) {
        const { error: uaError } = await supabase
          .from('user_account')
          .update({ archived_at: now })
          .eq('id', member.user_account_id);
        if (uaError) throw uaError;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      if (archiveAccount && member.user_account_id && !hasOtherMemberships) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.userAccounts.byTown(_townId) });
      }
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive Board Member</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Are you sure you want to archive{" "}
                <strong>{member.name}</strong>'s membership on this board?
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Board membership will be archived and term end set to today</li>
                <li>Name and government title retained indefinitely (public record per Maine law)</li>
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
            {member.name} has {otherActiveMemberships} other active board
            membership{otherActiveMemberships !== 1 ? "s" : ""}. Their user
            account will remain active.
          </p>
        )}

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
            onClick={() => archiveMember()}
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
