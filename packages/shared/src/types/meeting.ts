import type {
  AgendaStatus,
  MeetingFormality,
  MeetingStatus,
  MeetingType,
} from "../constants/enums.js";

export interface Meeting {
  id: string;
  board_id: string;
  town_id: string;
  title: string;
  meeting_type: MeetingType;
  scheduled_date: string;
  scheduled_time: string;
  location: string;
  status: MeetingStatus;
  agenda_status: AgendaStatus;
  formality_override: MeetingFormality | null;
  started_at: string | null;
  ended_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
