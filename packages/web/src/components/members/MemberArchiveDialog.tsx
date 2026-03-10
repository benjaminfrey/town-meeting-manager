/**
 * MemberArchiveDialog — confirms archival of a board member.
 *
 * Archives the board_members entry (status='archived', term_end=today).
 * If the person has no other active board memberships, optionally
 * archives the user_account.
 */

import { useState } from "react";
import { usePowerSync, useQuery } from "@powersync/react";
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
  townId,
  open,
  onOpenChange,
}: MemberArchiveDialogProps) {
  const powerSync = usePowerSync();
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveAccount, setArchiveAccount] = useState(false);

  // Check for other active board memberships
  const { data: otherBoardRows } = useQuery(
    "SELECT COUNT(*) as count FROM board_members WHERE person_id = ? AND board_id != ? AND status = 'active'",
    [member.person_id, boardId],
  );
  const otherActiveMemberships = Number(
    (otherBoardRows?.[0] as Record<string, unknown>)?.count ?? 0,
  );
  const hasOtherMemberships = otherActiveMemberships > 0;

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const now = new Date().toISOString();

      // Archive board membership
      await powerSync.execute(
        "UPDATE board_members SET status = 'archived', term_end = ? WHERE id = ?",
        [today, member.id],
      );

      // Optionally archive user account
      if (archiveAccount && member.user_account_id && !hasOtherMemberships) {
        await powerSync.execute(
          "UPDATE user_accounts SET archived_at = ? WHERE id = ?",
          [now, member.user_account_id],
        );
      }

      onOpenChange(false);
    } finally {
      setIsArchiving(false);
    }
  };

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
            onClick={() => void handleArchive()}
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
