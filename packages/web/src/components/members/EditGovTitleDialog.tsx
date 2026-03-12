/**
 * EditGovTitleDialog — small dialog for editing a member's government title.
 *
 * Government title is stored on user_accounts.gov_title. It is a
 * display label only and has no effect on permissions (per advisory 1.2).
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { Loader2, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EditGovTitleDialogProps {
  member: {
    name: string;
    user_account_id: string | null;
    gov_title: string | null;
    person_id?: string;
  };
  boardId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditGovTitleDialog({
  member,
  boardId,
  open,
  onOpenChange,
}: EditGovTitleDialogProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(member.gov_title ?? "");

  const { mutate: saveTitle, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      if (!member.user_account_id) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('user_account')
        .update({ gov_title: title.trim() || null, updated_at: now })
        .eq('id', member.user_account_id);
      if (error) throw error;
    },
    onSuccess: () => {
      if (boardId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      }
      if (member.person_id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.userAccounts.byPerson(member.person_id) });
      }
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Government Title</DialogTitle>
          <DialogDescription>{member.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Government title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Chair, Vice Chair, 1st Selectman"
              maxLength={100}
            />
          </div>
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Government title is for display purposes only. Permissions are
              controlled separately.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={() => saveTitle()} disabled={isSaving || !member.user_account_id}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
