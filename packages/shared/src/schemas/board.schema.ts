import { z } from "zod";
import {
  BoardType,
  ElectionMethod,
  MeetingFormality,
  MinutesStyle,
  MotionDisplayFormat,
  OfficerElectionMethod,
  QuorumType,
} from "../constants/enums.js";

export const BoardSchema = z.object({
  id: z.string().uuid(),
  town_id: z.string().uuid(),
  name: z.string().min(2).max(100),
  board_type: z.enum([
    BoardType.SELECT_BOARD,
    BoardType.PLANNING_BOARD,
    BoardType.ZONING_BOARD,
    BoardType.BUDGET_COMMITTEE,
    BoardType.CONSERVATION_COMMISSION,
    BoardType.PARKS_RECREATION,
    BoardType.HARBOR_COMMITTEE,
    BoardType.SHELLFISH_COMMISSION,
    BoardType.CEMETERY_COMMITTEE,
    BoardType.ROAD_COMMITTEE,
    BoardType.COMP_PLAN_COMMITTEE,
    BoardType.BROADBAND_COMMITTEE,
    BoardType.OTHER,
  ]),
  elected_or_appointed: z.enum(["elected", "appointed"]).nullable(),
  member_count: z.number().int().min(0).max(25),
  election_method: z.enum([
    ElectionMethod.AT_LARGE,
    ElectionMethod.ROLE_TITLED,
  ]),
  officer_election_method: z.enum([
    OfficerElectionMethod.VOTE_OF_BOARD,
    OfficerElectionMethod.HIGHEST_VOTE_GETTER,
    OfficerElectionMethod.APPOINTED_BY_AUTHORITY,
    OfficerElectionMethod.ROTATION,
  ]),
  district_based: z.boolean(),
  staggered_terms: z.boolean(),
  is_governing_board: z.boolean(),
  meeting_formality_override: z
    .enum([
      MeetingFormality.INFORMAL,
      MeetingFormality.SEMI_FORMAL,
      MeetingFormality.FORMAL,
    ])
    .nullable(),
  minutes_style_override: z
    .enum([MinutesStyle.ACTION, MinutesStyle.SUMMARY, MinutesStyle.NARRATIVE])
    .nullable(),
  quorum_type: z
    .enum([
      QuorumType.SIMPLE_MAJORITY,
      QuorumType.TWO_THIRDS,
      QuorumType.THREE_QUARTERS,
      QuorumType.FIXED_NUMBER,
    ])
    .nullable(),
  quorum_value: z.number().int().min(1).max(25).nullable(),
  motion_display_format: z
    .enum([MotionDisplayFormat.BLOCK_FORMAT, MotionDisplayFormat.INLINE_NARRATIVE])
    .nullable(),
  created_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
});

export const CreateBoardSchema = BoardSchema.omit({
  id: true,
  created_at: true,
  archived_at: true,
});
