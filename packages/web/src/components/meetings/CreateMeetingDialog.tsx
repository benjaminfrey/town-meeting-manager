/**
 * CreateMeetingDialog — dialog for creating a new meeting.
 *
 * Validates prerequisites (member count, retention policy),
 * creates the meeting record, instantiates agenda from template,
 * and navigates to the agenda builder.
 *
 * Phase E, wave 3, Task 2 — the meeting-record write moves onto
 * `trpc.meeting.insert` (`packages/api/src/trpc/routers/meeting.ts`, shipped
 * in Task 1) and the template list onto `trpc.agendaTemplate.list`
 * (`agendaTemplate.list` already existed as a plain `protectedProcedure` —
 * no authorization delta versus the raw read this replaces, a completeness
 * gap only; see conventions item 11 and wave 3's Task 0).
 *
 * `meeting.insert` generates and returns the meeting's own `id` — this
 * dialog no longer mints one client-side with `crypto.randomUUID()` before
 * the write. Agenda instantiation (`instantiateAgendaFromTemplate`, a raw
 * Supabase writer) still runs as a separate step after the insert succeeds,
 * exactly as before; that write belongs to whichever router owns
 * `agenda_item` (wave 4's agenda surface), not this one — see `meeting.ts`'s
 * own doc comment on `insert`.
 *
 * Before this task, `insert`'s raw Supabase write could never be refused —
 * there was no authorization check at all, so a caught-and-surfaced error
 * path was unreachable, including from `boards.$boardId.meetings.tsx`'s own
 * ungated "Create Meeting" button (no `usePermission("A1")` check there).
 * Closing the hole made FORBIDDEN a real outcome; without a visible error
 * here, a refused create leaves the dialog open with nothing said.
 *
 * TODO(phase-e-wave-4): this dialog still reads/writes raw Supabase in three
 * places, none a completeness gap this task closed: the active
 * `board_member` count (no exact procedure exists —
 * `boardMember.roster`/`.memberCount` are board-roster and town-wide-total
 * respectively, neither an active-count-for-one-board; a new procedure or a
 * client-side filter over `roster` would be needed), the town
 * retention/state read (`trpc.town.detail` already exists and would be a
 * drop-in replacement — not swapped here to stay within this task's own
 * file-list scope), and `instantiateAgendaFromTemplate`'s `agenda_item`
 * writes (wave 4's own agenda surface, per this file's `insert` doc comment
 * above).
 */

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
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
import { parseSections } from "@/lib/agenda-template-helpers";
import { instantiateAgendaFromTemplate } from "@/lib/meeting-helpers";
import { MEETING_TYPE_LABELS } from "./meeting-labels";

// ─── Schema ──────────────────────────────────────────────────────────

const CreateMeetingFormSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters").max(200),
  meeting_type: z.enum([
    "regular",
    "special",
    "annual_town_meeting",
    "special_town_meeting",
    "public_hearing",
    "workshop",
    "emergency",
  ]),
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
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const { values, errors, isValid, setValue, handleBlur, validate } = useWizardForm(
    CreateMeetingFormSchema,
    initial,
  );

  // ─── Queries for validation & templates ─────────────────────────────
  // TODO(phase-e-wave-4): no exact procedure exists yet — see this file's
  // header.
  const { data: activeMemberCount = 0 } = useQuery({
    queryKey: [...queryKeys.members.byBoard(boardId), "activeCount"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("board_member")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId)
        .eq("status", "active");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!boardId,
  });

  // TODO(phase-e-wave-4): town.detail — see this file's header.
  const { data: townData } = useQuery({
    queryKey: queryKeys.towns.detail(townId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("town")
        .select("retention_policy_acknowledged_at, state")
        .eq("id", townId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!townId,
  });

  const { data: templates = [] } = useQuery({
    ...trpc.agendaTemplate.list.queryOptions({ boardId }),
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
  const prereqValidation = validateMeetingCreation(activeMemberCount, retentionAck, boardId);

  const insertMutation = useMutation(
    trpc.meeting.insert.mutationOptions({
      onSuccess: () => {
        // Legacy key: `EditBoardDialog`'s "does this board have meetings"
        // check still reads a `queryKeys.meetings.byBoard(boardId)`-prefixed
        // key raw — conventions item 7, "the legacy line stays because
        // other, unmigrated screens still read that key."
        void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.byBoard(boardId) });
        void queryClient.invalidateQueries(trpc.meeting.pathFilter());
      },
    }),
  );

  const handleSave = useCallback(async () => {
    const data = validate();
    if (!data) return;

    setIsSaving(true);
    setSubmitError(null);
    try {
      // `meeting.insert` mints the meeting's own id and derives `created_by`
      // from the caller's own session server-side — neither is sent from
      // here any more (see this file's header).
      const { id } = await insertMutation.mutateAsync({
        boardId,
        title: data.title,
        meetingType: data.meeting_type,
        scheduledDate: data.scheduled_date,
        scheduledTime: data.scheduled_time,
        location: data.location || null,
      });

      // Instantiate agenda from selected template
      // TODO(phase-e-wave-4): agenda_item writes — see this file's header.
      const selectedTemplate = templates.find((t) => String(t.id) === data.template_id);
      if (selectedTemplate?.sections) {
        const sections = parseSections(
          selectedTemplate.sections as string,
        ) as AgendaTemplateSection[];
        await instantiateAgendaFromTemplate(id, boardId, townId, sections);
      }

      onOpenChange(false);
      void navigate(`/meetings/${id}/agenda`);
    } catch (err) {
      setSubmitError(
        isTRPCClientError(err) && err.data?.code === "FORBIDDEN"
          ? "You don't have permission to schedule a meeting for this board."
          : "Couldn't create this meeting. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [validate, insertMutation, boardId, townId, templates, onOpenChange, navigate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Meeting</DialogTitle>
          <DialogDescription>Schedule a new meeting for {boardName}.</DialogDescription>
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

        {/* Submit error — e.g. FORBIDDEN from meeting.insert */}
        {submitError && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
          >
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-destructive">{submitError}</p>
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
            {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
          </div>

          {/* Meeting Type */}
          <div className="space-y-1.5">
            <Label>Meeting type</Label>
            <Select
              value={values.meeting_type}
              onValueChange={(val) =>
                setValue("meeting_type", val as CreateMeetingFormData["meeting_type"])
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
                <p className="text-xs text-destructive">{errors.scheduled_date}</p>
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
                <p className="text-xs text-destructive">{errors.scheduled_time}</p>
              )}
            </div>
          </div>

          {/* Compliance forecast callout */}
          {forecast?.rule && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800 dark:text-blue-200">{forecast.explanation}</p>
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
            {errors.location && <p className="text-xs text-destructive">{errors.location}</p>}
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
            {errors.template_id && <p className="text-xs text-destructive">{errors.template_id}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!isValid || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
