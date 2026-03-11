/**
 * Attendance panel for the live meeting right sidebar.
 *
 * Shows quorum status, board member attendance list with toggleable
 * statuses, and presiding officer / recording secretary indicators.
 * Per advisory Q11: simple attendance list — staff are listed as
 * present or absent, without per-item scope tracking.
 */

import { usePowerSync } from "@powersync/react";
import { Check, X, Clock, LogOut, Crown, BookOpen, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MeetingTimer } from "./MeetingTimer";

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle: string | null;
}

interface AttendanceRecord {
  id: string;
  board_member_id: string | null;
  person_id: string;
  status: string;
  arrived_at: string | null;
  departed_at: string | null;
  is_recording_secretary: number;
}

interface AttendancePanelProps {
  meetingId: string;
  townId: string;
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
  early_departure: { icon: <LogOut className="h-3.5 w-3.5" />, label: "Departed", color: "text-muted-foreground" },
  remote: { icon: <Check className="h-3.5 w-3.5" />, label: "Remote", color: "text-blue-500" },
  excused: { icon: <X className="h-3.5 w-3.5" />, label: "Excused", color: "text-muted-foreground" },
};

const CYCLE_ORDER = ["absent", "present", "late_arrival", "early_departure"] as const;

export function AttendancePanel({
  meetingId,
  townId,
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
  const powerSync = usePowerSync();

  const getAttendance = (boardMemberId: string): AttendanceRecord | undefined =>
    attendance.find((a) => a.board_member_id === boardMemberId);

  const cycleStatus = async (member: MemberInfo) => {
    if (readOnly) return;

    const record = getAttendance(member.boardMemberId);
    const currentStatus = (record?.status as string) ?? "absent";
    const currentIdx = CYCLE_ORDER.indexOf(currentStatus as typeof CYCLE_ORDER[number]);
    const nextStatus = CYCLE_ORDER[(currentIdx + 1) % CYCLE_ORDER.length];
    const now = new Date().toISOString();

    if (record) {
      const arrivedAt = nextStatus === "late_arrival" ? now : record.arrived_at;
      const departedAt = nextStatus === "early_departure" ? now : null;
      await powerSync.execute(
        `UPDATE meeting_attendance SET status = ?, arrived_at = ?, departed_at = ?, is_recording_secretary = ? WHERE id = ?`,
        [nextStatus, arrivedAt, departedAt, record.is_recording_secretary, record.id],
      );
    } else {
      const id = crypto.randomUUID();
      const arrivedAt = nextStatus === "late_arrival" ? now : null;
      await powerSync.execute(
        `INSERT INTO meeting_attendance (id, meeting_id, town_id, board_member_id, person_id, status, is_recording_secretary, arrived_at, departed_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
        [id, meetingId, townId, member.boardMemberId, member.personId, nextStatus, arrivedAt],
      );
    }
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

      {/* Member list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          {members.map((member) => {
            const record = getAttendance(member.boardMemberId);
            const status = (record?.status as string) ?? "absent";
            const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.absent;
            const isPresiding = member.boardMemberId === presidingOfficerId;
            const isSecretary = member.personId === recordingSecretaryId;
            const isPresent = status === "present" || status === "remote" || status === "late_arrival";

            return (
              <div key={member.boardMemberId} className="flex items-center gap-0.5">
                <button
                  onClick={() => void cycleStatus(member)}
                  disabled={readOnly}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                    readOnly ? "cursor-default" : "hover:bg-muted",
                  )}
                >
                  <span className={cn("flex-shrink-0", config?.color)}>
                    {config?.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate font-medium">{member.name}</span>
                      {isPresiding && (
                        <Crown className="h-3 w-3 flex-shrink-0 text-amber-500" title="Presiding Officer" />
                      )}
                      {isSecretary && (
                        <BookOpen className="h-3 w-3 flex-shrink-0 text-blue-500" title="Recording Secretary" />
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
