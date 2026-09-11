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
 * the write.
 *
 * Before that task, `insert`'s raw Supabase write could never be refused —
 * there was no authorization check at all, so a caught-and-surfaced error
 * path was unreachable, including from `boards.$boardId.meetings.tsx`'s own
 * ungated "Create Meeting" button (no `usePermission("A1")` check there).
 * Closing the hole made FORBIDDEN a real outcome; without a visible error
 * here, a refused create leaves the dialog open with nothing said.
 *
 * ─── Phase E, wave 4, Task 4 — the remaining three markers, discharged ─────
 *
 * All three raw Supabase reads/writes this file's wave-3 marker named are
 * gone, and the file no longer imports the Supabase client at all:
 *
 *   - the active `board_member` count → `trpc.boardMember.activeCountForBoard`,
 *     a NEW procedure. The marker said no exact one existed and it was still
 *     true: `memberCount` is town-wide and counts archived seats, `roster`
 *     would answer it client-side but ships every seat's invitation TOKEN to
 *     count rows. See that procedure's own doc comment.
 *   - the town retention/state read → `trpc.town.detail`, which already
 *     existed and was a drop-in. It takes NO input: the town comes from the
 *     caller's own bridged session, not from this component's `townId` prop —
 *     which is why that prop is gone (see below).
 *   - `instantiateAgendaFromTemplate` → `trpc.agendaItem.instantiateFromTemplate`
 *     (wave 4, Task 1). `lib/meeting-helpers.ts`, whose only caller this was,
 *     is DELETED in the same commit.
 *
 * **This fixed a live defect, not just a transport.** The helper wrote
 * `agenda_item` rows through the Supabase client, which carries no credential
 * since Stage 1 Task C2 (`lib/supabase.ts`'s own header). Every
 * create-from-template therefore produced a meeting with an EMPTY agenda —
 * and, because the helper throws and the old `handleSave` had ONE `try` around
 * both steps, the failure was reported as "Couldn't create this meeting",
 * which was false: the meeting had been created. Clicking the button again
 * made a second one.
 *
 * ─── Two calls, not one, and what the user sees if the second fails ───────
 *
 * `meeting.insert` and `agendaItem.instantiateFromTemplate` stay SEPARATE
 * procedures, deliberately:
 *
 *   - they are authorized by different codes. `insert` is A1
 *     (`create_meeting`, via `requireBoardPermission("A1", …)`);
 *     `instantiateFromTemplate` is A2 (`edit_agenda`). Folding them into one
 *     procedure would need a rule spanning both codes — one that does not
 *     exist in `rules.ts` — and would change who may schedule a meeting: a
 *     clerk holding A1 and not A2 can schedule one today, and under a folded
 *     procedure would be refused outright (or have the agenda silently
 *     dropped, which is worse). That is a product decision, not a migration's
 *     to make (conventions item 1: the query you are replacing is a
 *     specification).
 *   - `agenda_item` is not the `meeting` router's noun (conventions item 1).
 *
 * The cost is real and is NOT hidden: the meeting exists before instantiation
 * runs, so a refused or failed instantiation leaves a meeting with an empty
 * agenda. The dialog says exactly that ("The meeting was created, but …") and
 * swaps its primary action from "Create Meeting" to "Open agenda", so the only
 * action offered is the one that is not a duplicate create. The previous
 * behaviour — a message blaming the create, with the create button still
 * armed — is what made this worth spelling out.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { queryKeys } from "@/lib/queryKeys";
import { refusalMessage, trpc } from "@/lib/trpc";
import { z } from "zod";
import { AlertCircle, Info, Loader2 } from "lucide-react";
import {
  validateMeetingCreation,
  forecastEarliestMeetingDate,
  type MeetingType,
} from "@town-meeting/shared";
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

/**
 * No `townId`. Every read this component makes is either board-scoped
 * (`activeCountForBoard`, `agendaTemplate.list`) or resolves the town from the
 * caller's own session server-side (`town.detail`), so a town id passed down
 * from a route had nothing left to do — and a client-supplied town id that
 * nothing checks is the shape conventions item 10 warns about. Dropped from
 * all three call sites (`boards.$boardId.meetings.tsx`, `home.tsx`,
 * `meetings.tsx`) in the same commit.
 */
interface CreateMeetingDialogProps {
  boardId: string;
  boardName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMeetingDialog({
  boardId,
  boardName,
  open,
  onOpenChange,
}: CreateMeetingDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * Set ONLY when the meeting was created and its agenda instantiation then
   * failed — the one state in which "Create Meeting" would make a duplicate.
   * See this file's header, "Two calls, not one".
   */
  const [createdMeetingId, setCreatedMeetingId] = useState<string | null>(null);

  // The dialog is mounted permanently on `boards.$boardId.meetings.tsx`
  // (`open` is a prop, not a mount condition), so without this a refusal from
  // one attempt is still on screen — and the "Open agenda" button still
  // pointing at the previous meeting — when the dialog is reopened.
  useEffect(() => {
    if (open) {
      setSubmitError(null);
      setCreatedMeetingId(null);
    }
  }, [open]);

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
  const { data: activeMemberCount = 0 } = useQuery({
    ...trpc.boardMember.activeCountForBoard.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  // No `enabled` guard and no input: `town.detail` reads
  // `ctx.tenant.townId` — the caller's own session — so there is no id to wait
  // for. See that procedure's doc comment.
  const { data: townData } = useQuery(trpc.town.detail.queryOptions());

  const { data: templates = [] } = useQuery({
    ...trpc.agendaTemplate.list.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  const retentionAck = townData?.retention_policy_acknowledged_at ?? null;
  // `town.detail` types `state` as `NewEnglandStateCode`, so the
  // `Record<string, unknown>` cast the raw Supabase row needed is gone
  // (conventions item 10).
  const townState: string = townData?.state ?? "ME";

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

  const instantiateMutation = useMutation(
    trpc.agendaItem.instantiateFromTemplate.mutationOptions({
      onSuccess: () => {
        // Defensive rather than load-bearing, and worth saying which: the
        // meeting id was minted by `meeting.insert` moments ago, so no cached
        // `agendaItem` query for it can exist yet and this invalidation has
        // nothing to drop today. It is here because `agendaItem` is a
        // MIGRATED entity in `cache-key-parity.test.ts`'s map and every other
        // writer of `agenda_item` rows in this wave carries it (conventions
        // item 7) — a writer that is the exception by omission is the one
        // nobody re-checks the day a re-instantiate path appears.
        void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
      },
    }),
  );

  const handleSave = useCallback(async () => {
    const data = validate();
    if (!data) return;

    setIsSaving(true);
    setSubmitError(null);

    // `meeting.insert` mints the meeting's own id and derives `created_by`
    // from the caller's own session server-side — neither is sent from
    // here any more (see this file's header).
    let meetingId: string;
    try {
      const created = await insertMutation.mutateAsync({
        boardId,
        title: data.title,
        meetingType: data.meeting_type,
        scheduledDate: data.scheduled_date,
        scheduledTime: data.scheduled_time,
        location: data.location || null,
      });
      meetingId = created.id;
    } catch (err) {
      setSubmitError(refusalMessage(err, "schedule a meeting for this board"));
      setIsSaving(false);
      return;
    }

    // A SEPARATE try, deliberately — everything past this point runs with the
    // meeting already in the database, so a failure here may not be reported
    // as a failure to create the meeting (this file's header).
    if (data.template_id) {
      try {
        await instantiateMutation.mutateAsync({
          boardId,
          meetingId,
          templateId: data.template_id,
        });
      } catch (err) {
        // Not `refusalMessage`: both of its sentences say the action did not
        // happen, and half of this one did. The meeting exists.
        setSubmitError(
          isTRPCClientError(err) && err.data?.code === "FORBIDDEN"
            ? "The meeting was created, but you don't have permission to build its agenda from a template. Open the agenda to add items by hand."
            : "The meeting was created, but its agenda couldn't be filled in from the template. Open the agenda to add items by hand.",
        );
        setCreatedMeetingId(meetingId);
        setIsSaving(false);
        return;
      }
    }

    setIsSaving(false);
    onOpenChange(false);
    void navigate(`/meetings/${meetingId}/agenda`);
  }, [validate, insertMutation, instantiateMutation, boardId, onOpenChange, navigate]);

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
            {createdMeetingId ? "Close" : "Cancel"}
          </Button>
          {createdMeetingId ? (
            // The meeting exists; "Create Meeting" here would make a second
            // one. See this file's header.
            <Button
              onClick={() => {
                onOpenChange(false);
                void navigate(`/meetings/${createdMeetingId}/agenda`);
              }}
            >
              Open agenda
            </Button>
          ) : (
            <Button onClick={() => void handleSave()} disabled={!isValid || isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Meeting
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
