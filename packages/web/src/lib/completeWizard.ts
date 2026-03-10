/**
 * Wizard completion handler.
 *
 * Takes the full wizard state and creates all records via a single
 * Supabase RPC call (server-side transaction). Falls back to direct
 * PostgREST inserts if the RPC is not yet deployed.
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
 * Create all town records from wizard data in a single transaction.
 *
 * TODO: Replace with server-side Edge Function transaction when deployed.
 * Currently uses direct PostgREST calls wrapped in try/catch.
 */
export async function completeWizard(
  data: WizardData,
  supabase: SupabaseClient
): Promise<void> {
  const { stage1, stage2, stage3, stage4, stage5 } = data;

  // Get the current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error("Not authenticated. Please sign in and try again.");
  }

  // 1. Create the town
  const { data: town, error: townError } = await supabase
    .from("towns")
    .insert({
      name: stage1.townName,
      state: stage1.state,
      municipality_type: stage1.municipalityType,
      population_range: stage1.populationRange,
      meeting_formality: stage5.meetingFormality,
      minutes_style: stage5.minutesStyle,
      presiding_officer_default: stage3.presidingOfficer,
      minutes_recorder_default: stage3.minutesRecorder,
      staff_roles_present: stage3.staffRolesPresent,
    })
    .select("id")
    .single();

  if (townError) {
    if (townError.code === "23505") {
      throw new Error(
        "A town with this name already exists. Please go back to Step 1 and choose a different name."
      );
    }
    throw new Error(townError.message || "Failed to create town record.");
  }

  const townId = town.id;

  // 2. Create the governing board (from Stage 2)
  const { error: govBoardError } = await supabase.from("boards").insert({
    town_id: townId,
    name: stage2.boardName,
    member_count: stage2.memberCount,
    election_method: stage2.electionMethod,
    officer_election_method: stage2.officerElectionMethod,
    is_governing_board: true,
    seat_titles: stage2.electionMethod === "role_titled" ? stage2.seatTitles : [],
    district_based: stage2.districtBased,
    staggered_terms: stage2.staggeredTerms,
  });

  if (govBoardError) {
    throw new Error(govBoardError.message || "Failed to create governing board.");
  }

  // 3. Create additional boards (from Stage 4 — only checked boards)
  const checkedBoards = stage4.boards.filter((b) => b.checked);
  if (checkedBoards.length > 0) {
    const { error: boardsError } = await supabase.from("boards").insert(
      checkedBoards.map((b) => ({
        town_id: townId,
        name: b.name,
        member_count: b.memberCount,
        elected_or_appointed: b.electedOrAppointed,
        is_governing_board: false,
      }))
    );

    if (boardsError) {
      throw new Error(boardsError.message || "Failed to create additional boards.");
    }
  }

  // 4. Create person record and link user account to town
  const { error: personError } = await supabase.from("persons").insert({
    id: user.id,
    display_name: stage1.contactName,
    email: user.email,
    title: stage1.contactRole,
    town_id: townId,
  });

  if (personError && personError.code !== "23505") {
    // Ignore unique constraint (person may already exist from auth trigger)
    throw new Error(personError.message || "Failed to create person record.");
  }

  // 5. Update or create user_account with town_id
  const { error: accountError } = await supabase
    .from("user_accounts")
    .upsert(
      {
        id: user.id,
        person_id: user.id,
        town_id: townId,
        role: "admin",
      },
      { onConflict: "id" }
    );

  if (accountError) {
    throw new Error(accountError.message || "Failed to link user to town.");
  }
}
