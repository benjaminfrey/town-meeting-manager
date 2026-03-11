/**
 * CreateMeetingDialog — dialog for creating a new meeting.
 *
 * Validates prerequisites (member count, retention policy),
 * creates the meeting record, instantiates agenda from template,
 * and navigates to the agenda builder.
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { usePowerSync, useQuery } from "@powersync/react";
import { z } from "zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { validateMeetingCreation } from "@town-meeting/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWizardForm } from "@/hooks/useWizardForm";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { parseSections } from "@/lib/agenda-template-helpers";
import { instantiateAgendaFromTemplate } from "@/lib/meeting-helpers";
import { MEETING_TYPE_LABELS } from "./meeting-labels";

// ─── Schema ──────────────────────────────────────────────────────────

const CreateMeetingFormSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(200),
  meeting_type: z.enum(["regular", "special", "public_hearing", "emergency"]),
  scheduled_date: z.string().min(1, "Date is required"),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  location: z.string().max(200),
  template_id: z.string(),
});

type CreateMeetingFormData = z.infer<typeof CreateMeetingFormSchema>;

// ─── Component ───────────────────────────────────────────────────────

interface CreateMeetingDialogProps {
  boardId: string;
  boardName: string;
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMeetingDialog({
  boardId,
  boardName,
  townId,
  open,
  onOpenChange,
}: CreateMeetingDialogProps) {
  const powerSync = usePowerSync();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [isSaving, setIsSaving] = useState(false);

  // Default title suggestion
  const today = new Date();
  const defaultTitle = `${boardName} — ${today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const defaultDate = today.toISOString().slice(0, 10);

  const initial: CreateMeetingFormData = {
    title: defaultTitle,
    meeting_type: "regular",
    scheduled_date: defaultDate,
    scheduled_time: "18:00",
    location: "",
    template_id: "",
  };

  const { values, errors, isValid, setValue, handleBlur, validate } =
    useWizardForm(CreateMeetingFormSchema, initial);

  // ─── Queries for validation & templates ─────────────────────────────
  const { data: memberCountRows } = useQuery(
    "SELECT COUNT(*) as count FROM board_members WHERE board_id = ? AND status = 'active'",
    [boardId],
  );
  const { data: townRows } = useQuery(
    "SELECT retention_policy_acknowledged_at FROM towns WHERE id = ? LIMIT 1",
    [townId],
  );
  const { data: templateRows } = useQuery(
    "SELECT id, name, is_default, sections FROM agenda_templates WHERE board_id = ? ORDER BY is_default DESC, name ASC",
    [boardId],
  );

  const activeMemberCount = Number(
    (memberCountRows?.[0] as Record<string, unknown>)?.count ?? 0,
  );
  const retentionAck =
    (townRows?.[0] as Record<string, unknown>)
      ?.retention_policy_acknowledged_at as string | null ?? null;
  const templates = (templateRows ?? []) as Record<string, unknown>[];

  // Auto-select default template
  if (values.template_id === "" && templates.length > 0) {
    const defaultTpl = templates.find((t) => t.is_default === 1) ?? templates[0];
    if (defaultTpl) {
      setValue("template_id", String(defaultTpl.id));
    }
  }

  // Pre-submit validation
  const prereqValidation = validateMeetingCreation(
    activeMemberCount,
    retentionAck,
    boardId,
  );

  const handleSave = useCallback(async () => {
    const data = validate();
    if (!data) return;

    setIsSaving(true);
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await powerSync.execute(
        `INSERT INTO meetings (id, board_id, town_id, title, meeting_type, scheduled_date, scheduled_time, location, status, agenda_status, formality_override, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          boardId,
          townId,
          data.title,
          data.meeting_type,
          data.scheduled_date,
          data.scheduled_time,
          data.location,
          "draft",
          "draft",
          null,
          currentUser?.id ?? "",
          now,
          now,
        ],
      );

      // Instantiate agenda from selected template
      const selectedTemplate = templates.find(
        (t) => String(t.id) === data.template_id,
      );
      if (selectedTemplate?.sections) {
        const sections = parseSections(
          selectedTemplate.sections as string,
        ) as AgendaTemplateSection[];
        await instantiateAgendaFromTemplate(
          powerSync,
          id,
          boardId,
          townId,
          sections,
        );
      }

      onOpenChange(false);
      void navigate(`/meetings/${id}/agenda`);
    } finally {
      setIsSaving(false);
    }
  }, [
    validate,
    prereqValidation.valid,
    powerSync,
    boardId,
    townId,
    currentUser,
    templates,
    onOpenChange,
    navigate,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Meeting</DialogTitle>
          <DialogDescription>
            Schedule a new meeting for {boardName}.
          </DialogDescription>
        </DialogHeader>

        {/* Prerequisite errors */}
        {!prereqValidation.valid && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-2">
            {prereqValidation.errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-destructive">{err.message}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-5 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={values.title}
              onChange={(e) => setValue("title", e.target.value)}
              onBlur={() => handleBlur("title")}
              placeholder="Meeting title"
            />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title}</p>
            )}
          </div>

          {/* Meeting Type */}
          <div className="space-y-1.5">
            <Label>Meeting type</Label>
            <Select
              value={values.meeting_type}
              onValueChange={(val) =>
                setValue(
                  "meeting_type",
                  val as CreateMeetingFormData["meeting_type"],
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MEETING_TYPE_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={values.scheduled_date}
                onChange={(e) => setValue("scheduled_date", e.target.value)}
                onBlur={() => handleBlur("scheduled_date")}
              />
              {errors.scheduled_date && (
                <p className="text-xs text-destructive">
                  {errors.scheduled_date}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input
                type="time"
                value={values.scheduled_time}
                onChange={(e) => setValue("scheduled_time", e.target.value)}
                onBlur={() => handleBlur("scheduled_time")}
              />
              {errors.scheduled_time && (
                <p className="text-xs text-destructive">
                  {errors.scheduled_time}
                </p>
              )}
            </div>
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input
              value={values.location}
              onChange={(e) => setValue("location", e.target.value)}
              onBlur={() => handleBlur("location")}
              placeholder="e.g. Town Hall, Room 201"
            />
            {errors.location && (
              <p className="text-xs text-destructive">{errors.location}</p>
            )}
          </div>

          {/* Template select */}
          <div className="space-y-1.5">
            <Label>Agenda template</Label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No templates found. Create a template first.
              </p>
            ) : (
              <Select
                value={values.template_id}
                onValueChange={(val) => setValue("template_id", val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => {
                    const id = String(t.id);
                    const name = String(t.name ?? "");
                    const isDefault = t.is_default === 1;
                    return (
                      <SelectItem key={id} value={id}>
                        {name}
                        {isDefault ? " (default)" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
            {errors.template_id && (
              <p className="text-xs text-destructive">{errors.template_id}</p>
            )}
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
          <Button
            onClick={() => void handleSave()}
            disabled={!isValid || isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
