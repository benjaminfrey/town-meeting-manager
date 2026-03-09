import { z } from "zod";
import {
  AttendanceStatus,
  MotionStatus,
  MotionType,
  VoteType,
} from "../constants/enums.js";

export const MotionSchema = z.object({
  id: z.string().uuid(),
  agenda_item_id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  town_id: z.string().uuid(),
  motion_text: z.string().min(1).max(2000),
  motion_type: z.enum([
    MotionType.MAIN,
    MotionType.AMENDMENT,
    MotionType.SUBSTITUTE,
    MotionType.TABLE,
    MotionType.UNTABLE,
    MotionType.POSTPONE,
    MotionType.RECONSIDER,
    MotionType.ADJOURN,
  ]),
  moved_by: z.string().uuid(),
  seconded_by: z.string().uuid().nullable(),
  status: z.enum([
    MotionStatus.PENDING,
    MotionStatus.SECONDED,
    MotionStatus.IN_VOTE,
    MotionStatus.PASSED,
    MotionStatus.FAILED,
    MotionStatus.TABLED,
    MotionStatus.WITHDRAWN,
  ]),
  created_at: z.string().datetime(),
});

export const CreateMotionSchema = MotionSchema.omit({
  id: true,
  status: true,
  created_at: true,
});

export const VoteRecordSchema = z.object({
  id: z.string().uuid(),
  motion_id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  town_id: z.string().uuid(),
  board_member_id: z.string().uuid(),
  vote: z.enum([
    VoteType.YES,
    VoteType.NO,
    VoteType.ABSTAIN,
    VoteType.RECUSAL,
    VoteType.ABSENT,
  ]),
  recusal_reason: z.string().max(500).nullable(),
  created_at: z.string().datetime(),
});

export const CreateVoteRecordSchema = VoteRecordSchema.omit({
  id: true,
  created_at: true,
});

export const MeetingAttendanceSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  town_id: z.string().uuid(),
  board_member_id: z.string().uuid(),
  person_id: z.string().uuid(),
  status: z.enum([
    AttendanceStatus.PRESENT,
    AttendanceStatus.ABSENT,
    AttendanceStatus.REMOTE,
    AttendanceStatus.EXCUSED,
    AttendanceStatus.LATE_ARRIVAL,
    AttendanceStatus.EARLY_DEPARTURE,
  ]),
  is_recording_secretary: z.boolean(),
  arrived_at: z.string().datetime().nullable(),
  departed_at: z.string().datetime().nullable(),
});

export const CreateMeetingAttendanceSchema = MeetingAttendanceSchema.omit({
  id: true,
});
