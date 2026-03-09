import { z } from "zod";
import {
  MinutesDocumentStatus,
  MinutesGeneratedBy,
  MinutesSectionType,
} from "../constants/enums.js";

export const MinutesDocumentSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  town_id: z.string().uuid(),
  status: z.enum([
    MinutesDocumentStatus.DRAFT,
    MinutesDocumentStatus.REVIEW,
    MinutesDocumentStatus.APPROVED,
    MinutesDocumentStatus.PUBLISHED,
  ]),
  content_json: z.record(z.string(), z.unknown()),
  html_rendered: z.string().nullable(),
  pdf_storage_path: z.string().max(500).nullable(),
  generated_by: z.enum([
    MinutesGeneratedBy.MANUAL,
    MinutesGeneratedBy.AI,
    MinutesGeneratedBy.HYBRID,
  ]),
  approved_at: z.string().datetime().nullable(),
  approved_by_motion_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateMinutesDocumentSchema = MinutesDocumentSchema.omit({
  id: true,
  status: true,
  html_rendered: true,
  pdf_storage_path: true,
  approved_at: true,
  approved_by_motion_id: true,
  created_at: true,
  updated_at: true,
});

export const MinutesSectionSchema = z.object({
  id: z.string().uuid(),
  minutes_document_id: z.string().uuid(),
  town_id: z.string().uuid(),
  section_type: z.enum([
    MinutesSectionType.HEADER,
    MinutesSectionType.ATTENDANCE,
    MinutesSectionType.AGENDA_ITEM,
    MinutesSectionType.MOTION,
    MinutesSectionType.PUBLIC_COMMENT,
    MinutesSectionType.EXECUTIVE_SESSION,
    MinutesSectionType.ADJOURNMENT,
    MinutesSectionType.OTHER,
  ]),
  sort_order: z.number().int().min(0),
  title: z.string().min(1).max(300),
  content_json: z.record(z.string(), z.unknown()),
  source_agenda_item_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateMinutesSectionSchema = MinutesSectionSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
