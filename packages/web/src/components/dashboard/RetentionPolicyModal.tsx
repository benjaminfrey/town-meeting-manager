/**
 * RetentionPolicyModal — acknowledgment dialog for data retention policy.
 *
 * Required before the town can hold its first meeting. Cannot be dismissed
 * without acknowledging. Writes timestamp to the TOWN record.
 *
 * @see docs/advisory-resolutions/1.2 — Data retention rules
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";

interface RetentionPolicyModalProps {
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RetentionPolicyModal({
  townId,
  open,
  onOpenChange,
}: RetentionPolicyModalProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("town")
        .update({ retention_policy_acknowledged_at: now, updated_at: now })
        .eq("id", townId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Data Retention Policy</DialogTitle>
          <DialogDescription>
            Please review and acknowledge the data retention policy before
            holding your first meeting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 text-sm">
          <div className="space-y-2">
            <h4 className="font-medium">Retained Indefinitely (Public Record)</h4>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>
                Name and government title of all board members and officials
              </li>
              <li>
                Vote records, motions, and meeting attendance
              </li>
              <li>
                Approved minutes and public documents
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Scrubbed After Departure</h4>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>
                Email addresses and phone numbers are removed 1 year after
                a member's departure from service (configurable)
              </li>
              <li>
                Personal contact information is not part of the public record
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Deleted Immediately on Archival</h4>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>
                Login credentials and authentication tokens
              </li>
              <li>
                Session data and browser fingerprints
              </li>
            </ul>
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            This policy complies with Maine's Freedom of Access Act (FOAA)
            requirements for public records. Government meeting records are
            public by law and must be retained. Personal contact information
            is treated as private and is removed when no longer needed for
            official communication.
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            I acknowledge this retention policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
