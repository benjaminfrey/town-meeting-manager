/**
 * Zod validation schemas for the onboarding wizard stages.
 *
 * These schemas live in the shared package so they can be reused
 * server-side for validating the wizard completion payload.
 *
 * Each stage has its own schema. The wizard completion endpoint
 * validates the combined data from all stages.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md
 */

import { z } from "zod";
import {
  ElectionMethod,
  MeetingFormality,
  MinutesStyle,
  MunicipalityType,
  OfficerElectionMethod,
  PopulationRange,
} from "../constants/enums.js";

// ─── New England States ──────────────────────────────────────────────

export const NEW_ENGLAND_STATES = [
  { value: "ME", label: "Maine" },
  { value: "NH", label: "New Hampshire" },
  { value: "VT", label: "Vermont" },
  { value: "MA", label: "Massachusetts" },
  { value: "CT", label: "Connecticut" },
  { value: "RI", label: "Rhode Island" },
] as const;

export type NewEnglandStateCode = (typeof NEW_ENGLAND_STATES)[number]["value"];

// ─── Stage 1 — Your Town ────────────────────────────────────────────

/**
 * Allowed characters in a town name: letters, numbers, spaces,
 * hyphens, apostrophes, and periods.
 * Handles names like "Isle au Haut", "St. George", "O'Brien".
 */
const TOWN_NAME_REGEX = /^[a-zA-Z0-9\s\-'.]+$/;

export const WizardStage1Schema = z.object({
  townName: z
    .string()
    .min(2, "Town name must be at least 2 characters")
    .max(100, "Town name must be less than 100 characters")
    .regex(
      TOWN_NAME_REGEX,
      "Town name can only contain letters, numbers, spaces, hyphens, apostrophes, and periods"
    ),
  state: z.enum(["ME", "NH", "VT", "MA", "CT", "RI"]),
  municipalityType: z.enum([
    MunicipalityType.TOWN,
    MunicipalityType.CITY,
    MunicipalityType.PLANTATION,
  ]),
  populationRange: z.enum([
    PopulationRange.UNDER_1000,
    PopulationRange.FROM_1000_TO_2500,
    PopulationRange.FROM_2500_TO_5000,
    PopulationRange.FROM_5000_TO_10000,
    PopulationRange.OVER_10000,
  ]),
  contactName: z
    .string()
    .min(2, "Contact name must be at least 2 characters")
    .max(100, "Contact name must be less than 100 characters"),
  contactRole: z
    .string()
    .min(1, "Contact role is required")
    .max(100, "Contact role must be less than 100 characters"),
});

export type WizardStage1Data = z.infer<typeof WizardStage1Schema>;

// ─── Stage 2 — Governing Board ──────────────────────────────────────

export const WizardStage2Schema = z.object({
  boardName: z
    .string()
    .min(2, "Board name must be at least 2 characters")
    .max(100, "Board name must be less than 100 characters"),
  memberCount: z.number().int().min(0).max(15),
  electionMethod: z.enum([ElectionMethod.AT_LARGE, ElectionMethod.ROLE_TITLED]),
  seatTitles: z.array(z.string().min(2).max(50)),
  officerElectionMethod: z.enum([
    OfficerElectionMethod.VOTE_OF_BOARD,
    OfficerElectionMethod.HIGHEST_VOTE_GETTER,
    OfficerElectionMethod.APPOINTED_BY_AUTHORITY,
    OfficerElectionMethod.ROTATION,
  ]),
  districtBased: z.boolean(),
  staggeredTerms: z.boolean(),
});

export type WizardStage2Data = z.infer<typeof WizardStage2Schema>;

// ─── Stage 3 — Meeting Roles ────────────────────────────────────────

export const WizardStage3Schema = z.object({
  presidingOfficer: z.string().min(1),
  minutesRecorder: z.string().min(1),
  staffRolesPresent: z.array(z.string()),
});

export type WizardStage3Data = z.infer<typeof WizardStage3Schema>;

// ─── Stage 4 — Boards & Committees ──────────────────────────────────

export const WizardBoardEntrySchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(100),
  memberCount: z.number().int().min(0).max(25),
  electedOrAppointed: z.enum(["elected", "appointed"]),
  isCustom: z.boolean(),
  checked: z.boolean(),
});

export const WizardStage4Schema = z.object({
  boards: z.array(WizardBoardEntrySchema),
});

export type WizardBoardEntry = z.infer<typeof WizardBoardEntrySchema>;
export type WizardStage4Data = z.infer<typeof WizardStage4Schema>;

// ─── Stage 5 — Meeting Style ────────────────────────────────────────

export const WizardStage5Schema = z.object({
  meetingFormality: z.enum([
    MeetingFormality.INFORMAL,
    MeetingFormality.SEMI_FORMAL,
    MeetingFormality.FORMAL,
  ]),
  minutesStyle: z.enum([
    MinutesStyle.ACTION,
    MinutesStyle.SUMMARY,
    MinutesStyle.NARRATIVE,
  ]),
});

export type WizardStage5Data = z.infer<typeof WizardStage5Schema>;

// ─── Combined wizard payload ─────────────────────────────────────────

export const WizardCompletionSchema = z.object({
  stage1: WizardStage1Schema,
  stage2: WizardStage2Schema,
  stage3: WizardStage3Schema,
  stage4: WizardStage4Schema,
  stage5: WizardStage5Schema,
});

export type WizardCompletionData = z.infer<typeof WizardCompletionSchema>;
