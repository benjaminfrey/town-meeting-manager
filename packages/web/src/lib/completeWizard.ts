/**
 * Wizard completion handler.
 *
 * ─── Stage 1, Task C2: this no longer talks to the database ───────────────
 *
 * It used to call `supabase.rpc("complete_onboarding", …)` straight from the
 * browser, as the signed-in user, over PostgREST. Three separate things this
 * stage has done make that impossible, and each of them alone would:
 *
 *   1. The browser has no GoTrue JWT any more, so PostgREST would run the call
 *      as `anon` and every insert would be refused by row level security.
 *   2. Task C1 removed `SECURITY DEFINER` from `complete_onboarding()`, which
 *      under FORCE RLS bought nothing but a privilege-escalation footgun. It
 *      had been masking the real defect below.
 *   3. The function inserted into `town` before any `app.town_id` existed,
 *      so its own `WITH CHECK (id = get_current_town_id())` denied it — for
 *      every role, because that is what FORCE means. It appeared to work only
 *      because the local developer's role was a superuser and the definer
 *      marking inherited the bypass.
 *
 * `POST /api/onboarding` runs Task C1's repaired version: the town id is
 * generated in application code first, `app.town_id` is set to it, and the
 * town, boards, person, `user_account`, the `auth_user_id` link and the
 * `better_auth.user_tenant` row all commit in one transaction or not at all.
 *
 * The user's email is no longer read here either. It comes from the session on
 * the server, because a contact email taken from the request body would let a
 * caller put an arbitrary address on the town's first `person` row.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Completion
 */

import type {
  WizardStage1Data,
  WizardStage2Data,
  WizardStage3Data,
  WizardStage4Data,
  WizardStage5Data,
} from "@town-meeting/shared";
import { apiJson, ApiError } from "./api-client";

interface WizardData {
  stage1: WizardStage1Data;
  stage2: WizardStage2Data;
  stage3: WizardStage3Data;
  stage4: WizardStage4Data;
  stage5: WizardStage5Data;
}

export interface CompleteWizardResult {
  townId: string;
  personId: string;
  userAccountId: string;
}

/**
 * Create all town records from wizard data in a single server transaction.
 */
export async function completeWizard(data: WizardData): Promise<CompleteWizardResult> {
  const { stage1, stage2, stage3, stage4, stage5 } = data;

  // Only the boards the user actually ticked in Stage 4.
  const additionalBoards = stage4.boards
    .filter((b) => b.checked)
    .map((b) => ({
      name: b.name,
      memberCount: b.memberCount,
      electedOrAppointed: b.electedOrAppointed,
    }));

  try {
    return await apiJson<CompleteWizardResult>("/api/onboarding", {
      method: "POST",
      json: {
        townName: stage1.townName,
        state: stage1.state,
        municipalityType: stage1.municipalityType,
        populationRange: stage1.populationRange || null,
        meetingFormality: stage5.meetingFormality,
        minutesStyle: stage5.minutesStyle,
        presidingOfficer: stage3.presidingOfficer || null,
        minutesRecorder: stage3.minutesRecorder || null,
        staffRolesPresent: stage3.staffRolesPresent || [],
        boardName: stage2.boardName,
        memberCount: stage2.memberCount,
        electionMethod: stage2.electionMethod || null,
        officerElectionMethod: stage2.officerElectionMethod || null,
        seatTitles: stage2.electionMethod === "role_titled" ? stage2.seatTitles : [],
        districtBased: stage2.districtBased,
        staggeredTerms: stage2.staggeredTerms,
        additionalBoards,
        contactName: stage1.contactName,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      // 409 is "this identity already has a town" — the server checks it and
      // the unique index on `user_account.auth_user_id` backs the check up.
      if (err.status === 409) {
        throw new Error(
          "Your account is already associated with a town. Please contact support if you " +
            "need to create a new one.",
          { cause: err },
        );
      }
      if (err.status === 401) {
        throw new Error("Your session has expired. Please sign in and try again.", {
          cause: err,
        });
      }
      throw new Error(err.message || "Setup failed. Please try again.", { cause: err });
    }
    throw err;
  }
}
