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
 */

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { Check, X, AlertTriangle, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle: string | null;
  isDefaultRecSec: boolean;
}

interface AttendanceRecord {
  id: string;
  board_member_id: string | null;
  person_id: string;
  status: string;
  is_recording_secretary: number;
}

interface MeetingStartFlowProps {
  meetingId: string;
  townId: string;
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
  townId,
  boardId,
  members,
  attendance,
  quorumRequired,
  quorumPresent,
  quorumTotal,
  hasQuorum,
  firstItemId,
}: MeetingStartFlowProps) {
  const supabase = useSupabase();
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
  const chair = members.find((m) =>
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

  const toggleAttendanceMutation = useMutation({
    mutationFn: async (member: MemberInfo) => {
      const record = getAttendance(member.boardMemberId);
      const currentStatus = (record?.status as string) ?? "absent";
      const nextStatus = currentStatus === "present" ? "absent" : "present";

      if (record) {
        const { error } = await supabase
          .from("meeting_attendance")
          .update({ status: nextStatus })
          .eq("id", record.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("meeting_attendance").insert({
          id: crypto.randomUUID(),
          meeting_id: meetingId,
          town_id: townId,
          board_member_id: member.boardMemberId,
          person_id: member.personId,
          status: nextStatus,
          is_recording_secretary: 0,
          arrived_at: null,
          departed_at: null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.byMeeting(meetingId) });
    },
  });

  const toggleAttendance = (member: MemberInfo): Promise<void> => {
    return new Promise((resolve, reject) => {
      toggleAttendanceMutation.mutate(member, { onSuccess: () => resolve(), onError: reject });
    });
  };

  const startMeetingMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();

      // Set recording secretary flag
      const secAttendance = attendance.find((a) => a.person_id === secretaryId);
      if (secAttendance) {
        const { error } = await supabase
          .from("meeting_attendance")
          .update({ is_recording_secretary: 1 })
          .eq("id", secAttendance.id);
        if (error) throw error;
      }

      // Update meeting
      const { error: meetingError } = await supabase
        .from("meeting")
        .update({
          status: "open",
          started_at: now,
          presiding_officer_id: presidingId,
          recording_secretary_id: secretaryId,
          current_agenda_item_id: firstItemId,
          updated_at: now,
        })
        .eq("id", meetingId);
      if (meetingError) throw meetingError;

      // Set first item to active and create transition
      if (firstItemId) {
        const { error: itemError } = await supabase
          .from("agenda_item")
          .update({ status: "active", updated_at: now })
          .eq("id", firstItemId);
        if (itemError) throw itemError;

        const { error: transError } = await supabase.from("agenda_item_transition").insert({
          id: crypto.randomUUID(),
          meeting_id: meetingId,
          agenda_item_id: firstItemId,
          town_id: townId,
          started_at: now,
          ended_at: null,
        });
        if (transError) throw transError;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.byMeeting(meetingId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId) });
    },
  });

  const startMeeting = () => {
    startMeetingMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-2xl rounded-lg border bg-card shadow-xl">
        {/* Step indicator */}
        <div className="flex items-center border-b px-6 py-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              {i > 0 && <div className={cn("mx-2 h-px w-8", i <= stepIdx ? "bg-primary" : "bg-border")} />}
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
              <span className={cn("ml-2 hidden text-sm sm:inline", i === stepIdx ? "font-medium" : "text-muted-foreground")}>
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
        Mark each board member as present or absent. {presentCount} of {members.length} marked present.
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
      <h3 className="text-lg font-semibold">
        {hasQuorum ? "Quorum Met" : "Quorum Not Met"}
      </h3>
      <p className="mt-2 text-2xl font-bold">
        {quorumPresent} of {quorumTotal} members present
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {quorumRequired} needed for quorum
      </p>
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
              <Badge variant="outline" className="text-xs">{member.seatTitle}</Badge>
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
              <Badge variant="outline" className="text-xs">{member.seatTitle}</Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
