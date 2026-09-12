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
 * server-side (`assertCanInsertPerson`/`assertCanInsertUserAccount`). Phase E
 * wave 4, Task 0 closes the `invitation` write too, onto `trpc.invitation.insert`
 * (new: no `invitation` router or rule existed before this task — see that
 * router's own header for the two FK checks and why its guard reuses
 * `assertCanInsertUserAccount` rather than inventing a new rule). The token is
 * now `gen_random_uuid()`, generated IN THE DATABASE — this dialog no longer
 * mints its own with `crypto.randomUUID()` in the browser.
 *
 * Phase E, wave 6, Task 5 closes the READ this file's header never mentioned:
 * a live `person` email-uniqueness check behind `useSupabase()`, with no
 * `TODO(phase-e-wave-*)` marker, in a file whose own comments narrated every
 * WRITE as migrated. It is `trpc.person.emailExists` now — the procedure that
 * was `boardMember.personEmailExists` until this task moved it to the router
 * whose noun it reads (conventions item 1); see its doc comment.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Loader2, ChevronLeft, IdCard, UserCog } from "lucide-react";
import { useWizardForm } from "@/hooks/useWizardForm";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, errorMessage } from "@/lib/trpc";
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
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<"choose" | "staff">("choose");
  const personForm = useWizardForm(NewPersonSchema, INITIAL_PERSON);

  const email = personForm.values.email.toLowerCase().trim();
  // No `excludePersonId`: this form creates a brand-new person, so there is no
  // id to exclude (that argument is `EditPersonDialog`'s). The `town_id`
  // filter the raw query carried is gone because `ctx.withTenant` IS that
  // filter — the same predicate, moved from a value the browser supplied to
  // one the session establishes.
  const { data: emailExists = false } = useQuery({
    ...trpc.person.emailExists.queryOptions({ email }),
    enabled: !!townId && !!email && email.includes("@"),
  });

  function reset() {
    setStep(1);
    setMode("choose");
    personForm.setValues(INITIAL_PERSON);
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
  const insertInvitation = useMutation(trpc.invitation.insert.mutationOptions());

  const createStaff = useMutation({
    mutationFn: async (staffResult: StaffAccountResult) => {
      const person = await insertPerson.mutateAsync({
        name: personForm.values.name.trim(),
        email,
      });
      const account = await insertStaffAccount.mutateAsync({
        personId: person.id,
        govTitle: staffResult.gov_title || null,
        permissions: staffResult.permissions,
      });

      const invitation = await insertInvitation.mutateAsync({
        personId: person.id,
        userAccountId: account.id,
      });

      // Best-effort invitation email (non-blocking; admin can resend from a board roster).
      void apiFetch(`/api/invitations/${invitation.id}/send`, { method: "POST" }).catch(() => {
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
