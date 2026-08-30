/**
 * AddPersonDialog — town-level "Add person", decoupled from any board.
 *
 * Step 1: create the PERSON (name + email).
 * Step 2: choose "Directory only" (a person with no login/board — the new
 *   town-level capability) or "Staff account" (reuses StaffAccountFlow to create
 *   a user_account + invitation). Board assignment stays on Board → Members,
 *   where this person now appears in the "Add Member" picker.
 *
 * Phase E, wave 1, Task 3 — the person and user_account writes are
 * `trpc.person.insert`/`trpc.person.insertStaffAccount` now, both admin-gated
 * server-side (`assertCanInsertPerson`/`assertCanInsertUserAccount`). The
 * `invitation` write stays on Supabase:
 * TODO(phase-e-wave-2): invitation.insert — no `invitation` router/rule
 * exists yet, so this is a genuine partial migration, not an oversight.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { z } from "zod";
import { Loader2, ChevronLeft, IdCard, UserCog } from "lucide-react";
import { useSupabase } from "@/hooks/useSupabase";
import { useWizardForm } from "@/hooks/useWizardForm";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import { apiFetch } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { StaffAccountFlow, type StaffAccountResult } from "./StaffAccountFlow";

const NewPersonSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Must be a valid email"),
});
const INITIAL_PERSON = { name: "", email: "" };

interface AddPersonDialogProps {
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddPersonDialog({ townId, open, onOpenChange }: AddPersonDialogProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<"choose" | "staff">("choose");
  const personForm = useWizardForm(NewPersonSchema, INITIAL_PERSON);

  const email = personForm.values.email.toLowerCase().trim();
  const { data: emailRows = [] } = useQuery({
    queryKey: [...queryKeys.persons.byTown(townId), "emailCheck", email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("person")
        .select("id")
        .eq("town_id", townId)
        .eq("email", email)
        .limit(1);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!townId && !!email && email.includes("@"),
  });
  const emailExists = emailRows.length > 0;

  function reset() {
    setStep(1);
    setMode("choose");
    personForm.setValues(INITIAL_PERSON);
  }

  /** The message a CONFLICT ("email already in use") carries; a generic one otherwise. */
  function errorMessage(err: unknown, fallback: string): string {
    return isTRPCClientError(err) && err.data?.code === "CONFLICT" ? err.message : fallback;
  }

  const insertPerson = useMutation(trpc.person.insert.mutationOptions());

  const createDirectory = useMutation({
    mutationFn: async () => {
      const person = await insertPerson.mutateAsync({
        name: personForm.values.name.trim(),
        email,
      });
      return person.name;
    },
    onSuccess: (name) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.persons.byTown(townId),
      });
      void queryClient.invalidateQueries(trpc.person.pathFilter());
      toast.success(`${name} added`);
      reset();
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't add the person — please try again.")),
  });

  const insertStaffAccount = useMutation(trpc.person.insertStaffAccount.mutationOptions());

  const createStaff = useMutation({
    mutationFn: async (staffResult: StaffAccountResult) => {
      const now = new Date().toISOString();
      const person = await insertPerson.mutateAsync({
        name: personForm.values.name.trim(),
        email,
      });
      const account = await insertStaffAccount.mutateAsync({
        personId: person.id,
        govTitle: staffResult.gov_title || null,
        permissions: staffResult.permissions,
      });

      // TODO(phase-e-wave-2): invitation.insert — no `invitation` router or
      // authorization rule exists yet. Kept on Supabase; see this file's
      // header.
      const invId = crypto.randomUUID();
      const { error: invErr } = await supabase.from("invitation").insert({
        id: invId,
        person_id: person.id,
        user_account_id: account.id,
        town_id: townId,
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: "pending",
        created_at: now,
      });
      if (invErr) throw invErr;

      // Best-effort invitation email (non-blocking; admin can resend from a board roster).
      void apiFetch(`/api/invitations/${invId}/send`, { method: "POST" }).catch(() => {
        /* non-critical — an admin can resend from a board roster */
      });

      return person.name;
    },
    onSuccess: (name) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.persons.byTown(townId),
      });
      // `queryKeys.userAccounts.byTown` invalidation removed (Phase E, wave
      // 2, Task 3 fix round): Task 3 moved `MemberRoster.tsx`/
      // `AddMemberDialog.tsx`'s reads off that key onto `boardMember.roster`/
      // `.searchCandidates`, which were its last two readers — nothing in
      // the app reads `queryKeys.userAccounts.byTown` any more
      // (`grep -rn "queryKeys\.userAccounts\.byTown" packages/web/src`),
      // so invalidating it here was dead. Per conventions item 7, "the
      // legacy line stays because other, unmigrated screens still read that
      // key. It goes when the last legacy reader does" — it just did.
      void queryClient.invalidateQueries(trpc.person.pathFilter());
      toast.success(`${name} added as staff — invitation sent`);
      reset();
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(errorMessage(err, "Couldn't create the staff account — please try again.")),
  });

  const saving = createDirectory.isPending || createStaff.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add person</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Add someone to your town. You can assign them to boards afterward from each board's Members tab."
              : "Choose how to set them up — board assignment happens on the board side."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={personForm.values.name}
                onChange={(e) => personForm.setValue("name", e.target.value)}
                onBlur={() => personForm.handleBlur("name")}
                placeholder="Full name"
              />
              {personForm.errors.name && (
                <p className="text-xs text-destructive">{personForm.errors.name}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={personForm.values.email}
                onChange={(e) => personForm.setValue("email", e.target.value)}
                onBlur={() => personForm.handleBlur("email")}
                placeholder="email@example.com"
              />
              {personForm.errors.email && (
                <p className="text-xs text-destructive">{personForm.errors.email}</p>
              )}
              {emailExists && (
                <p className="text-xs text-destructive">
                  A person with this email already exists in your town.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setStep(2)} disabled={!personForm.isValid || emailExists}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-sm font-medium">{personForm.values.name}</div>
              <div className="text-xs text-muted-foreground">{email}</div>
            </div>

            {mode === "choose" && (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => createDirectory.mutate()}
                    disabled={saving}
                    className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <IdCard className="h-4 w-4" />
                      Directory only
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Just the person. Assign to boards later; no login.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("staff")}
                    disabled={saving}
                    className="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <UserCog className="h-4 w-4" />
                      Staff account
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Give them a login with a permission template + invite.
                    </span>
                  </button>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setStep(1)} disabled={saving}>
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                    Back
                  </Button>
                  {createDirectory.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin self-center" />
                  )}
                </DialogFooter>
              </>
            )}

            {mode === "staff" && (
              <StaffAccountFlow
                townId={townId}
                onComplete={(result) => createStaff.mutate(result)}
                onBack={() => setMode("choose")}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
