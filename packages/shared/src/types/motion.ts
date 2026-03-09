import type {
  AttendanceStatus,
  MotionStatus,
  MotionType,
  VoteType,
} from "../constants/enums.js";

export interface Motion {
  id: string;
  agenda_item_id: string;
  meeting_id: string;
  town_id: string;
  motion_text: string;
  motion_type: MotionType;
  moved_by: string;
  seconded_by: string | null;
  status: MotionStatus;
  created_at: string;
}

export interface VoteRecord {
  id: string;
  motion_id: string;
  meeting_id: string;
  town_id: string;
  board_member_id: string;
  vote: VoteType;
  recusal_reason: string | null;
  created_at: string;
}

export interface MeetingAttendance {
  id: string;
  meeting_id: string;
  town_id: string;
  board_member_id: string;
  person_id: string;
  status: AttendanceStatus;
  is_recording_secretary: boolean;
  arrived_at: string | null;
  departed_at: string | null;
}
