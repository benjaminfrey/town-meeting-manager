/**
 * Wizard completion handler.
 *
 * Calls the `complete_onboarding` RPC function which creates all
 * records (town, boards, person, user_account) in a single
 * SECURITY DEFINER transaction, bypassing RLS.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Completion
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WizardStage1Data,
  WizardStage2Data,
  WizardStage3Data,
  WizardStage4Data,
  WizardStage5Data,
} from "@town-meeting/shared";

interface WizardData {
  stage1: WizardStage1Data;
  stage2: WizardStage2Data;
  stage3: WizardStage3Data;
  stage4: WizardStage4Data;
  stage5: WizardStage5Data;
}

/**
 * Create all town records from wizard data via a single RPC call.
 */
export async function completeWizard(
  data: WizardData,
  supabase: SupabaseClient
): Promise<void> {
  const { stage1, stage2, stage3, stage4, stage5 } = data;

  // Get the current user (for email)
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error("Not authenticated. Please sign in and try again.");
  }

  // Build additional boards array (only checked boards from Stage 4)
  const additionalBoards = stage4.boards
    .filter((b) => b.checked)
    .map((b) => ({
      name: b.name,
      memberCount: b.memberCount,
      electedOrAppointed: b.electedOrAppointed,
    }));

  const { error } = await supabase.rpc("complete_onboarding", {
    // Town fields
    p_town_name: stage1.townName,
    p_state: stage1.state,
    p_municipality_type: stage1.municipalityType,
    p_population_range: stage1.populationRange || null,
    p_meeting_formality: stage5.meetingFormality,
    p_minutes_style: stage5.minutesStyle,
    p_presiding_officer: stage3.presidingOfficer || null,
    p_minutes_recorder: stage3.minutesRecorder || null,
    p_staff_roles_present: stage3.staffRolesPresent || [],
    // Governing board fields
    p_board_name: stage2.boardName,
    p_member_count: stage2.memberCount,
    p_election_method: stage2.electionMethod || null,
    p_officer_election_method: stage2.officerElectionMethod || null,
    p_seat_titles:
      stage2.electionMethod === "role_titled" ? stage2.seatTitles : [],
    p_district_based: stage2.districtBased,
    p_staggered_terms: stage2.staggeredTerms,
    // Additional boards
    p_additional_boards: additionalBoards,
    // Person fields
    p_contact_name: stage1.contactName,
    p_contact_email: user.email || null,
  });

  if (error) {
    if (error.message?.includes("already belongs to a town")) {
      throw new Error(
        "Your account is already associated with a town. Please contact support if you need to create a new one."
      );
    }
    if (error.code === "23505") {
      throw new Error(
        "A town with this name already exists. Please go back to Step 1 and choose a different name."
      );
    }
    throw new Error(error.message || "Setup failed. Please try again.");
  }
}
