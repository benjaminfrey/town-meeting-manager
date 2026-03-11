import type {
  CertificationFormat,
  MemberReferenceStyle,
  MinutesDocumentStatus,
  MinutesGeneratedBy,
  MinutesSectionType,
  MinutesStyle,
  MotionDisplayFormat,
} from "../constants/enums.js";

// ─── Database record types ──────────────────────────────────────

export interface MinutesDocument {
  id: string;
  meeting_id: string;
  board_id: string | null;
  town_id: string;
  status: MinutesDocumentStatus;
  content_json: Record<string, unknown>;
  html_rendered: string | null;
  pdf_storage_path: string | null;
  minutes_style: MinutesStyle;
  generated_by: MinutesGeneratedBy;
  approved_at: string | null;
  approved_by_motion_id: string | null;
  submitted_for_review_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MinutesSection {
  id: string;
  minutes_document_id: string;
  town_id: string;
  section_type: MinutesSectionType;
  sort_order: number;
  title: string;
  content_json: Record<string, unknown>;
  source_agenda_item_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Minutes Content JSON ───────────────────────────────────────
// The canonical structured minutes data stored in content_json.

export interface MinutesContentJson {
  meeting_header: MinutesMeetingHeader;
  attendance: MinutesAttendance;
  sections: MinutesContentSection[];
  adjournment: MinutesAdjournment | null;
  certification: MinutesCertification;
}

export interface MinutesMeetingHeader {
  town_name: string;
  board_name: string;
  board_type: string | null;
  meeting_date: string;
  meeting_type: string;
  location: string | null;
  called_to_order_at: string | null;
  adjourned_at: string | null;
}

export interface MinutesAttendanceMember {
  name: string;
  seat_title: string | null;
  status: string;
  arrived_at: string | null;
  is_presiding_officer: boolean;
  is_recording_secretary: boolean;
}

export interface MinutesAttendance {
  members_present: MinutesAttendanceMember[];
  members_absent: MinutesAttendanceMember[];
  staff_present: Array<{ name: string; title: string | null }>;
  presiding_officer: string | null;
  presiding_officer_succession: string | null;
  recording_secretary: string | null;
  quorum: {
    met: boolean;
    present_count: number;
    required_count: number;
    total_members: number;
  };
}

export interface MinutesMotion {
  text: string;
  motion_type: string;
  moved_by: string | null;
  seconded_by: string | null;
  status: string;
  vote: MinutesVote | null;
  amendments: MinutesAmendment[];
}

export interface MinutesVote {
  type: string;
  result: string;
  yeas: number;
  nays: number;
  abstentions: number;
  absent: number;
  individual_votes: Array<{
    member: string;
    vote: string;
    reason?: string;
  }>;
}

export interface MinutesAmendment {
  text: string;
  moved_by: string | null;
  seconded_by: string | null;
  status: string;
  vote: MinutesVote | null;
}

export interface MinutesRecusal {
  member: string;
  reason: string;
}

export interface MinutesSpeaker {
  name: string;
  address?: string;
  topic: string | null;
}

export interface MinutesContentItem {
  title: string;
  section_ref: string | null;
  section_type: string;
  minutes_behavior: string;
  is_fixed: boolean;
  discussion_summary: string | null;
  motions: MinutesMotion[];
  recusals: MinutesRecusal[];
  speakers: MinutesSpeaker[];
  operator_notes: string | null;
  staff_resource: string | null;
  background: string | null;
  recommendation: string | null;
  timestamp_start: string | null;
  timestamp_end: string | null;
  status: string;
}

export interface MinutesExecutiveSession {
  statutory_basis: string;
  entered_at: string | null;
  exited_at: string | null;
  post_session_actions: MinutesMotion[];
}

export interface MinutesContentSection {
  title: string;
  sort_order: number;
  section_type: string;
  minutes_behavior: string;
  is_fixed: boolean;
  items: MinutesContentItem[];
  executive_session: MinutesExecutiveSession | null;
  /** "None" flag — operator marked section as explicitly empty */
  marked_none: boolean;
}

export interface MinutesAdjournment {
  method: "motion" | "without_objection";
  adjourned_by: string | null;
  timestamp: string | null;
  motion: MinutesMotion | null;
}

export interface MinutesCertification {
  format: CertificationFormat;
  recording_secretary: {
    name: string;
    title: string | null;
  } | null;
  board_members: Array<{
    name: string;
    seat_title: string | null;
  }>;
}

// ─── Render Options ─────────────────────────────────────────────

export interface MinutesRenderOptions {
  minutes_style: MinutesStyle;
  motion_display_format: MotionDisplayFormat;
  member_reference_style: MemberReferenceStyle;
  certification_format: CertificationFormat;
  is_draft: boolean;
  town_seal_url: string | null;
}

// ─── Formatted Content (output of style formatters) ─────────────

export interface MinutesFormattedSection {
  title: string;
  sort_order: number;
  section_type: string;
  /** Pre-formatted HTML-ready text for this section */
  formatted_text: string;
  /** Whether this section should be omitted from output */
  omit: boolean;
}

export interface MinutesFormattedContent {
  meeting_header: MinutesMeetingHeader;
  attendance: MinutesAttendance;
  sections: MinutesFormattedSection[];
  adjournment_text: string | null;
  certification: MinutesCertification;
}
