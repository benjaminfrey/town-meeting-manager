import { z } from "zod";
import {
  AgendaItemSectionType,
  AgendaItemStatus,
  MinutesBehavior,
} from "../constants/enums.js";

const agendaItemSectionTypes = [
  AgendaItemSectionType.CEREMONIAL,
  AgendaItemSectionType.PROCEDURAL,
  AgendaItemSectionType.MINUTES_APPROVAL,
  AgendaItemSectionType.FINANCIAL,
  AgendaItemSectionType.PUBLIC_INPUT,
  AgendaItemSectionType.REPORT,
  AgendaItemSectionType.ACTION,
  AgendaItemSectionType.DISCUSSION,
  AgendaItemSectionType.PUBLIC_HEARING,
  AgendaItemSectionType.EXECUTIVE_SESSION,
  AgendaItemSectionType.OTHER,
] as const;

export const AgendaItemSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  town_id: z.string().uuid(),
  section_type: z.enum(agendaItemSectionTypes),
  sort_order: z.number().int().min(0),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable(),
  presenter: z.string().max(100).nullable(),
  estimated_duration: z.number().int().min(1).max(480).nullable(),
  parent_item_id: z.string().uuid().nullable(),
  status: z.enum([
    AgendaItemStatus.PENDING,
    AgendaItemStatus.ACTIVE,
    AgendaItemStatus.COMPLETED,
    AgendaItemStatus.TABLED,
    AgendaItemStatus.DEFERRED,
  ]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateAgendaItemSchema = AgendaItemSchema.omit({
  id: true,
  status: true,
  created_at: true,
  updated_at: true,
});

const minutesBehaviors = [
  MinutesBehavior.SKIP,
  MinutesBehavior.TIMESTAMP_ONLY,
  MinutesBehavior.ACTION_ONLY,
  MinutesBehavior.SUMMARIZE,
  MinutesBehavior.FULL_RECORD,
] as const;

export const AgendaTemplateSectionSchema = z.object({
  title: z.string().min(1).max(200),
  sort_order: z.number().int().min(0),
  section_type: z.enum(agendaItemSectionTypes),
  is_fixed: z.boolean(),
  description: z.string().max(500).nullable(),
  default_items: z.array(z.string().max(300)),
  minutes_behavior: z.enum(minutesBehaviors),
  show_item_commentary: z.boolean().default(false),
});

export const AgendaTemplateSchema = z.object({
  id: z.string().uuid(),
  board_id: z.string().uuid(),
  town_id: z.string().uuid(),
  name: z.string().min(2).max(100),
  is_default: z.boolean(),
  sections: z.array(AgendaTemplateSectionSchema),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateAgendaTemplateSchema = AgendaTemplateSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
