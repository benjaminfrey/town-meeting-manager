import type {
  AgendaItemSectionType,
  AgendaItemStatus,
  MinutesBehavior,
} from "../constants/enums.js";

export interface AgendaItem {
  id: string;
  meeting_id: string;
  town_id: string;
  section_type: AgendaItemSectionType;
  sort_order: number;
  title: string;
  description: string | null;
  presenter: string | null;
  estimated_duration: number | null;
  parent_item_id: string | null;
  status: AgendaItemStatus;
  created_at: string;
  updated_at: string;
}

export interface AgendaTemplateSection {
  title: string;
  sort_order: number;
  section_type: AgendaItemSectionType;
  is_fixed: boolean;
  description: string | null;
  default_items: string[];
  minutes_behavior: MinutesBehavior;
  show_item_commentary: boolean;
}

export interface AgendaTemplate {
  id: string;
  board_id: string;
  town_id: string;
  name: string;
  is_default: boolean;
  sections: AgendaTemplateSection[];
  created_at: string;
  updated_at: string;
}
