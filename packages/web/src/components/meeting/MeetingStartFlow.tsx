/**
 * Meeting start flow — a stepped overlay shown before the meeting
 * officially begins.
 *
 * Steps:
 * 1. Take attendance (mark members present/absent)
 * 2. Verify quorum
 * 3. Assign presiding officer (Q8: prompt when Chair is absent)
 * 4. Assign recording secretary
 *
 * On "Start Meeting": updates meeting status to 'open', sets timestamps,
 * creates the first agenda_item_transition, and writes attendance records.
 *
 * ─── Phase E, wave 5, Task 5: the call-to-order hole closes here ──────────
 *
 * ~~TODO(phase-e-wave-5): this file's writes are all still raw Supabase … this
 * `.update({status: "open", ...})` has no authorization check of any kind
 * today.~~ — **closed.** Both writes are tRPC now, and the `meeting.status`
 * one is the second of the two holes wave 5's plan names (the other is
 * adjournment, in `routes/meetings.$meetingId.live.tsx`). Task 3 built
 * `meeting.callToOrder` and correctly declined to claim the hole was shut
 * while nothing called it; this is what shuts it, and the evidence is the two
 * halves wave 4's close-out says to demand — the procedure has a real caller
 * AND the raw writes are gone rather than bypassed. This file no longer
 * imports `useSupabase` at all.
 *
 * Calling a meeting to order was four sequential, untransacted writes
 * (`meeting_attendance`'s recording-secretary flag, `meeting`, the first
 * `agenda_item`, the opening `agenda_item_transition`), so a failure after the
 * second left a meeting OPEN with no current item and no clock running. It is
 * one transaction now, guarded by `requireBoardActor(assertCanUpdateMeeting)`
 * — admin/A1/M1 on this meeting's own board. That guard governs the whole act
 * rather than each table's own rule; the reasoning and its cost are in
 * `callToOrder`'s own doc comment, not restated here.
 */

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage, type RouterOutputs } from "@/lib/trpc";
import { Check, X, AlertTriangle, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle: string | null;
  isDefaultRecSec: boolean;
}

/**
 * One `meeting_attendance` row, as the procedure returns it.
 *
 * Phase E, wave 5, Task 4 — was a hand-written interface with
 * `is_recording_secretary: number`, which the column has never been (it is
 * `boolean`), reached from `live.tsx` through a
 * `ComponentProps<typeof X>["attendance"]` cast that made the disagreement
 * invisible. Conventions item 10: a child taking a tRPC payload takes the
 * procedure's own output type, never a bag or a restatement.
 */
type AttendanceRecord = RouterOutputs["meetingAttendance"]["byMeeting"][number];

interface MeetingStartFlowProps {
  meetingId: string;
  /**
   * The board this meeting belongs to. Already a prop before this task, and
   * now load-bearing: both procedures authorize on it before `.input()` parses.
   * `townId` is gone — both take the town from the caller's own session.
   */
  boardId: string;
  members: MemberInfo[];
  attendance: AttendanceRecord[];
  quorumRequired: number;
  quorumPresent: number;
  quorumTotal: number;
  hasQuorum: boolean;
  firstItemId: string | null;
}

type Step = "attendance" | "quorum" | "presiding" | "secretary";
const STEPS: Step[] = ["attendance", "quorum", "presiding", "secretary"];
const STEP_LABELS: Record<Step, string> = {
  attendance: "Take Attendance",
  quorum: "Verify Quorum",
  presiding: "Presiding Officer",
  secretary: "Recording Secretary",
};

