/**
 * Push notification dispatch service.
 *
 * Uses the web-push library to send Web Push notifications to
 * subscribed browsers/devices. Handles expired subscriptions
 * by cleaning them up from the database.
 */

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * Dispatch push to all subscriptions for a user, removing expired ones.
 */
export async function dispatchPushToUser(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<void> {
  const { data: subscriptions } = await supabase
    .from("push_subscription")
    .select("endpoint, p256dh, auth")
    .eq("user_account_id", userId);

  if (!subscriptions?.length) return;

  const rows = subscriptions as PushSubscriptionRow[];

  const results = await Promise.allSettled(
    rows.map((sub) => sendPushNotification(sub, payload)),
  );

  // Clean up expired subscriptions
  const expiredEndpoints = rows
    .filter((_, i) => {
      const result = results[i];
      return result?.status === "fulfilled" && result.value === "expired";
    })
    .map((sub) => sub.endpoint);

  if (expiredEndpoints.length > 0) {
    await supabase
      .from("push_subscription")
      .delete()
      .in("endpoint", expiredEndpoints);
  }
}

/**
 * Dispatch push to all subscribed users in a town for a specific event type.
 * Respects user notification preferences.
 */
export async function dispatchPushToTown(
  supabase: SupabaseClient,
  townId: string,
  eventType: PushEventType,
  payload: PushPayload,
): Promise<void> {
  const preferenceKey = EVENT_TO_PREFERENCE[eventType];

  // Find all user_accounts in this town (not archived)
  const { data: userAccounts } = await supabase
    .from("user_account")
    .select("id, notification_preferences")
    .eq("town_id", townId)
    .is("archived_at", null);

  if (!userAccounts?.length) return;

  // Filter by notification preference
  const eligibleUserIds = (
    userAccounts as Array<{
      id: string;
      notification_preferences: Record<string, boolean> | null;
    }>
  )
    .filter((ua) => {
      const prefs = ua.notification_preferences;
      if (!prefs) return true; // default: all enabled
      if (prefs.push_enabled === false) return false;
      if (prefs[preferenceKey] === false) return false;
      return true;
    })
    .map((ua) => ua.id);

  await Promise.allSettled(
    eligibleUserIds.map((userId) =>
      dispatchPushToUser(supabase, userId, payload),
    ),
  );
}
