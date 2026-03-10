import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { usePowerSync } from "@powersync/react";
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
  const powerSync = usePowerSync();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;

    setIsSaving(true);
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await powerSync.execute(
        `INSERT INTO agenda_templates (id, board_id, town_id, name, is_default, sections, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, boardId, townId, trimmed, 0, JSON.stringify(INITIAL_SECTIONS), now, now],
      );

      onOpenChange(false);
      setName("");
      void navigate(`/boards/${boardId}/templates/${id}/edit`);
    } finally {
      setIsSaving(false);
    }
  }, [name, powerSync, boardId, townId, onOpenChange, navigate]);

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
              if (e.key === "Enter") void handleCreate();
            }}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={name.trim().length < 2 || isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
