export interface PortalTownInfo {
  id: string;
  name: string;
  state: string;
  municipality_type: string;
  seal_url: string | null;
  contact_name: string;
  contact_role: string;
  subdomain: string;
}

export interface PortalMeetingSummary {
  id: string;
  title: string;
  board_id: string;
  board_name: string;
  meeting_type: string;
  scheduled_date: string;
  scheduled_time: string;
  location: string;
  status: string;
  has_published_agenda: boolean;
  has_published_minutes: boolean;
}

export interface PortalMeetingDetail extends PortalMeetingSummary {
  started_at: string | null;
  ended_at: string | null;
  agenda_packet_url: string | null;
}

export interface PortalAgendaItem {
  id: string;
  title: string;
  description: string | null;
  section_type: string;
  sort_order: number;
  presenter: string | null;
  staff_resource: string | null;
  background: string | null;
  recommendation: string | null;
  suggested_motion: string | null;
  children: PortalAgendaItem[];
  exhibits: PortalExhibit[];
}

export interface PortalExhibit {
  id: string;
  title: string;
  file_type: string;
  file_size: number;
  exhibit_type: string;
  download_url: string;
}

export interface PortalAgenda {
  meeting: PortalMeetingDetail;
  sections: PortalAgendaItem[];
}

export interface PortalMinutes {
  html_rendered: string;
  approved_at: string | null;
  published_at: string | null;
  meeting_date: string;
  board_name: string;
  has_pdf: boolean;
}

export interface PortalBoardSummary {
  id: string;
  name: string;
  board_type: string;
  elected_or_appointed: string | null;
  member_count: number;
}

export interface PortalBoardMember {
  name: string;
  seat_title: string | null;
  term_start: string | null;
  term_end: string | null;
}

export interface PortalBoardDetail extends PortalBoardSummary {
  members: PortalBoardMember[];
}

export interface PortalCalendarEvent {
  id: string;
  title: string;
  board_name: string;
  board_id: string;
  scheduled_date: string;
  scheduled_time: string;
  location: string;
  meeting_type: string;
}

export interface PortalSearchResult {
  type: "agenda" | "minutes";
  meeting_id: string;
  meeting_date: string;
  board_name: string;
  title: string;
  snippet: string;
}

export interface PortalSearchResponse {
  results: PortalSearchResult[];
  total: number;
  page: number;
  pages: number;
}
