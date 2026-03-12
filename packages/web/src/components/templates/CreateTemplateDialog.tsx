import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
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
  townId: string;
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

export function CreateTemplateDialog({
  boardId,
  townId,
  open,
  onOpenChange,
}: CreateTemplateDialogProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const { mutate: createTemplate, isPending } = useMutation({
    mutationFn: async (trimmed: string) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await supabase.from('agenda_template').insert({
        id,
        board_id: boardId,
        town_id: townId,
        name: trimmed,
        is_default: false,
        sections: INITIAL_SECTIONS,
        created_at: now,
        updated_at: now,
      });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaTemplates.byBoard(boardId) });
      onOpenChange(false);
      setName("");
      void navigate(`/boards/${boardId}/templates/${id}/edit`);
    },
  });

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    createTemplate(trimmed);
  }, [name, createTemplate]);

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) setName("");
        onOpenChange(val);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Template</DialogTitle>
          <DialogDescription>
            Enter a name for the new agenda template.
          </DialogDescription>
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

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={name.trim().length < 2 || isPending}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
