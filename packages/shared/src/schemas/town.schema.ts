import { z } from "zod";
import {
  MeetingFormality,
  MinutesStyle,
  MunicipalityType,
  PopulationRange,
} from "../constants/enums.js";

export const TownSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100),
  state: z.string().length(2),
  municipality_type: z.enum([
    MunicipalityType.TOWN,
    MunicipalityType.CITY,
    MunicipalityType.PLANTATION,
  ]),
  population_range: z.enum([
    PopulationRange.UNDER_1000,
    PopulationRange.FROM_1000_TO_2500,
    PopulationRange.FROM_2500_TO_5000,
    PopulationRange.FROM_5000_TO_10000,
    PopulationRange.OVER_10000,
  ]),
  contact_name: z.string().min(2).max(100),
  contact_role: z.string().min(2).max(100),
  meeting_formality: z.enum([
    MeetingFormality.INFORMAL,
    MeetingFormality.SEMI_FORMAL,
    MeetingFormality.FORMAL,
  ]),
  minutes_style: z.enum([
    MinutesStyle.ACTION,
    MinutesStyle.SUMMARY,
    MinutesStyle.NARRATIVE,
  ]),
  presiding_officer_default: z.string().max(100),
  minutes_recorder_default: z.string().max(100),
  subdomain: z.string().max(50).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateTownSchema = TownSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  subdomain: true,
});
