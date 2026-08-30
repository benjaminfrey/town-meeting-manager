/**
 * `town_notification_config` — the town's own Postmark/Twilio credentials
 * and sender settings.
 *
 * ─── Why this file exists with no caller yet ───────────────────────────
 *
 * Task 4's brief named this table as the wave's "specific hazard" and named
 * the three rules below to guard it, but none of the three screens in this
 * task's actual file list (`settings.notifications.tsx`,
 * `settings.meeting-notices.tsx`, `settings.minutes-workflow.tsx`) reads or
 * writes it — verified: `grep -rn "town_notification_config"
 * packages/web/src` matches nothing. `settings.notifications.tsx` is a
 * DIFFERENT table (`subscriber_notification_preference`, a person's own
 * notification preferences — see `notification-preference.ts`) that the
 * brief's title conflated with this one. There is also no admin-facing
 * screen ANYWHERE in the app for editing SMTP/Twilio settings today — this
 * table has been operator-configured directly since it was created.
 *
 * This router is still worth shipping now rather than left for whichever
 * wave eventually builds that screen, for the same reason
 * `town.setPortalAddress` was built ahead of the UI that calls it (D1b; see
 * that procedure's own doc comment and this wave's Task 5): the rules
 * (`assertCanSelectTownNotificationConfig` and its two siblings) already
 * exist, are already tested as pure functions
 * (`packages/api/src/trpc/__tests__/admin-gates.test.ts`), and the ONE thing
 * that actually matters here — that reading this table's credential columns
 * requires an administrator, not merely tenancy — is exactly the kind of
 * guard this phase has already shipped without once, by pattern-matching
 * `board.ts`'s "no guard, tenancy is enough" comment onto a table where it
 * is not true. Building the router properly now, with the guard verified by
 * deletion, closes that trap before a future task falls into it. See the
 * task report for the full account of why the brief's file list and its
 * rule list do not match.
 *
 * ─── Authorization ──────────────────────────────────────────────────────
 *
 * Under `town_notification_config_tenant_isolation` (`0000_baseline.sql`),
 * ANY authenticated member of the town — general staff with no permissions
 * at all — can read this table; the RLS policy is tenancy-only, the same
 * shape as `board`'s. Unlike `board`, that is not enough: this table holds
 * the town's outbound-email password. All three procedures below are
 * therefore admin-gated with `requireActor`, declared before `.input()` per
 * conventions item 2, even though `select` takes no input to guard.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, requireActor } from "../trpc.js";
import {
  assertCanSelectTownNotificationConfig,
  assertCanInsertTownNotificationConfig,
  assertCanUpdateTownNotificationConfig,
} from "../authorization/rules.js";
import { toRows } from "../../db/rows.js";

/** `HH:MM` or `HH:MM:SS`, matching the column's `time without time zone` type. */
const QUIET_HOURS_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;
const QuietHours = z.string().regex(QUIET_HOURS_REGEX, "Use 24-hour HH:MM or HH:MM:SS").nullable();

/**
 * Is this the `town_notification_config_town_id_key` collision — a second
 * `insert` for a town that already has a config row — and not some other
 * write error? Same depth-limited `cause`-chain walk as `town.ts`'s
 * `isSubdomainCollision`, for the same reason (Drizzle wraps the driver
 * error and keeps the original on `cause`).
 */
