import { z } from "zod";
import {
  MeetingFormality,
  MeetingStatus,
  MeetingType,
} from "../constants/enums.js";

export const MeetingSchema = z.object({
  id: z.string().uuid(),
  board_id: z.string().uuid(),
  town_id: z.string().uuid(),
  title: z.string().min(2).max(200),
  meeting_type: z.enum([
    MeetingType.REGULAR,
    MeetingType.SPECIAL,
    MeetingType.PUBLIC_HEARING,
    MeetingType.EMERGENCY,
  ]),
  scheduled_date: z.string().date(),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  location: z.string().max(200),
  status: z.enum([
    MeetingStatus.DRAFT,
    MeetingStatus.NOTICED,
    MeetingStatus.OPEN,
    MeetingStatus.ADJOURNED,
    MeetingStatus.MINUTES_DRAFT,
    MeetingStatus.APPROVED,
    MeetingStatus.CANCELLED,
  ]),
  formality_override: z
    .enum([
      MeetingFormality.INFORMAL,
      MeetingFormality.SEMI_FORMAL,
      MeetingFormality.FORMAL,
    ])
    .nullable(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateMeetingSchema = MeetingSchema.omit({
  id: true,
  status: true,
  started_at: true,
  ended_at: true,
  created_at: true,
  updated_at: true,
});
