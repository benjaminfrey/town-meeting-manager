import type {
  BoardType,
  ElectionMethod,
  MeetingFormality,
  MinutesStyle,
  MotionDisplayFormat,
  OfficerElectionMethod,
  QuorumType,
} from "../constants/enums.js";

export interface Board {
  id: string;
  town_id: string;
  name: string;
  board_type: BoardType;
  elected_or_appointed: "elected" | "appointed" | null;
  member_count: number;
  election_method: ElectionMethod;
  officer_election_method: OfficerElectionMethod;
  district_based: boolean;
  staggered_terms: boolean;
  is_governing_board: boolean;
  meeting_formality_override: MeetingFormality | null;
  minutes_style_override: MinutesStyle | null;
  quorum_type: QuorumType | null;
  quorum_value: number | null;
  motion_display_format: MotionDisplayFormat | null;
  created_at: string;
  archived_at: string | null;
}
