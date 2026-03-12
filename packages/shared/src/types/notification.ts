import type {
  ExhibitType,
  ExhibitVisibility,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventStatus,
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
  status: NotificationEventStatus;
  created_at: string;
  processed_at: string | null;
}

export interface NotificationDelivery {
  id: string;
  event_id: string;
  subscriber_id: string;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  postmark_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  error_message: string | null;
  retry_count: number;
  next_retry_at: string | null;
  created_at: string;
}

export interface TownNotificationConfig {
  id: string;
  town_id: string;
  postmark_server_token: string | null;
  postmark_sender_email: string;
  postmark_sender_name: string;
  created_at: string;
  updated_at: string;
}

export interface SubscriberNotificationPreference {
  id: string;
  subscriber_id: string;
  event_type: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
