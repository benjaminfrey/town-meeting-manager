/**
 * CreateMeetingDialog — dialog for creating a new meeting.
 *
 * Validates prerequisites (member count, retention policy),
 * creates the meeting record, instantiates agenda from template,
 * and navigates to the agenda builder.
 */

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { z } from "zod";
import { AlertCircle, Info, Loader2 } from "lucide-react";
import {
  validateMeetingCreation,
  forecastEarliestMeetingDate,
  type MeetingType,
} from "@town-meeting/shared";
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
  meeting_type: z.enum(["regular", "special", "annual_town_meeting", "special_town_meeting", "public_hearing", "workshop", "emergency"]),
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
  const supabase = useSupabase();
  const queryClient = useQueryClient();
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
  const { data: activeMemberCount = 0 } = useQuery({
    queryKey: [...queryKeys.members.byBoard(boardId), 'activeCount'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('board_member')
        .select('*', { count: 'exact', head: true })
        .eq('board_id', boardId)
        .eq('status', 'active');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!boardId,
  });

  const { data: townData } = useQuery({
    queryKey: queryKeys.towns.detail(townId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('town')
        .select('retention_policy_acknowledged_at, state')
        .eq('id', townId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!townId,
  });

  const { data: templates = [] } = useQuery({
    queryKey: queryKeys.agendaTemplates.byBoard(boardId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agenda_template')
        .select('id, name, is_default, sections')
        .eq('board_id', boardId)
        .order('is_default', { ascending: false })
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!boardId,
  });

  const retentionAck = townData?.retention_policy_acknowledged_at ?? null;
  const townState = String((townData as Record<string, unknown> | undefined)?.state ?? "ME");

  // Compliance forecast — show when meeting type has special notice requirements
  const forecast = useMemo(() => {
    if (!values.meeting_type || values.meeting_type === "regular") return null;
    return forecastEarliestMeetingDate({
      fromDate: new Date(),
      state: townState,
      meetingType: values.meeting_type as MeetingType,
    });
  }, [values.meeting_type, townState]);

  // Auto-select default template
  if (values.template_id === "" && templates.length > 0) {
    const defaultTpl = templates.find((t) => t.is_default) ?? templates[0];
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

      const { error } = await supabase.from('meeting').insert({
        id,
        board_id: boardId,
        town_id: townId,
        title: data.title,
        meeting_type: data.meeting_type,
        scheduled_date: data.scheduled_date,
        scheduled_time: data.scheduled_time,
        location: data.location || null,
        status: 'draft',
        agenda_status: 'draft',
        formality_override: null,
        created_by: currentUser?.id ?? '',
        created_at: now,
        updated_at: now,
      });
      if (error) throw error;

      // Instantiate agenda from selected template
      const selectedTemplate = templates.find(
        (t) => String(t.id) === data.template_id,
      );
      if (selectedTemplate?.sections) {
        const sections = parseSections(
          selectedTemplate.sections as string,
        ) as AgendaTemplateSection[];
        await instantiateAgendaFromTemplate(
          id,
          boardId,
          townId,
          sections,
        );
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.meetings.byBoard(boardId) });
      onOpenChange(false);
      void navigate(`/meetings/${id}/agenda`);
    } finally {
      setIsSaving(false);
    }
  }, [
    validate,
    prereqValidation.valid,
    supabase,
    queryClient,
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

          {/* Compliance forecast callout */}
          {forecast?.rule && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {forecast.explanation}
                </p>
              </div>
            </div>
          )}

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
                    const isDefault = t.is_default;
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
