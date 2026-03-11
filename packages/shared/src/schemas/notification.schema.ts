import { z } from "zod";
import {
  ExhibitType,
  ExhibitVisibility,
  NotificationChannel,
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
    NotificationEventType.AGENDA_PUBLISHED,
    NotificationEventType.MEETING_CANCELLED,
    NotificationEventType.MINUTES_SUBMITTED_REVIEW,
    NotificationEventType.MINUTES_APPROVED,
    NotificationEventType.MINUTES_PUBLISHED,
    NotificationEventType.STRAW_POLL_CREATED,
  ]),
  payload: z.record(z.string(), z.unknown()),
  status: z.string().max(50),
  created_at: z.string().datetime(),
  processed_at: z.string().datetime().nullable(),
});

export const NotificationDeliverySchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  town_id: z.string().uuid(),
  subscriber_id: z.string().uuid(),
  channel: z.enum([
    NotificationChannel.EMAIL,
    NotificationChannel.SMS,
  ]),
  status: z.string().max(50),
  external_id: z.string().max(200).nullable(),
  error_message: z.string().max(1000).nullable(),
  created_at: z.string().datetime(),
  delivered_at: z.string().datetime().nullable(),
});
