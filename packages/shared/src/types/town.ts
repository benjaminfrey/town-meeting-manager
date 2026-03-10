import type {
  MeetingFormality,
  MinutesStyle,
  MunicipalityType,
  PopulationRange,
} from "../constants/enums.js";

export interface Town {
  id: string;
  name: string;
  state: string;
  municipality_type: MunicipalityType;
  population_range: PopulationRange;
  contact_name: string;
  contact_role: string;
  meeting_formality: MeetingFormality;
  minutes_style: MinutesStyle;
  presiding_officer_default: string;
  minutes_recorder_default: string;
  staff_roles_present: string | null; // JSON array stored as text
  subdomain: string | null;
  seal_url: string | null;
  retention_policy_acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}
