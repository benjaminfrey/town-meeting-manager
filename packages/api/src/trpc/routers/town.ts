/**
 * Stage 1, Task D1b — the town's portal address, and how it gets set.
 *
 * ─── The gap this closes ──────────────────────────────────────────────────
 *
 * `town.subdomain` is what the public portal is served from. Before this
 * router, its ONLY writes anywhere in the repository were in test fixtures.
 * `packages/web/src/routes/settings.town.tsx` displays it,
 * `components/dashboard/ProgressChecklist.tsx` shows "Set public portal
 * subdomain" as an outstanding onboarding step, and no code path could ever
 * complete that step. So in any real deployment the column is NULL, no
 * subdomain resolves to a town, and the portal cannot serve anybody —
 * including all of D1b's tenant work, which is keyed on exactly this value.
 *
 * ─── Why it is a procedure of its own and not a field on a town update ────
 *
 * Every other field on `town` is a preference. This one is an ADDRESS: it goes
 * into DNS, into printed meeting notices, into search-engine indexes, and —
 * since D1b — it is the tenant selector for every unauthenticated portal
 * request. Changing it silently retires the town's existing public URLs.
 * Giving it its own procedure means the validation, the uniqueness failure and
 * (in time) any "are you sure" live in one place a reviewer can find, instead
 * of being one key in a generic patch object.
 *
 * ─── Authorization ────────────────────────────────────────────────────────
 *
 * `assertCanUpdateTown` — the existing admin gate restored in D1, which is
 * `AND is_admin()` as the policy had it. No new permission code is invented:
 * this is the town's profile, and the product has always said an administrator
 * owns that.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkSubdomain } from "@town-meeting/shared";
import { router, protectedProcedure } from "../trpc.js";
import { assertCanUpdateTown } from "../authorization/rules.js";
import { toRows } from "../../db/rows.js";
import { z } from "zod";

/**
 * Is this the `town_subdomain_key` collision, and not some other write error?
 *
 * Checked by constraint name rather than by the SQLSTATE alone: `23505` on
 * this statement could in principle come from another unique index, and
 * telling a clerk "that address is taken" when it is not would send them
 * renaming their town for no reason. Anything unrecognised is re-thrown, so an
 * unexpected failure surfaces as a 500 instead of being absorbed into a
 * plausible-sounding message — which is the failure mode that makes a real bug
 * look like a user error for months.
 */
