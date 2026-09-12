/**
 * Attendance panel for the live meeting right sidebar.
 *
 * Shows quorum status, board member attendance list with toggleable
 * statuses, and presiding officer / recording secretary indicators.
 * Per advisory Q11: simple attendance list — staff are listed as
 * present or absent, without per-item scope tracking.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Clock, LogOut, Crown, BookOpen, ShieldOff } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage, type RouterOutputs } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MeetingTimer } from "./MeetingTimer";

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle: string | null;
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

interface AttendancePanelProps {
  meetingId: string;
  /**
   * The board this meeting belongs to — `meetingAttendance.setStatus` is
   * guarded by `requireBoardPermission("M2", boardIdFrom())`, declared before
   * `.input()`. Conventions item 2's named cost; `townId` is gone, because the
   * procedure takes the town from the caller's own session rather than from
   * client state.
   */
  boardId: string;
  members: MemberInfo[];
  attendance: AttendanceRecord[];
  presidingOfficerId: string | null;
  recordingSecretaryId: string | null;
  quorumRequired: number;
  quorumPresent: number;
  quorumTotal: number;
  hasQuorum: boolean;
  meetingStartedAt: string | null;
  currentItemStartedAt: string | null;
  currentItemEstimatedDuration: number | null;
  readOnly?: boolean;
  /** Called when the "Recuse" button is clicked for a present member */
  onRecuse?: (member: MemberInfo) => void;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  present: { icon: <Check className="h-3.5 w-3.5" />, label: "Present", color: "text-green-500" },
  absent: { icon: <X className="h-3.5 w-3.5" />, label: "Absent", color: "text-red-500" },
  late_arrival: { icon: <Clock className="h-3.5 w-3.5" />, label: "Late", color: "text-amber-500" },
  early_departure: {
    icon: <LogOut className="h-3.5 w-3.5" />,
    label: "Departed",
    color: "text-muted-foreground",
  },
  remote: { icon: <Check className="h-3.5 w-3.5" />, label: "Remote", color: "text-blue-500" },
  excused: {
    icon: <X className="h-3.5 w-3.5" />,
    label: "Excused",
    color: "text-muted-foreground",
  },
};

const CYCLE_ORDER = ["absent", "present", "late_arrival", "early_departure"] as const;

