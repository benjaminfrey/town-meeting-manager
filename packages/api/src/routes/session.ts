/**
 * Stage 1, Task C2 — the two routes an identity with no town can reach.
 *
 * ─── Why these exist ──────────────────────────────────────────────────────
 *
 * Until this task the web client learned who it was by base64-decoding the
 * Supabase access token and reading custom claims that
 * `custom_access_token_hook()` injected. Phase B deleted GoTrue and that hook
 * with it, so there is no token to decode and no claims to read. `town_id`,
 * `role`, `person_id`, `gov_title` and `permissions` have to come from
 * somewhere, and the only correct somewhere is the database, read through row
 * level security, which is exactly what the tenant bridge already does.
 *
 *   GET  /api/me         — who am I, and do I have a town?
 *   POST /api/onboarding — create the town I do not have.
 *
 * ─── Why `GET /api/me` answers rather than refuses when there is no town ──
 *
 * The client's very first decision after sign-in is between the dashboard and
 * the onboarding wizard, and it cannot make that decision from a 403: a 403 is
 * also what a deleted account and a broken mapping produce. So this route is
 * marked `SESSION_WITHOUT_TENANT` and reports `townId: null` as DATA. The
 * client then routes to `/setup` deliberately instead of inferring intent from
 * an error status.
 *
 * The relaxation is on the tenant half only. A session is still required —
 * `auth/fastify.ts` checks it before this marker is ever consulted — and with
 * no tenant there is no `request.withTenant`, so this handler has no database
 * access at all in that state. It returns what the session itself says and
 * nothing more.
 *
 * ─── `id` is `user_account.id`, not the auth provider's user id ───────────
 *
 * The old JWT-derived `CurrentUser.id` was the GoTrue auth user id, and
 * `components/meetings/CreateMeetingDialog.tsx` wrote it straight into
 * `meeting.created_by`, which is a foreign key to `user_account(id)`. That
 * worked only while the two ids happened to coincide. Task G1 made the same
 * correction on `request.user.id` for identical reasons; this is the client
 * half of it. `authUserId` is reported separately, for the rare caller that
 * genuinely wants the identity rather than the account.
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { SESSION_WITHOUT_TENANT } from "../auth/route-access.js";
import { toRows } from "../db/rows.js";
import { completeOnboarding } from "../auth/onboarding.js";

interface IdentityRow {
  id: string;
  person_id: string | null;
  role: string;
  gov_title: string | null;
  permissions: unknown;
  email: string | null;
  person_email: string | null;
}

/**
 * The onboarding payload.
 *
 * Validated here rather than trusted, because before this task the wizard
 * called `complete_onboarding()` straight from the browser over PostgREST —
 * every argument arriving unchecked at a SQL function. Unknown keys are
 * stripped by Zod's default object behaviour, so a client cannot smuggle an
 * `authUserId` past the one the session supplies.
 */
const onboardingSchema = z.object({
  townName: z.string().trim().min(1).max(200),
  state: z.string().trim().min(1).max(2).optional(),
  municipalityType: z.string().trim().min(1).max(50).optional(),
  populationRange: z.string().trim().max(50).nullish(),
  meetingFormality: z.string().trim().max(50).optional(),
  minutesStyle: z.string().trim().max(50).optional(),
  presidingOfficer: z.string().trim().max(200).nullish(),
  minutesRecorder: z.string().trim().max(200).nullish(),
  staffRolesPresent: z.array(z.unknown()).max(50).optional(),
  boardName: z.string().trim().max(200).optional(),
  memberCount: z.number().int().min(1).max(200).nullish(),
  electionMethod: z.string().trim().max(50).nullish(),
  officerElectionMethod: z.string().trim().max(50).nullish(),
  seatTitles: z.array(z.unknown()).max(200).optional(),
  districtBased: z.boolean().optional(),
  staggeredTerms: z.boolean().optional(),
  additionalBoards: z.array(z.unknown()).max(50).optional(),
  contactName: z.string().trim().max(200).nullish(),
});