export function MeetingStartFlow({
  meetingId,
  boardId,
  members,
  attendance,
  quorumRequired,
  quorumPresent,
  quorumTotal,
  hasQuorum,
  firstItemId,
}: MeetingStartFlowProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("attendance");
  const [presidingId, setPresidingId] = useState<string>("");
  const [secretaryId, setSecretaryId] = useState<string>("");

  const stepIdx = STEPS.indexOf(step);

  // Helpers
  const getAttendance = (boardMemberId: string): AttendanceRecord | undefined =>
    attendance.find((a) => a.board_member_id === boardMemberId);

  const presentMemberIds = useMemo(
    () =>
      new Set(
        attendance
          .filter((a) => {
            const s = a.status as string;
            return s === "present" || s === "remote" || s === "late_arrival";
          })
          .map((a) => a.board_member_id),
      ),
    [attendance],
  );

  const presentMembers = members.filter((m) => presentMemberIds.has(m.boardMemberId));

  // Auto-detect chair and vice chair by seat_title
  const chair = members.find(
    (m) =>
      m.seatTitle?.toLowerCase().includes("chair") && !m.seatTitle?.toLowerCase().includes("vice"),
  );
  const viceChair = members.find((m) => m.seatTitle?.toLowerCase().includes("vice"));
  const chairIsPresent = chair ? presentMemberIds.has(chair.boardMemberId) : false;
  const defaultRecSec = members.find((m) => m.isDefaultRecSec);

  // Auto-select presiding officer
  if (!presidingId && presentMembers.length > 0) {
    if (chairIsPresent && chair) {
      setPresidingId(chair.boardMemberId);
    } else if (viceChair && presentMemberIds.has(viceChair.boardMemberId)) {
      setPresidingId(viceChair.boardMemberId);
    }
  }

  // Auto-select recording secretary
  if (!secretaryId && presentMembers.length > 0) {
    if (defaultRecSec && presentMemberIds.has(defaultRecSec.boardMemberId)) {
      setSecretaryId(defaultRecSec.personId);
    }
  }

  /**
   * Roll call — `meetingAttendance.setRollCall`, a separate procedure from the
   * status cycle `AttendancePanel` uses even though both "set this member's
   * status, creating the row if it does not exist". This one writes `status`
   * and nothing else; collapsing them would have a pre-meeting roll-call
   * toggle clearing a `departed_at` it has never touched. See that router's
   * header.
   *
   * `is_recording_secretary: 0` is gone with the raw insert — the column is
   * `boolean`, and the integer literal was a real type defect wave 5 Task 4
   * found while retyping this file's props and left for this one.
   */
  const toggleAttendanceMutation = useMutation(
    trpc.meetingAttendance.setRollCall.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.byMeeting(meetingId) });
        // Creates a `meeting_attendance` row for a member with none yet — the
        // count `routes/meetings.$meetingId.tsx`'s shell renders through
        // `trpc.meetingAttendance.countByMeeting`.
        void queryClient.invalidateQueries(trpc.meetingAttendance.pathFilter());
      },
    }),
  );

  const toggleAttendance = (member: MemberInfo): Promise<void> => {
    const record = getAttendance(member.boardMemberId);
    const currentStatus = (record?.status as string) ?? "absent";
    const nextStatus = currentStatus === "present" ? "absent" : "present";
    toggleAttendanceMutation.reset();
    // Settles either way, and never REJECTS. The caller is
    // `AttendanceStep`'s `onClick={() => void onToggle(member)}`, so a
    // rejection here is an unhandled promise rejection — which vitest fails
    // the whole run on, and which a browser logs and nobody reads. It used to
    // be harmless only because the raw write had no failure a user could act
    // on; now that this can answer FORBIDDEN, the refusal is RENDERED (from
    // `toggleAttendanceMutation.error`) rather than thrown.
    return new Promise((resolve) => {
      toggleAttendanceMutation.mutate(
        { boardId, meetingId, boardMemberId: member.boardMemberId, status: nextStatus },
        { onSuccess: () => resolve(), onError: () => resolve() },
      );
    });
  };

  const startMeetingMutation = useMutation(
    trpc.meeting.callToOrder.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.byMeeting(meetingId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agendaItems.byMeeting(meetingId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId),
        });
        // The kanban (routes/meetings.tsx) and board Meetings tab
        // (routes/boards.$boardId.meetings.tsx) both read this meeting's
        // status via trpc.meeting.byTown/byBoard — this write moves it
        // draft/noticed → open, which both screens render.
        void queryClient.invalidateQueries(trpc.meeting.pathFilter());
        // Same shell, two more of its reads: this mutation flips the recording
        // secretary's `meeting_attendance` row and the first `agenda_item` to
        // `active`. Neither changes a COUNT today, but both are writes to the
        // tables those two routers own — invalidated at the router, per
        // conventions item 7.
        void queryClient.invalidateQueries(trpc.meetingAttendance.pathFilter());
        void queryClient.invalidateQueries(trpc.agendaItem.pathFilter());
        // And the first `agenda_item_transition` row this mutation opens — the
        // read behind the live screen's per-item timer, moved onto
        // `trpc.agendaItemTransition.byMeeting` in wave 5, Task 4.
        void queryClient.invalidateQueries(trpc.agendaItemTransition.pathFilter());
        toast.success("Meeting called to order");
      },
    }),
  );

  const startMeeting = () => {
    startMeetingMutation.reset();
    startMeetingMutation.mutate({
      meetingId,
      boardId,
      // `presidingOfficerId` is a `board_member.id` and `recordingSecretaryId`
      // a `person.id` — two different nouns, as they were in the raw write
      // (`SecretaryStep` selects by `member.personId`). The procedure checks
      // the first against this meeting's board and the second for existence in
      // the caller's town, neither of which the database has ever checked:
      // `meeting.recording_secretary_id` carries no foreign key at all.
      presidingOfficerId: presidingId || null,
      recordingSecretaryId: secretaryId || null,
      firstItemId,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-2xl rounded-lg border bg-card shadow-xl">
        {/* Step indicator */}
        <div className="flex items-center border-b px-6 py-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              {i > 0 && (
                <div className={cn("mx-2 h-px w-8", i <= stepIdx ? "bg-primary" : "bg-border")} />
              )}
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                  i < stepIdx
                    ? "bg-primary text-primary-foreground"
                    : i === stepIdx
                      ? "border-2 border-primary text-primary"
                      : "border border-border text-muted-foreground",
                )}
              >
                {i < stepIdx ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "ml-2 hidden text-sm sm:inline",
                  i === stepIdx ? "font-medium" : "text-muted-foreground",
                )}
              >
                {STEP_LABELS[s]}
              </span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 py-5">
          {step === "attendance" && (
            <AttendanceStep
              members={members}
              presentMemberIds={presentMemberIds}
              onToggle={toggleAttendance}
            />
          )}
          {step === "quorum" && (
            <QuorumStep
              quorumPresent={quorumPresent}
              quorumTotal={quorumTotal}
              quorumRequired={quorumRequired}
              hasQuorum={hasQuorum}
            />
          )}
          {step === "presiding" && (
            <PresidingStep
              presentMembers={presentMembers}
              chair={chair ?? null}
              chairIsPresent={chairIsPresent}
              selectedId={presidingId}
              onSelect={setPresidingId}
            />
          )}
          {step === "secretary" && (
            <SecretaryStep
              presentMembers={presentMembers}
              selectedId={secretaryId}
              onSelect={setSecretaryId}
            />
          )}
        </div>

        {(toggleAttendanceMutation.error || startMeetingMutation.error) && (
          <p className="px-6 pb-2 text-sm text-destructive" role="alert">
            {toggleAttendanceMutation.error
              ? refusalMessage(toggleAttendanceMutation.error, "record attendance")
              : refusalMessage(startMeetingMutation.error, "call this meeting to order")}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep(STEPS[stepIdx - 1]!)}
            disabled={stepIdx === 0}
          >
            Back
          </Button>
          {step !== "secretary" ? (
            <Button
              size="sm"
              onClick={() => setStep(STEPS[stepIdx + 1]!)}
              disabled={step === "quorum" && !hasQuorum}
            >
              Continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => startMeeting()}
              disabled={!presidingId || !secretaryId || startMeetingMutation.isPending}
            >
              <Play className="mr-1 h-4 w-4" />
              {startMeetingMutation.isPending ? "Starting..." : "Start Meeting"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step Components ─────────────────────────────────────────────────

function AttendanceStep({
  members,
  presentMemberIds,
  onToggle,
}: {
  members: MemberInfo[];
  presentMemberIds: Set<string | null>;
  onToggle: (member: MemberInfo) => Promise<void>;
}) {
  const presentCount = members.filter((m) => presentMemberIds.has(m.boardMemberId)).length;

  return (
    <div>
      <h3 className="mb-1 text-lg font-semibold">Take Attendance</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Mark each board member as present or absent. {presentCount} of {members.length} marked
        present.
      </p>
      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {members.map((member) => {
          const isPresent = presentMemberIds.has(member.boardMemberId);
          return (
            <button
              key={member.boardMemberId}
              onClick={() => void onToggle(member)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-colors",
                isPresent ? "bg-green-50 dark:bg-green-950/30" : "hover:bg-muted",
              )}
            >
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full",
                  isPresent ? "bg-green-500 text-white" : "border-2 border-muted-foreground/30",
                )}
              >
                {isPresent && <Check className="h-3.5 w-3.5" />}
              </div>
              <div>
                <span className="font-medium">{member.name}</span>
                {member.seatTitle && (
                  <span className="ml-2 text-xs text-muted-foreground">{member.seatTitle}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuorumStep({
  quorumPresent,
  quorumTotal,
  quorumRequired,
  hasQuorum,
}: {
  quorumPresent: number;
  quorumTotal: number;
  quorumRequired: number;
  hasQuorum: boolean;
}) {
  return (
    <div className="text-center py-6">
      <div
        className={cn(
          "mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full",
          hasQuorum ? "bg-green-100 dark:bg-green-950/50" : "bg-red-100 dark:bg-red-950/50",
        )}
      >
        {hasQuorum ? (
          <Check className="h-10 w-10 text-green-600" />
        ) : (
          <X className="h-10 w-10 text-red-600" />
        )}
      </div>
      <h3 className="text-lg font-semibold">{hasQuorum ? "Quorum Met" : "Quorum Not Met"}</h3>
      <p className="mt-2 text-2xl font-bold">
        {quorumPresent} of {quorumTotal} members present
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{quorumRequired} needed for quorum</p>
      {!hasQuorum && (
        <div className="mt-4 flex items-center justify-center gap-2 text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">
            Cannot start meeting without quorum. Update attendance as members arrive.
          </span>
        </div>
      )}
    </div>
  );
}

function PresidingStep({
  presentMembers,
  chair,
  chairIsPresent,
  selectedId,
  onSelect,
}: {
  presentMembers: MemberInfo[];
  chair: MemberInfo | null;
  chairIsPresent: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-1 text-lg font-semibold">Presiding Officer</h3>
      {!chairIsPresent && chair ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Chair {chair.name} is absent. Who is presiding?
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">
          Confirm who is presiding over this meeting.
        </p>
      )}
      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {presentMembers.map((member) => (
          <button
            key={member.boardMemberId}
            onClick={() => onSelect(member.boardMemberId)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-colors",
              selectedId === member.boardMemberId
                ? "bg-primary/10 border border-primary"
                : "hover:bg-muted",
            )}
          >
            <div
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border-2",
                selectedId === member.boardMemberId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30",
              )}
            >
              {selectedId === member.boardMemberId && <Check className="h-3 w-3" />}
            </div>
            <span className="font-medium">{member.name}</span>
            {member.seatTitle && (
              <Badge variant="outline" className="text-xs">
                {member.seatTitle}
              </Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function SecretaryStep({
  presentMembers,
  selectedId,
  onSelect,
}: {
  presentMembers: MemberInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-1 text-lg font-semibold">Recording Secretary</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Who is serving as recording secretary for this meeting?
      </p>
      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {presentMembers.map((member) => (
          <button
            key={member.personId}
            onClick={() => onSelect(member.personId)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-colors",
              selectedId === member.personId
                ? "bg-primary/10 border border-primary"
                : "hover:bg-muted",
            )}
          >
            <div
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border-2",
                selectedId === member.personId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30",
              )}
            >
              {selectedId === member.personId && <Check className="h-3 w-3" />}
            </div>
            <span className="font-medium">{member.name}</span>
            {member.seatTitle && (
              <Badge variant="outline" className="text-xs">
                {member.seatTitle}
              </Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
