/**
 * EditPersonDialog — edit a person's name + email (town-level identity).
 *
 * Fills a gap: there was no name/email edit UI before (only EditGovTitleDialog
 * for the gov_title, which lives on the user_account). Gated to admins (T2);
 * RLS also enforces it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useSupabase } from "@/hooks/useSupabase";
import { useWizardForm } from "@/hooks/useWizardForm";
import { queryKeys } from "@/lib/queryKeys";
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

const EditPersonSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Must be a valid email"),
});

interface EditPersonDialogProps {
  person: { id: string; name: string; email: string };
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditPersonDialog({
  person,
  townId,
  open,
  onOpenChange,
}: EditPersonDialogProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const form = useWizardForm(EditPersonSchema, {
    name: person.name,
    email: person.email,
  });

  const email = form.values.email.toLowerCase().trim();
  const { data: dupRows = [] } = useQuery({
    queryKey: [...queryKeys.persons.byTown(townId), "emailCheck", email, person.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("person")
        .select("id")
        .eq("town_id", townId)
        .eq("email", email)
        .neq("id", person.id)
        .limit(1);
      if (error) throw error;
      return data ?? [];
    },
    enabled:
      !!townId &&
      !!email &&
      email.includes("@") &&
      email !== person.email.toLowerCase(),
  });
  const emailTaken = dupRows.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("person")
        .update({ name: form.values.name.trim(), email })
        .eq("id", person.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.persons.byTown(townId),
      });
      toast.success("Person updated");
      onOpenChange(false);
    },
    onError: () => toast.error("Couldn't update the person — please try again."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit person</DialogTitle>
          <DialogDescription>
            Update this person's name and email.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={form.values.name}
              onChange={(e) => form.setValue("name", e.target.value)}
              onBlur={() => form.handleBlur("name")}
            />
            {form.errors.name && (
              <p className="text-xs text-destructive">{form.errors.name}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.values.email}
              onChange={(e) => form.setValue("email", e.target.value)}
              onBlur={() => form.handleBlur("email")}
            />
            {form.errors.email && (
              <p className="text-xs text-destructive">{form.errors.email}</p>
            )}
            {emailTaken && (
              <p className="text-xs text-destructive">
                Another person already uses this email.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.isValid || emailTaken || save.isPending}
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