export async function sessionRoutes(app: FastifyInstance) {
  // ── GET /api/me ──────────────────────────────────────────────────
  //
  // Replaces JWT claim decoding in `packages/web/src/hooks/useCurrentUser.ts`.

  app.get("/me", { config: { ...SESSION_WITHOUT_TENANT } }, async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) {
      // Unreachable: the gate sets this on every request that got past the
      // session check, and this route is not public. Refusing rather than
      // asserting, because an `!` here would turn a future wiring mistake into
      // an anonymous 200 rather than a 401.
      return reply.unauthorized("Not authenticated");
    }

    const base = {
      authUserId: authUser.id,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
    };

    const runInTenant = request.withTenant;
    if (!request.tenant || !runInTenant) {
      // Signed in, belongs to no town. Data, not an error — see the header.
      return reply.send({
        ...base,
        id: null,
        personId: null,
        townId: null,
        role: null,
        govTitle: null,
        permissions: null,
      });
    }

    const tenant = request.tenant;
    const rows = await runInTenant(async (tx) =>
      toRows<IdentityRow>(
        await tx.execute(sql`
          SELECT ua.id,
                 ua.person_id,
                 ua.role::text AS role,
                 ua.gov_title,
                 ua.permissions,
                 ua.email,
                 p.email AS person_email
          FROM user_account ua
          JOIN person p ON p.id = ua.person_id
          WHERE ua.id = ${tenant.userAccountId}
            AND ua.archived_at IS NULL
        `),
        (message) => new Error(`GET /api/me: ${message}`),
      ),
    );

    if (rows.length !== 1) {
      // `resolveTenant` proved exactly one live account existed moments ago,
      // so zero rows means it was archived in between. Refuse rather than
      // reporting a townless identity, which the client would answer by
      // sending an already-onboarded user back into the wizard.
      request.log.error(
        { userAccountId: tenant.userAccountId, townId: tenant.townId, found: rows.length },
        "GET /api/me found no live user_account for an already-resolved tenant",
      );
      return reply.unauthorized("Your account is no longer active.");
    }

    const row = rows[0]!;
    return reply.send({
      ...base,
      id: String(row.id),
      personId: row.person_id === null ? null : String(row.person_id),
      email: row.email ?? row.person_email ?? authUser.email,
      townId: tenant.townId,
      role: row.role,
      govTitle: row.gov_title,
      permissions: row.permissions ?? null,
    });
  });

  // ── POST /api/onboarding ─────────────────────────────────────────
  //
  // ─── What this replaces, and why it could not stay in the browser ─────
  //
  // `packages/web/src/lib/completeWizard.ts` called
  // `supabase.rpc("complete_onboarding", …)` directly, as the signed-in user,
  // over PostgREST. That path depended on three things this stage has removed
  // or refuted: a GoTrue JWT the browser no longer has; `SECURITY DEFINER` on
  // the function, which Task C1 removed because under FORCE RLS it bought
  // nothing but a privilege-escalation footgun; and the town id being chosen
  // by the INSERT that needed it, which is the bug C1's `completeOnboarding`
  // exists to fix (the id must exist before `app.town_id` can be set to it).
  //
  // So the wizard posts here, and the server runs C1's transaction.

  app.post("/onboarding", { config: { ...SESSION_WITHOUT_TENANT } }, async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.unauthorized("Not authenticated");

    // Already onboarded. Caught here rather than left to the unique index so
    // the answer is 409 with a sentence, not 500 with a constraint name — and
    // so a double-submitted wizard form does not half-build a second town
    // before rolling it back.
    if (request.tenant) {
      return reply.conflict(
        "This account already belongs to a town. Reload the application; " +
          "there is nothing to set up.",
      );
    }

    const parsed = onboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest(
        `Invalid onboarding data: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}`,
      );
    }

    try {
      const result = await completeOnboarding(app.tenantDb, {
        ...parsed.data,
        authUserId: authUser.id,
        // Never taken from the body. The contact email IS the identity's
        // email, and letting the client name a different one would put an
        // arbitrary address on the town's first `person` row.
        contactEmail: authUser.email,
      });
      return reply.status(201).send(result);
    } catch (err) {
      // The unique index on `user_account.auth_user_id` is what actually
      // stands between one identity and two towns; the check above is a
      // courtesy. Both halves are needed: the check cannot see a request that
      // is in flight concurrently, and the index cannot produce a readable
      // message.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("user_account_auth_user_id_key") || message.includes("user_tenant")) {
        request.log.warn(
          { err, authUserId: authUser.id },
          "onboarding refused: this identity already belongs to a town",
        );
        return reply.conflict("This account already belongs to a town.");
      }
      throw err;
    }
  });
}