function isConfigAlreadyExistsCollision(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (e.code === "23505") {
      const constraint = e.constraint_name ?? e.constraint;
      return constraint === "town_notification_config_town_id_key" || constraint === undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The writable columns, shared by `insert` and `update`. Every field is
 * REQUIRED (though nullable) rather than defaulted: with no UI caller yet
 * (see this file's header), there is no product decision yet about what a
 * sensible default payload looks like, and a zod `.default(...)` here would
 * only paper over that. `{}` is empty as it is — required keys missing —
 * which is also what `router-wiring.test.ts`'s input-validation pin expects
 * of every mutation it lists.
 */
const ConfigFields = z.object({
  postmark_server_token_encrypted: z.string().min(1).nullable(),
  postmark_sender_email: z.string().email().nullable(),
  postmark_sender_name: z.string().min(1).max(200).nullable(),
  twilio_messaging_service_sid: z.string().min(1).nullable(),
  twilio_phone_number: z.string().min(1).nullable(),
  sms_quiet_hours_start: QuietHours,
  sms_quiet_hours_end: QuietHours,
  sms_opt_in_message: z.string().min(1).nullable(),
});

export const townNotificationConfigRouter = router({
  /**
   * The caller's own town's config row, or `null` if none has been created
   * yet. Every column, credentials included — the guard is the whole
   * protection here (see this file's header): once an admin is confirmed,
   * there is no narrower "safe" subset of this row to hand back, because an
   * admin is exactly who is trusted to see the credentials.
   */
  select: protectedProcedure
    .use(requireActor(assertCanSelectTownNotificationConfig))
    .query(async ({ ctx }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{
          id: string;
          town_id: string;
          postmark_server_token_encrypted: string | null;
          postmark_sender_email: string | null;
          postmark_sender_name: string | null;
          twilio_messaging_service_sid: string | null;
          twilio_phone_number: string | null;
          sms_quiet_hours_start: string | null;
          sms_quiet_hours_end: string | null;
          sms_opt_in_message: string | null;
          created_at: string;
          updated_at: string;
        }>(
          await tx.execute(sql`
            SELECT id, town_id, postmark_server_token_encrypted, postmark_sender_email,
              postmark_sender_name, twilio_messaging_service_sid, twilio_phone_number,
              sms_quiet_hours_start, sms_quiet_hours_end, sms_opt_in_message,
              created_at, updated_at
            FROM town_notification_config
            WHERE town_id = ${ctx.tenant.townId}
          `),
          (message) => new Error(`townNotificationConfig.select: ${message}`),
        ),
      );
      return rows[0] ?? null;
    }),

  /** Create the caller's town's config row. CONFLICT if one already exists. */
  insert: protectedProcedure
    .use(requireActor(assertCanInsertTownNotificationConfig))
    .input(ConfigFields)
    .mutation(async ({ ctx, input }) => {
      try {
        const rows = await ctx.withTenant(async (tx) =>
          toRows<{ id: string }>(
            await tx.execute(sql`
              INSERT INTO town_notification_config
                (town_id, postmark_server_token_encrypted, postmark_sender_email,
                 postmark_sender_name, twilio_messaging_service_sid, twilio_phone_number,
                 sms_quiet_hours_start, sms_quiet_hours_end, sms_opt_in_message)
              VALUES (${ctx.tenant.townId}, ${input.postmark_server_token_encrypted},
                ${input.postmark_sender_email}, ${input.postmark_sender_name},
                ${input.twilio_messaging_service_sid}, ${input.twilio_phone_number},
                ${input.sms_quiet_hours_start}::time, ${input.sms_quiet_hours_end}::time,
                ${input.sms_opt_in_message})
              RETURNING id
            `),
            (message) => new Error(`townNotificationConfig.insert: ${message}`),
          ),
        );
        return { id: rows[0]!.id, town_id: ctx.tenant.townId, ...input };
      } catch (err) {
        if (isConfigAlreadyExistsCollision(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This town already has a notification configuration. Use update instead.",
            cause: err,
          });
        }
        throw err;
      }
    }),

  /** Change the caller's town's config row. NOT_FOUND if none exists yet. */
  update: protectedProcedure
    .use(requireActor(assertCanUpdateTownNotificationConfig))
    .input(ConfigFields)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.withTenant(async (tx) =>
        toRows<{ id: string }>(
          await tx.execute(sql`
            UPDATE town_notification_config SET
              postmark_server_token_encrypted = ${input.postmark_server_token_encrypted},
              postmark_sender_email = ${input.postmark_sender_email},
              postmark_sender_name = ${input.postmark_sender_name},
              twilio_messaging_service_sid = ${input.twilio_messaging_service_sid},
              twilio_phone_number = ${input.twilio_phone_number},
              sms_quiet_hours_start = ${input.sms_quiet_hours_start}::time,
              sms_quiet_hours_end = ${input.sms_quiet_hours_end}::time,
              sms_opt_in_message = ${input.sms_opt_in_message},
              updated_at = now()
            WHERE town_id = ${ctx.tenant.townId}
            RETURNING id
          `),
          (message) => new Error(`townNotificationConfig.update: ${message}`),
        ),
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return { id: rows[0].id, town_id: ctx.tenant.townId, ...input };
    }),
});
