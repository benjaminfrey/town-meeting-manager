import { z } from "zod";
import {
  ExhibitType,
  ExhibitVisibility,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventStatus,
  NotificationEventType,
} from "../constants/enums.js";

export const ExhibitSchema = z.object({
  id: z.string().uuid(),
  agenda_item_id: z.string().uuid(),
  town_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  file_storage_path: z.string().max(500),
  file_type: z.string().max(50),
  file_size: z.number().int().min(0),
  exhibit_type: z.enum([
    ExhibitType.STAFF_REPORT,
    ExhibitType.PLAN,
    ExhibitType.LEGAL_NOTICE,
    ExhibitType.APPLICATION,
    ExhibitType.CORRESPONDENCE,
    ExhibitType.SUPPORTING_DOCUMENT,
    ExhibitType.OTHER,
  ]),
  visibility: z.enum([
    ExhibitVisibility.PUBLIC,
    ExhibitVisibility.BOARD_ONLY,
    ExhibitVisibility.ADMIN_ONLY,
  ]),
  uploaded_by: z.string().uuid(),
  sort_order: z.number().int().min(0),
  created_at: z.string().datetime(),
});

export const CreateExhibitSchema = ExhibitSchema.omit({
  id: true,
  created_at: true,
});

export const NotificationEventSchema = z.object({
  id: z.string().uuid(),
  town_id: z.string().uuid(),
  event_type: z.enum([
    NotificationEventType.MEETING_SCHEDULED,
    NotificationEventType.MEETING_CANCELLED,
    NotificationEventType.AGENDA_PUBLISHED,
    NotificationEventType.MINUTES_REVIEW,
    NotificationEventType.MINUTES_APPROVED,
    NotificationEventType.MINUTES_PUBLISHED,
    NotificationEventType.ADMIN_ALERT,
    NotificationEventType.USER_INVITED,
    NotificationEventType.PASSWORD_RESET,
    NotificationEventType.STRAW_POLL_CREATED,
  ]),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum([
    NotificationEventStatus.PENDING,
    NotificationEventStatus.PROCESSING,
    NotificationEventStatus.COMPLETED,
    NotificationEventStatus.FAILED,
  ]),
  created_at: z.string().datetime(),
  processed_at: z.string().datetime().nullable(),
});

export const NotificationDeliverySchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  subscriber_id: z.string().uuid(),
  channel: z.enum([
    NotificationChannel.EMAIL,
    NotificationChannel.SMS,
  ]),
  status: z.enum([
    NotificationDeliveryStatus.PENDING,
    NotificationDeliveryStatus.SENT,
    NotificationDeliveryStatus.DELIVERED,
    NotificationDeliveryStatus.BOUNCED,
    NotificationDeliveryStatus.FAILED,
    NotificationDeliveryStatus.COMPLAINED,
  ]),
  postmark_message_id: z.string().max(200).nullable(),
  sent_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  opened_at: z.string().datetime().nullable(),
  error_message: z.string().max(1000).nullable(),
  retry_count: z.number().int().min(0),
  next_retry_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});

export const TownNotificationConfigSchema = z.object({
  id: z.string().uuid(),
  town_id: z.string().uuid(),
  postmark_server_token: z.string().nullable(),
  postmark_sender_email: z.string().email(),
  postmark_sender_name: z.string().min(1).max(200),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