function isSubdomainCollision(err: unknown): boolean {
  // Walk the `cause` chain. Drizzle wraps a driver failure in its own
  // `DrizzleQueryError` and keeps the original on `cause`, so looking only at
  // the top-level error sees no SQLSTATE at all and reports every collision as
  // a 500 — which is exactly what the first version of this function did, and
  // is why the test asserts the CODE rather than that something was thrown.
  // Depth-limited because `cause` chains can be cyclic.
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (e.code === "23505") {
      const constraint = e.constraint_name ?? e.constraint;
      return constraint === "town_subdomain_key" || constraint === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export const townRouter = router({
  /**
   * The town's own profile and configuration, for the caller's own town.
   *
   * No permission guard, deliberately, for the same reason `board.ts` gives:
   * `settings.town.tsx` (the "Town Profile" screen) carried a pure tenancy
   * policy and nothing else — any authenticated member of a town could view
   * it. `protectedProcedure` + `ctx.withTenant` IS that policy, and there is
   * no `townId` input to guard in the first place: the row resolved is always
   * `ctx.tenant.townId`, never a caller-supplied id, so this procedure cannot
   * be asked about another town's row at all.
   *
   * Column list checked against every consumer of the row, not just the
   * route's own JSX — conventions item 10, after Task 4's `board.town_id`
   * regression:
   *
   *   - `settings.town.tsx`'s own `const t = { ... }` mapping and the
   *     `STAFF_ROLE_LABELS` / `ProgressChecklist` reads built from it;
   *   - the `initial` prop built for `<TownSettingsEditor>` (name, state,
   *     municipality_type, population_range, contact_name, contact_role);
   *   - the `initial` prop built for `<MeetingDefaultsEditor>`
   *     (meeting_formality, minutes_style);
   *   - the `initial` prop built for `<MeetingRolesEditor>`
   *     (presiding_officer_default, minutes_recorder_default);
   *   - `<RetentionPolicyModal>`, which takes only `townId` and writes
   *     `retention_policy_acknowledged_at` — it reads no town column itself,
   *     but that column is still selected here because the route's own
   *     `ProgressChecklist` prop and settings-row summary read it back.
   *
   * Every name above checked against `packages/api/src/db/schema.ts`'s
   * `town` table — none renamed or missing. Not `SELECT *`, for the same
   * reason `board.detail` is not: a dropped column fails here, at the query,
   * instead of silently producing `undefined` inside a settings form.
   *
   * Deliberately excluded because nothing on this screen or its four child
   * editors reads them today: `created_at`, `updated_at`,
   * `audio_retention_policy`, `auto_publish_on_approval`,
   * `minutes_review_window_days` (the last three belong to the not-yet-built
   * minutes-workflow settings page — conventions item 11 tracks that gap
   * elsewhere, not here, since no procedure exists for that screen yet). Add
   * any of these back the day something reads them.
   */
  detail: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{
        id: string;
        name: string;
        state: string;
        municipality_type: string;
        population_range: string | null;
        contact_name: string | null;
        contact_role: string | null;
        meeting_formality: string;
        minutes_style: string;
        presiding_officer_default: string | null;
        minutes_recorder_default: string | null;
        staff_roles_present: unknown | null;
        subdomain: string | null;
        seal_url: string | null;
        retention_policy_acknowledged_at: string | null;
        minutes_workflow_configured_at: string | null;
      }>(
        await tx.execute(sql`
          SELECT
            id, name, state, municipality_type, population_range, contact_name,
            contact_role, meeting_formality, minutes_style, presiding_officer_default,
            minutes_recorder_default, staff_roles_present, subdomain, seal_url,
            retention_policy_acknowledged_at, minutes_workflow_configured_at
          FROM town WHERE id = ${ctx.tenant.townId}
        `),
        (message) => new Error(`town.detail: ${message}`),
      ),
    );
    const row = rows[0];
    // Not expected in ordinary operation — `ctx.tenant.townId` comes from the
    // caller's own bridged session, not from input — but a town row that
    // vanished out from under a live session is still better answered as
    // NOT_FOUND than as a thrown TypeError on `row.name`.
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    return row;
  }),

  /**
   * The town's current portal address, or `null` if it has never been set.
   *
   * Read through the tenant context, so it answers for the caller's own town
   * and cannot be asked about another's.
   */
  portalAddress: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{ subdomain: string | null }>(
        await tx.execute(sql`SELECT subdomain FROM town WHERE id = ${ctx.tenant.townId}`),
        (message) => new Error(`town.portalAddress: ${message}`),
      ),
    );
    return { subdomain: rows[0]?.subdomain ?? null };
  }),

  /**
   * Set (or change) the town's portal address.
   *
   * Three distinguishable outcomes, and none of them is a 500:
   *
   *   - the value is not a usable DNS label, or is one of this deployment's
   *     reserved hostnames  → BAD_REQUEST carrying the reason;
   *   - another town already holds it                → CONFLICT;
   *   - the caller is not an administrator           → FORBIDDEN, from the
   *     shared gate, with its own message.
   *
   * The uniqueness check is the DATABASE's, not a `SELECT … WHERE subdomain =`
   * before the write. A read-then-write is a race with any concurrent
   * onboarding, and `town_subdomain_key` would catch it anyway — as a 500,
   * after the check had already said the name was free. Letting the constraint
   * be the check means the answer is the constraint's answer.
   */
  setPortalAddress: protectedProcedure
    .input(z.object({ subdomain: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertCanUpdateTown(await ctx.actor());

      const checked = checkSubdomain(input.subdomain);
      if (!checked.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: checked.message });
      }

      try {
        await ctx.withTenant(async (tx) => {
          await tx.execute(sql`
            UPDATE town SET subdomain = ${checked.subdomain}, updated_at = now()
            WHERE id = ${ctx.tenant.townId}
          `);
        });
      } catch (err) {
        if (isSubdomainCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              `The portal address "${checked.subdomain}" is already in use by another ` +
              "town. Portal addresses are shared across every town on this system, so " +
              "each one has to be unique — try adding the state or the county, for " +
              "example.",
            cause: err,
          });
        }
        throw err;
      }

      return { subdomain: checked.subdomain };
    }),
});
