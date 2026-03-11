import type {
  ExhibitType,
  ExhibitVisibility,
  NotificationChannel,
  NotificationEventType,
} from "../constants/enums.js";

export interface Exhibit {
  id: string;
  agenda_item_id: string;
  town_id: string;
  title: string;
  file_storage_path: string;
  file_type: string;
  file_size: number;
  exhibit_type: ExhibitType;
  visibility: ExhibitVisibility;
  uploaded_by: string;
  file_name: string | null;
  sort_order: number;
  created_at: string;
}

export interface NotificationEvent {
  id: string;
  town_id: string;
  event_type: NotificationEventType;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  processed_at: string | null;
}

export interface NotificationDelivery {
  id: string;
  event_id: string;
  town_id: string;
  subscriber_id: string;
  channel: NotificationChannel;
  status: string;
  external_id: string | null;
  error_message: string | null;
  created_at: string;
  delivered_at: string | null;
}
