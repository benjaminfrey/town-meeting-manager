import type {
  MinutesDocumentStatus,
  MinutesGeneratedBy,
  MinutesSectionType,
} from "../constants/enums.js";

export interface MinutesDocument {
  id: string;
  meeting_id: string;
  town_id: string;
  status: MinutesDocumentStatus;
  content_json: Record<string, unknown>;
  html_rendered: string | null;
  pdf_storage_path: string | null;
  generated_by: MinutesGeneratedBy;
  approved_at: string | null;
  approved_by_motion_id: string | null;
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
