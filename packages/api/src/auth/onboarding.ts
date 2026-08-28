/**
 * Stage 1, Task C1, step 8 — onboarding, repaired.
 *
 * ─── What was broken, and why nobody noticed ──────────────────────────────
 *
 * The baseline's `complete_onboarding()` inserts into `town` before any
 * `app.town_id` exists. `town`'s policy is
 * `WITH CHECK (id = get_current_town_id())`, so under FORCE ROW LEVEL SECURITY
 * that insert is denied for every role — including the owner, which is what
 * FORCE means.
 *
 * It appeared to work in local development because the developer's role is a
 * superuser and the function was `SECURITY DEFINER`, so it inherited a
 * superuser's RLS bypass. That is the whole reason this stayed hidden, and it
 * is why `__tests__/onboarding.test.ts` runs as `tmm_app` — the role
 * production actually connects as, which has no bypass to inherit.
 *
 * ─── The working path ─────────────────────────────────────────────────────
 *
 * The town id is generated HERE, in application code, before anything touches
 * the database. `withTenant` sets `app.town_id` to it (transaction-local), and
 * only then is `complete_onboarding()` called. The `WITH CHECK` is satisfied
 * for exactly one id — the one this function committed to in advance.
 *
 * The alternative, an unconditional INSERT policy on `town`, would let any
 * authenticated session create towns at will. Generating the id first is what
 * makes town creation possible under FORCE RLS without opening that door.
 *
 * ─── Why all four writes are one transaction ──────────────────────────────
 *
 * The town, the boards, the person, the `user_account`, the identity link on
 * `user_account.auth_user_id`, and the row in `better_auth.user_tenant` all
 * commit together or not at all. Half of this is worse than none of it: a town
 * with no `user_tenant` row is a town nobody can ever sign in to, and a
 * `user_tenant` row with no `user_account` is a session that resolves to a
 * town and then throws on every request. Both are unrecoverable without
 * database surgery, and both are exactly what a partial failure would leave.
 *
 * The double-onboarding guard falls out of the same transaction. Two unique
 * constraints stand in the way — `user_account.auth_user_id`'s (which is what
 * actually fires, since the UPDATE comes first) and `better_auth.user_tenant`'s
 * primary key — and the rollback takes the half-built town with it. Both are
 * unique indexes, and unique indexes are not scoped by RLS, so they hold
 * across towns. That matters: the old in-function check
 * (`SELECT 1 FROM user_account WHERE id = ...`) runs under RLS and can only see
 * the current town, so it could never have caught a user onboarding a *second*
 * town — the only case it was there for.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "../db/with-tenant.js";
import type { TenantResolverDb } from "./tenant-context.js";

export interface OnboardingInput {
  /** The Better Auth user id this town's first admin signs in as. */
  authUserId: string;
  townName: string;
  state?: string;
  municipalityType?: string;
  populationRange?: string | null;
  meetingFormality?: string;
  minutesStyle?: string;
  presidingOfficer?: string | null;
  minutesRecorder?: string | null;
  staffRolesPresent?: unknown[];
  boardName?: string;
  memberCount?: number | null;
  electionMethod?: string | null;
  officerElectionMethod?: string | null;
  seatTitles?: unknown[];
  districtBased?: boolean;
  staggeredTerms?: boolean;
  additionalBoards?: unknown[];
  contactName?: string | null;
  contactEmail?: string | null;
}

export interface OnboardingResult {
  townId: string;
  personId: string;
  userAccountId: string;
}

export async function completeOnboarding(
  db: TenantResolverDb,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  if (!input.authUserId) {
    throw new Error("completeOnboarding requires the Better Auth user id to link the new town to");
  }

  // Generated before the transaction opens. This is the fix: the tenant
  // context has to exist before the row does, so the id cannot come from the
  // insert that needs it.
  const townId = randomUUID();
  const personId = randomUUID();
  const userAccountId = randomUUID();

  await withTenant(db, { townId }, async (tx) => {
    await tx.execute(sql`
      SELECT complete_onboarding(
        ${townId}::uuid,
        ${personId}::uuid,
        ${userAccountId}::uuid,
        ${input.townName},
        ${input.state ?? "ME"},
        ${input.municipalityType ?? "town"},
        ${input.populationRange ?? null},
        ${input.meetingFormality ?? "semi_formal"},
        ${input.minutesStyle ?? "action"},
        ${input.presidingOfficer ?? null},
        ${input.minutesRecorder ?? null},
        ${JSON.stringify(input.staffRolesPresent ?? [])}::jsonb,
        ${input.boardName ?? "Select Board"},
        ${input.memberCount ?? null},
        ${input.electionMethod ?? null},
        ${input.officerElectionMethod ?? null},
        ${JSON.stringify(input.seatTitles ?? [])}::jsonb,
        ${input.districtBased ?? false},
        ${input.staggeredTerms ?? false},
        ${JSON.stringify(input.additionalBoards ?? [])}::jsonb,
        ${input.contactName ?? null},
        ${input.contactEmail ?? null}
      )
    `);

    // The link, in both directions. `user_account.auth_user_id` is the real
    // foreign key and is what `resolveTenant` verifies against; the
    // `user_tenant` row is the hint that lets resolution start at all. Written
    // in that order so that if the second fails, the first is rolled back with
    // it rather than leaving an account nothing points at.
    await tx.execute(sql`
      UPDATE user_account SET auth_user_id = ${input.authUserId} WHERE id = ${userAccountId}::uuid
    `);
    await tx.execute(sql`
      INSERT INTO better_auth.user_tenant (auth_user_id, town_id)
      VALUES (${input.authUserId}, ${townId}::uuid)
    `);
  });

  return { townId, personId, userAccountId };
}
