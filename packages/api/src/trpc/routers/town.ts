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
