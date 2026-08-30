/**
 * SetPortalAddressModal — set or change the town's public portal address.
 *
 * Stage 1, Phase E, wave 1, Task 5 — the first UI caller of
 * `town.setPortalAddress`. That mutation has existed since Phase D (D1b);
 * `ProgressChecklist` has shown "Set public portal subdomain" as an
 * outstanding onboarding step for just as long, but nothing ever completed
 * it — `packages/web/src/lib/trpc.ts` did not exist yet when D1b shipped.
 * It does now, so this is that wiring.
 *
 * Opened from `ProgressChecklist`'s "portal-subdomain" row via
 * `onSetPortalAddressClick`, the same delegation shape
 * `onRetentionPolicyClick` already used for that component's retention-
 * policy row: `ProgressChecklist` owns no dialog state of its own, only a
 * callback; the screen that renders it (`settings.town.tsx` today) owns the
 * `open`/`onOpenChange` state and mounts this component, matching
 * `RetentionPolicyModal`'s own shape exactly.
 *
 * `checkSubdomain` runs client-side before the mutation fires, as a courtesy
 * that saves a round trip for the common typo (a space, a dot, a reserved
 * name) — not the enforcement. `town.setPortalAddress` re-validates with the
 * SAME function server-side and is the actual authority (see that
 * procedure's own doc comment): the uniqueness check in particular has no
 * client-side equivalent — it is the database's `town_subdomain_key`
 * constraint, not a read-then-write, because a read-then-write would race
 * any concurrent onboarding — so a CONFLICT can only ever come back from the
 * mutation itself, never from the local check below.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { checkSubdomain } from "@town-meeting/shared";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";

interface SetPortalAddressModalProps {
  townId: string;
  currentSubdomain: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SetPortalAddressModal({
  townId,
  currentSubdomain,
  open,
  onOpenChange,
}: SetPortalAddressModalProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(currentSubdomain ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation(
    trpc.town.setPortalAddress.mutationOptions({
      onSuccess: () => {
        // Both invalidations run during the transition (conventions item 7):
        // `queryKeys.towns.detail(townId)` is still read directly by several
        // unmigrated screens (`boards.tsx`, `boards.$boardId.tsx`,
        // `meetings.$meetingId.{agenda,review,minutes}.tsx`,
        // `CreateMeetingDialog`) — see `TownSettingsEditor.tsx`'s header for
        // the current list — and `trpc.town.pathFilter()` is this screen's
        // own `town.detail` read.
        void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
        void queryClient.invalidateQueries(trpc.town.pathFilter());
        onOpenChange(false);
      },
    }),
  );

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Reset to the town's current value (not whatever was left over from a
      // previous open-then-cancel), and clear any stale error state.
      setValue(currentSubdomain ?? "");
      setLocalError(null);
      mutation.reset();
    }
    onOpenChange(next);
  };

  const handleSave = () => {
    const checked = checkSubdomain(value);
    if (!checked.ok) {
      setLocalError(checked.message);
      return;
    }
    setLocalError(null);
    mutation.mutate({ subdomain: checked.subdomain });
  };

  const serverErrorMessage = mutation.isError
    ? isTRPCClientError(mutation.error)
      ? mutation.error.message
      : "Couldn't save the portal address — please try again."
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set your public portal address</DialogTitle>
          <DialogDescription>
            This is the web address residents use to view your town's public meeting portal. Portal
            addresses are shared across every town on this system, so it has to be unique.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="portal-subdomain">Portal address</Label>
          <div className="flex items-center gap-1.5 text-sm">
            <Input
              id="portal-subdomain"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setLocalError(null);
              }}
              placeholder="newcastle"
              autoFocus
            />
            <span className="whitespace-nowrap text-muted-foreground">.townmeetingmanager.com</span>
          </div>
          {(localError ?? serverErrorMessage) && (
            <p className="text-xs text-destructive">{localError ?? serverErrorMessage}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={mutation.isPending || value.trim().length === 0}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