export function AttendancePanel({
  meetingId,
  boardId,
  members,
  attendance,
  presidingOfficerId,
  recordingSecretaryId,
  quorumRequired,
  quorumPresent,
  quorumTotal,
  hasQuorum,
  meetingStartedAt,
  currentItemStartedAt,
  currentItemEstimatedDuration,
  readOnly,
  onRecuse,
}: AttendancePanelProps) {
  const queryClient = useQueryClient();

  const getAttendance = (boardMemberId: string): AttendanceRecord | undefined =>
    attendance.find((a) => a.board_member_id === boardMemberId);

  /**
   * Wave 5, Task 5 — `meetingAttendance.setStatus` in place of the raw
   * update-or-insert.
   *
   * Three things change, and only the first is invisible:
   *
   *   - **The branch is gone.** The browser used to read its own `attendance`
   *     array, decide between UPDATE and INSERT, and issue one — so two clerks
   *     taking attendance at once both saw "no record", both INSERTed, and the
   *     loser collided with `attendance_unique_per_meeting`. The procedure is
   *     one `INSERT … ON CONFLICT DO UPDATE`; the client sends only the next
   *     status, which is still computed here from `CYCLE_ORDER`.
   *   - **`is_recording_secretary: 0` is gone**, and it was a type defect, not
   *     a value: the column is `boolean` (`0000_baseline.sql`). Wave 5 Task 4
   *     fixed this component's PROP types and left the literal, which was this
   *     task's. The procedure does not take the column at all — it writes
   *     `false` on insert and leaves it alone on update, which is what the raw
   *     writes meant.
   *   - **A refusal is now possible.** `meeting_attendance_tenant_isolation` is
   *     tenancy-only, so this write was authorized by nothing; it is M2,
   *     board-scoped, now. The message renders inline above the roster rather
   *     than as the toast the raw version used: a refusal is not a "please try
   *     again" condition, and a toast that has timed out is a message nobody
   *     can go back and read.
   */
  const cycleStatusMutation = useMutation(
    trpc.meetingAttendance.setStatus.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.attendance.byMeeting(meetingId) });
        // The upsert creates a `meeting_attendance` row for a member with no
        // record yet, which changes exactly the number
        // `routes/meetings.$meetingId.tsx`'s shell renders through
        // `trpc.meetingAttendance.countByMeeting` ("N members recorded").
        void queryClient.invalidateQueries(trpc.meetingAttendance.pathFilter());
      },
    }),
  );

  const cycleStatus = (member: MemberInfo) => {
    if (readOnly) return;
    const record = getAttendance(member.boardMemberId);
    const currentStatus = (record?.status as string) ?? "absent";
    const currentIdx = CYCLE_ORDER.indexOf(currentStatus as (typeof CYCLE_ORDER)[number]);
    const nextStatus = CYCLE_ORDER[(currentIdx + 1) % CYCLE_ORDER.length]!;
    cycleStatusMutation.reset();
    cycleStatusMutation.mutate({
      boardId,
      meetingId,
      boardMemberId: member.boardMemberId,
      status: nextStatus,
    });
  };

  return (
    <div className="flex h-full w-[300px] flex-col border-l bg-card">
      {/* Timers */}
      <div className="border-b px-4 py-3 space-y-1">
        <MeetingTimer startedAt={meetingStartedAt} label="Meeting:" />
        <MeetingTimer
          startedAt={currentItemStartedAt}
          estimatedDuration={currentItemEstimatedDuration}
          label="Item:"
        />
      </div>

      {/* Quorum indicator */}
      <div className="border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Quorum</span>
          <Badge variant={hasQuorum ? "default" : "destructive"} className="text-xs">
            {quorumPresent} / {quorumTotal}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {quorumRequired} needed {hasQuorum ? "— met" : "— NOT MET"}
        </p>
      </div>

      {cycleStatusMutation.error && (
        <p className="border-b px-4 py-2 text-xs text-destructive" role="alert">
          {refusalMessage(cycleStatusMutation.error, "change recorded attendance")}
        </p>
      )}

      {/* Member list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          {members.map((member) => {
            const record = getAttendance(member.boardMemberId);
            const status = (record?.status as string) ?? "absent";
            const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.absent;
            const isPresiding = member.boardMemberId === presidingOfficerId;
            const isSecretary = member.personId === recordingSecretaryId;
            const isPresent =
              status === "present" || status === "remote" || status === "late_arrival";

            return (
              <div key={member.boardMemberId} className="flex items-center gap-0.5">
                <button
                  onClick={() => cycleStatus(member)}
                  disabled={readOnly}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                    readOnly ? "cursor-default" : "hover:bg-muted",
                  )}
                >
                  <span className={cn("flex-shrink-0", config?.color)}>{config?.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate font-medium">{member.name}</span>
                      {isPresiding && (
                        <Crown
                          className="h-3 w-3 flex-shrink-0 text-amber-500"
                          aria-label="Presiding Officer"
                        />
                      )}
                      {isSecretary && (
                        <BookOpen
                          className="h-3 w-3 flex-shrink-0 text-blue-500"
                          aria-label="Recording Secretary"
                        />
                      )}
                    </div>
                    {member.seatTitle && (
                      <span className="text-xs text-muted-foreground">{member.seatTitle}</span>
                    )}
                  </div>
                </button>
                {/* Recuse button — only for present members when not read-only */}
                {isPresent && !readOnly && onRecuse && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRecuse(member);
                    }}
                    className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={`Record recusal for ${member.name}`}
                  >
                    <ShieldOff className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
