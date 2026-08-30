import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import type { AgendaTemplateSection } from "@town-meeting/shared/types";
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

interface CreateTemplateDialogProps {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Minimal fixed sections for a new blank template. */
const INITIAL_SECTIONS: AgendaTemplateSection[] = [
  {
    title: "Call to Order",
    sort_order: 0,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
  {
    title: "Adjournment",
    sort_order: 1,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
];

/**
 * `CreateTemplateDialog`'s write — was a raw, tenancy-only Supabase insert
 * carrying a client-supplied `board_id` AND `town_id` while its sibling
 * `agendaTemplate.insert` (wired for `handleClone` in
 * `boards.$boardId.templates.tsx` since Task 2) was already admin-gated
 * (`assertCanInsertAgendaTemplate`). That procedure's own doc comment always
 * named this dialog as a co-consumer — "`CreateTemplateDialog`'s write ...
 * and `handleClone` ... both become this one procedure" — but only
 * `handleClone` was ever actually wired. Found in this wave's whole-branch
 * review: the "Create Template" button on `/boards/:boardId/templates` was
 * the one live path in the product that could still create a template as a
 * non-admin, and the deployed schema (`0000_baseline.sql`'s
 * `agenda_template_tenant_isolation`) has no `is_admin()` predicate to catch
 * it — only the legacy `supabase/migrations/` corpus does, and that is not
 * what this app's Postgres runs. Wired here, same procedure, same shape as
 * `DeleteTemplateDialog.tsx`'s `trpc.agendaTemplate.delete` call.
 *
 * `town_id` is no longer sent from the client at all: `agendaTemplate.insert`
 * takes it from `ctx.tenant.townId` server-side, the same way `handleClone`
 * already does — so this dialog no longer needs a `townId` prop.
 *
 * The legacy `queryKeys.agendaTemplates.byBoard` invalidation stays alongside
 * `trpc.agendaTemplate.pathFilter()`: `CreateMeetingDialog.tsx`'s
 * board-scoped template picker and `routes/templates.tsx` still read that
 * table through raw Supabase and have not moved onto the tRPC key yet
 * (conventions item 7 — "goes when the last legacy reader does, not before").
 */
export function CreateTemplateDialog({ boardId, open, onOpenChange }: CreateTemplateDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { mutate: createTemplate, isPending } = useMutation({
    ...trpc.agendaTemplate.insert.mutationOptions(),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaTemplates.byBoard(boardId) });
      // See `DeleteTemplateDialog.tsx`'s identical line: `boards.$boardId.templates.tsx`'s
      // list read moved onto `trpc.agendaTemplate.list` (wave 2, Task 2), so
      // a template created here was missing from that list on back-navigation
      // for up to the 60s `staleTime` without this call.
      void queryClient.invalidateQueries(trpc.agendaTemplate.pathFilter());
      setError(null);
      onOpenChange(false);
      setName("");
      void navigate(`/boards/${boardId}/templates/${id}/edit`);
    },
    onError: (err) => {
      // `agendaTemplate.insert` is admin-gated, where the Supabase insert
      // this replaces was tenancy-only (see this file's own header) — a
      // non-admin clicking "Create Template" can now genuinely be refused,
      // which the previous raw insert could not express, and a silent
      // failure here is the exact thing conventions item 5 exists to end.
      setError(
        isTRPCClientError(err) && err.data?.code === "FORBIDDEN"
          ? "Ask a town administrator to create a new template."
          : "Something went wrong. Please try again.",
      );
    },
  });

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    createTemplate({ boardId, name: trimmed, sections: INITIAL_SECTIONS, isDefault: false });
  }, [name, boardId, createTemplate]);

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) {
          setName("");
          setError(null);
        }
        onOpenChange(val);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Template</DialogTitle>
          <DialogDescription>Enter a name for the new agenda template.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="template-name">Template name</Label>
          <Input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Regular Meeting Agenda"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={name.trim().length < 2 || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
