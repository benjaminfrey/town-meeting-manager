/**
 * Push notification dispatch service.
 *
 * Uses the web-push library to send Web Push notifications to
 * subscribed browsers/devices. Handles expired subscriptions
 * by cleaning them up from the database.
 *
 * ─── Task D1c: dispatch is tenant-bound ───────────────────────────────────
 *
 * These functions ran from the notification pipeline with the service-role
 * Supabase client, so `push_subscription` and `user_account` were read with
 * row level security bypassed. `dispatchPushToUser` in particular had NO town
 * filter of any kind — it selected subscriptions by `user_account_id` alone,
 * and the cleanup delete that follows it (`.in("endpoint", …)`) had none
 * either, so an endpoint string colliding across towns would have deleted
 * another town's subscription.
 *
 * They now take a `TenantJob` (see `jobs/tenant-job.ts`), which is the only
 * way this file can reach the database and which cannot be constructed without
 * naming a town. `push_subscription` has no `town_id` column of its own; its
 * policy scopes it through `user_account` (`0000_baseline.sql` §3), so with a
 * tenant set the subscriptions of another town are not merely unfiltered —
 * they are invisible.
 */

import webpush from "web-push";
import { sql } from "drizzle-orm";
import type { TenantJob } from "../jobs/tenant-job.js";
import { toRows } from "../db/rows.js";

// ─── VAPID Configuration ────────────────────────────────────────────

const vapidSubject = `mailto:${process.env.VAPID_CONTACT_EMAIL ?? "admin@townmeetingmanager.com"}`;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

// ─── Types ──────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// ─── Event → preference mapping ────────────────────────────────────

const EVENT_TO_PREFERENCE = {
  meeting_reminder: "meeting_reminders",
  agenda_published: "agenda_published",
  minutes_approved: "minutes_approved",
  meeting_cancelled: "meeting_changes",
  straw_poll: "straw_poll_invitations",
} as const;

export type PushEventType = keyof typeof EVENT_TO_PREFERENCE;

// ─── Core functions ─────────────────────────────────────────────────

/**
 * Send a push notification to a single subscription.
 * Returns 'sent' on success, 'expired' if the subscription is no longer valid.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<"sent" | "expired"> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    // VAPID not configured — silently skip
    return "sent";
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return "sent";
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    // 410 Gone = subscription expired/unsubscribed
    if (statusCode === 410 || statusCode === 404) return "expired";
    throw err;
  }
}

/**
 * Dispatch push to all of one account's subscriptions, removing expired ones.
 *
 * The account is named, but the TOWN is what bounds the query: an id belonging
 * to another town selects nothing, because `push_subscription`'s policy
 * resolves through `user_account.town_id`. The delete that follows is scoped
 * the same way and additionally by `user_account_id`, so a colliding endpoint
 * string cannot reach another account's row.
 */
export async function dispatchPushToUser(
  job: TenantJob,
  userAccountId: string,
  payload: PushPayload,
): Promise<void> {
  const rows = await job.run(async (tx) =>
    toRows<PushSubscriptionRow>(
      await tx.execute(sql`
        SELECT endpoint, p256dh, auth
          FROM push_subscription
         WHERE user_account_id = ${userAccountId}::uuid
      `),
      (message) => new Error(`dispatchPushToUser: ${message}`),
    ),
  );

  if (rows.length === 0) return;

  const results = await Promise.allSettled(rows.map((sub) => sendPushNotification(sub, payload)));

  // Clean up expired subscriptions
  const expiredEndpoints = rows
    .filter((_, i) => {
      const result = results[i];
      return result?.status === "fulfilled" && result.value === "expired";
    })
    .map((sub) => sub.endpoint);

  if (expiredEndpoints.length > 0) {
    await job.run(async (tx) => {
      // One JSON parameter rather than `= ANY(${array})`: Drizzle expands a JS
      // array in a `sql` template into `($1, $2, …)`, which Postgres reads as a
      // record and refuses to cast to an array type.
      await tx.execute(sql`
        DELETE FROM push_subscription
         WHERE user_account_id = ${userAccountId}::uuid
           AND endpoint IN (SELECT jsonb_array_elements_text(${JSON.stringify(expiredEndpoints)}::jsonb))
      `);
    });
  }
}

/**
 * Dispatch push to every subscribed account in the job's town for one event
 * type. Respects each account's notification preferences.
 */
export async function dispatchPushToTown(
  job: TenantJob,
  eventType: PushEventType,
  payload: PushPayload,
): Promise<void> {
  const preferenceKey = EVENT_TO_PREFERENCE[eventType];

  // No `town_id` filter here, and that is the point: `app.town_id` is set for
  // the length of this transaction, so `user_account`'s policy has already
  // decided which rows exist.
  const accounts = await job.run(async (tx) =>
    toRows<{ id: string; notification_preferences: Record<string, boolean> | null }>(
      await tx.execute(sql`
        SELECT id, notification_preferences
          FROM user_account
         WHERE archived_at IS NULL
      `),
      (message) => new Error(`dispatchPushToTown: ${message}`),
    ),
  );

  const eligibleUserIds = accounts
    .filter((ua) => {
      const prefs = ua.notification_preferences;
      if (!prefs) return true; // default: all enabled
      if (prefs.push_enabled === false) return false;
      if (prefs[preferenceKey] === false) return false;
      return true;
    })
    .map((ua) => String(ua.id));

  await Promise.allSettled(
    eligibleUserIds.map((userAccountId) => dispatchPushToUser(job, userAccountId, payload)),
  );
}
