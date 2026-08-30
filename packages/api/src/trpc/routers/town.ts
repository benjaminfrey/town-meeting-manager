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
import {
  checkSubdomain,
  MeetingFormality,
  MinutesStyle,
  MunicipalityType,
  PopulationRange,
} from "@town-meeting/shared";
import { router, protectedProcedure } from "../trpc.js";
import { assertCanUpdateTown } from "../authorization/rules.js";
import { toRows } from "../../db/rows.js";
import { z } from "zod";

/**
 * The same character rule `TownSettingsEditor`'s own zod schema enforces
 * client-side (`packages/web/src/components/dashboard/TownSettingsEditor.tsx`).
 * Duplicated rather than imported from `@town-meeting/shared`'s
 * `WizardStage1Schema`, because that schema is camelCase-keyed
 * (`townName`, `municipalityType`) for the onboarding wizard's payload shape,
 * not this procedure's snake_case, column-named one — importing it and
 * remapping every key would trade one duplication for a worse one.
 */
const TOWN_NAME_REGEX = /^[a-zA-Z0-9\s\-'.]+$/;

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

  /**
   * The fields `TownSettingsEditor` writes — the town's identity, not its
   * meeting practice. Same admin gate as `setPortalAddress`, and the same
   * reasoning as that procedure's own doc comment for why this is a
   * dedicated procedure rather than one key in a generic "patch the town"
   * endpoint: an explicit, named set of columns means a caller cannot send
   * `{ subdomain: "..." }` through the wrong door and skip
   * `checkSubdomain`/the uniqueness constraint, and a reviewer can see
   * exactly what each screen is permitted to change.
   *
   * No `townId` input, matching `town.detail` and `setPortalAddress`: the
   * row written is always `ctx.tenant.townId`, so there is no id for a
   * caller to substitute.
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(2, "Town name must be at least 2 characters")
          .max(100, "Town name must be less than 100 characters")
          .regex(TOWN_NAME_REGEX, "Invalid characters in town name"),
        state: z.enum(["ME", "NH", "VT", "MA", "CT", "RI"]),
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
        contact_name: z.string().min(2, "Contact name must be at least 2 characters").max(100),
        contact_role: z.string().min(1, "Contact role is required").max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanUpdateTown(await ctx.actor());
      await ctx.withTenant(async (tx) => {
        await tx.execute(sql`
          UPDATE town SET
            name = ${input.name},
            state = ${input.state},
            municipality_type = ${input.municipality_type}::municipality_type,
            population_range = ${input.population_range},
            contact_name = ${input.contact_name},
            contact_role = ${input.contact_role},
            updated_at = now()
          WHERE id = ${ctx.tenant.townId}
        `);
      });
      return input;
    }),

  /**
   * The fields `MeetingDefaultsEditor` writes. Both columns are real
   * Postgres enums (`meeting_formality`, `minutes_style` — see
   * `packages/api/src/db/schema.ts`), so the cast is load-bearing: an
   * untyped string literal in the `UPDATE` would be rejected by the column
   * type, but only after the zod `z.enum` below has already narrowed the
   * input to a value that cast can never fail on — the same belt-and-braces
   * shape the client's own `MeetingDefaultsSchema` already enforces.
   */
  updateMeetingDefaults: protectedProcedure
    .input(
      z.object({
        meeting_formality: z.enum([
          MeetingFormality.INFORMAL,
          MeetingFormality.SEMI_FORMAL,
          MeetingFormality.FORMAL,
        ]),
        minutes_style: z.enum([MinutesStyle.ACTION, MinutesStyle.SUMMARY, MinutesStyle.NARRATIVE]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanUpdateTown(await ctx.actor());
      await ctx.withTenant(async (tx) => {
        await tx.execute(sql`
          UPDATE town SET
            meeting_formality = ${input.meeting_formality}::meeting_formality,
            minutes_style = ${input.minutes_style}::minutes_style,
            updated_at = now()
          WHERE id = ${ctx.tenant.townId}
        `);
      });
      return input;
    }),

  /**
   * The fields `MeetingRolesEditor` writes.
   *
   * Both columns are plain `text` in `schema.ts`, not Postgres enums — unlike
   * `meeting_formality`/`minutes_style` above, there is no database
   * constraint backing the option lists `MeetingRolesEditor` renders
   * (`PRESIDING_OFFICER_OPTIONS`, `MINUTES_RECORDER_OPTIONS`), so this
   * mirrors the client's own `MeetingRolesSchema` exactly: any non-empty
   * string, not a closed set. Narrowing this procedure to an enum the schema
   * does not enforce would be a stricter server-side rule invented rather
   * than transcribed — the thing item 2 warns against.
   */
  updateMeetingRoles: protectedProcedure
    .input(
      z.object({
        presiding_officer_default: z.string().min(1),
        minutes_recorder_default: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanUpdateTown(await ctx.actor());
      await ctx.withTenant(async (tx) => {
        await tx.execute(sql`
          UPDATE town SET
            presiding_officer_default = ${input.presiding_officer_default},
            minutes_recorder_default = ${input.minutes_recorder_default},
            updated_at = now()
          WHERE id = ${ctx.tenant.townId}
        `);
      });
      return input;
    }),

  /**
   * `RetentionPolicyModal`'s write: acknowledge the data retention policy.
   *
   * A dedicated procedure rather than a generic "set this timestamp" field
   * for the same reason `setPortalAddress` is one: this is not a preference,
   * it is a compliance acknowledgment (see the component's own `@see` to
   * `docs/advisory-resolutions/1.2`), and the server — not the caller —
   * decides the instant it happened. No input: unlike a subdomain, there is
   * nothing here for the client to supply.
   */
  acknowledgeRetentionPolicy: protectedProcedure.mutation(async ({ ctx }) => {
    assertCanUpdateTown(await ctx.actor());
    const now = new Date().toISOString();
    await ctx.withTenant(async (tx) => {
      await tx.execute(sql`
        UPDATE town SET retention_policy_acknowledged_at = ${now}, updated_at = ${now}
        WHERE id = ${ctx.tenant.townId}
      `);
    });
    return { retention_policy_acknowledged_at: now };
  }),
});
