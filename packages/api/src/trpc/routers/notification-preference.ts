/**
 * `settings.notifications.tsx`'s router — a person's own notification
 * preferences (`subscriber_notification_preference`), read and written by
 * themselves. Not `town_notification_config` (the town's SMTP/Twilio
 * credentials) — that is a different table with a different router
 * (`town-notification-config.ts`); see this task's report for how the two
 * got conflated in the brief and why this file exists instead.
 *
 * ─── Authorization ──────────────────────────────────────────────────────
 *
 * Neither procedure below carries an `assertCan*` guard, and that is
 * deliberate rather than an oversight — but for a DIFFERENT reason than
 * `board.ts`'s "no guard" reads. Those are tenancy-only: any authenticated
 * member of the town may see the row, and RLS alone already enforces that.
 * `subscriber_notification_preference_tenant_isolation` (`0000_baseline.sql`)
 * is ALSO tenancy-only — `town_id = get_current_town_id()`, nothing more —
 * but the product's intent for this table is narrower than the RLS policy:
 * each person manages only their OWN preferences, and RLS has no notion of
 * "own" here. Left unguarded by an application-level check, any signed-in
 * member of a town could read or silently rewrite another member's
 * notification preferences merely by supplying a different `person_id` —
 * except there IS no such input on either procedure below. `mine` reads
 * `WHERE person_id = ctx.tenant.personId`, and `setMine` always writes
 * `person_id = ctx.tenant.personId`, both taken from the caller's own bridged
 * session rather than from the request body. The scoping is enforced by
 * construction — there is no `personId` field a caller could substitute —
 * which is a stronger guarantee than a runtime `assertCan*` check would add
 * on top of it, and does not need a new authorization rule invented for a
 * self-service action nothing in `rules.ts` treats as one.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { NotificationChannel } from "@town-meeting/shared";
import { router, protectedProcedure } from "../trpc.js";
import { toRows } from "../../db/rows.js";

export const notificationPreferenceRouter = router({
  /**
   * The caller's own preferences, every channel and event type they have an
   * explicit row for. `settings.notifications.tsx` treats an event type with
   * no row as "enabled" (opt-out model) — that default lives in the
   * component, not here, matching the Supabase-backed version this replaces.
   */
  mine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.withTenant(async (tx) =>
      toRows<{ event_type: string; channel: string; enabled: boolean }>(
        await tx.execute(sql`
          SELECT event_type, channel, enabled
          FROM subscriber_notification_preference
          WHERE person_id = ${ctx.tenant.personId}
        `),
        (message) => new Error(`notificationPreference.mine: ${message}`),
      ),
    );
  }),

  /**
   * Set (or change) one of the caller's own preferences. `event_type` is a
   * free-text column in the schema (no Postgres enum backs it — see
   * `subscriber_notification_preference.event_type` in `db/schema.ts`), so
   * this does not narrow it to the seven values
   * `settings.notifications.tsx`'s `NOTIFICATION_SETTINGS` renders today;
   * doing so would reject a value the database itself accepts, which is the
   * over-narrowing conventions item 2 warns against for
   * `updateMeetingRoles`'s free-text fields.
   *
   * `ON CONFLICT` targets `subscriber_pref_unique`
   * (`person_id, channel, event_type`) — the same tuple the Supabase-backed
   * version's `onConflict: "person_id,channel,event_type"` named.
   */
  setMine: protectedProcedure
    .input(
      z.object({
        event_type: z.string().min(1).max(100),
        channel: z.enum([NotificationChannel.EMAIL, NotificationChannel.SMS]),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.withTenant(async (tx) => {
        await tx.execute(sql`
          INSERT INTO subscriber_notification_preference
            (person_id, town_id, channel, event_type, enabled)
          VALUES (${ctx.tenant.personId}, ${ctx.tenant.townId},
                  ${input.channel}::notification_channel, ${input.event_type}, ${input.enabled})
          ON CONFLICT (person_id, channel, event_type)
          DO UPDATE SET enabled = excluded.enabled
        `);
      });
      return input;
    }),
});
