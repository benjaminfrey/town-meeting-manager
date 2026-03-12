/**
 * Notification service.
 *
 * Implements the full event pipeline:
 *   createNotificationEvent → processNotificationEvent
 *   → subscriber query → filter → dispatch → delivery tracking
 *
 * Also handles retry scheduling and retry processing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationEventType } from "@town-meeting/shared";
import { getPostmarkClient } from "../lib/postmark.js";
import {
  EmailSenderService,
  getMessageStream,
  isBroadcastEvent,
  renderEmailTemplate,
} from "./email-sender.js";

// ─── Retry backoff schedule (seconds after failure) ──────────────────

const RETRY_DELAYS_SECONDS = [
  0,           // attempt 1: immediate (first try)
  5 * 60,      // attempt 2: 5 minutes
  30 * 60,     // attempt 3: 30 minutes
];
const MAX_RETRIES = 3;

// ─── Subscriber query helpers ─────────────────────────────────────────

/**
 * Returns user_account rows for all members and staff associated with a board,
 * skipping hard-bounced/complained addresses.
 */
async function getBoardSubscribers(
  supabase: SupabaseClient,
  boardId: string,
  townId: string,
): Promise<SubscriberRow[]> {
  // Fetch board member IDs first — Supabase JS v2 does not support subqueries in .in()
  const { data: members } = await supabase
    .from("board_member")
    .select("user_account_id")
    .eq("board_id", boardId)
    .eq("status", "active");

  const memberIds = (members ?? []).map(
    (m: { user_account_id: string }) => m.user_account_id,
  );

  if (memberIds.length === 0) return [];

  const { data } = await supabase
    .from("user_account")
    .select("id, email, display_name, email_bounced, email_complained")
    .eq("town_id", townId)
    .eq("email_bounced", false)
    .eq("email_complained", false)
    .in("id", memberIds);
  return (data as SubscriberRow[]) ?? [];
}

async function getAdminSubscribers(
  supabase: SupabaseClient,
  townId: string,
): Promise<SubscriberRow[]> {
  const { data } = await supabase
    .from("user_account")
    .select("id, email, display_name, email_bounced, email_complained")
    .eq("town_id", townId)
    .in("role", ["admin", "sys_admin"])
    .eq("email_bounced", false)
    .eq("email_complained", false);
  return (data as SubscriberRow[]) ?? [];
}

async function getSingleSubscriber(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriberRow[]> {
  const { data } = await supabase
    .from("user_account")
    .select("id, email, display_name, email_bounced, email_complained")
    .eq("id", userId)
    .single();
  return data ? [data as SubscriberRow] : [];
}

interface SubscriberRow {
  id: string;
  email: string;
  display_name: string | null;
  email_bounced: boolean;
  email_complained: boolean;
}

/**
 * Returns subscriber IDs who have explicitly disabled this notification.
 */
async function getDisabledSubscriberIds(
  supabase: SupabaseClient,
  subscriberIds: string[],
  eventType: NotificationEventType,
): Promise<Set<string>> {
  if (subscriberIds.length === 0) return new Set();
  const { data } = await supabase
    .from("subscriber_notification_preference")
    .select("subscriber_id")
    .in("subscriber_id", subscriberIds)
    .eq("event_type", eventType)
    .eq("channel", "email")
    .eq("enabled", false);
  return new Set((data ?? []).map((r: { subscriber_id: string }) => r.subscriber_id));
}

// ─── Sender config ────────────────────────────────────────────────────

interface TownSenderConfig {
  senderEmail: string;
  senderName: string;
  replyTo: string | null;
}

async function getTownSenderConfig(
  supabase: SupabaseClient,
  townId: string,
): Promise<TownSenderConfig> {
  const { data } = await supabase
    .from("town_notification_config")
    .select("postmark_sender_email, postmark_sender_name")
    .eq("town_id", townId)
    .single();

  if (data) {
    return {
      senderEmail: data.postmark_sender_email as string,
      senderName: data.postmark_sender_name as string,
      replyTo: null,
    };
  }

  // Fallback: derive from town subdomain
  const { data: town } = await supabase
    .from("town")
    .select("name, subdomain")
    .eq("id", townId)
    .single();

  const subdomain = (town?.subdomain as string | null) ?? "notifications";
  const senderEmail = `notifications@${subdomain}.townmeetingmanager.com`;
  const senderName = `Town of ${town?.name ?? "Town Meeting Manager"}`;
  return { senderEmail, senderName, replyTo: null };
}

// ─── Template mapping ─────────────────────────────────────────────────

const EVENT_TYPE_TO_TEMPLATE: Partial<Record<NotificationEventType, string>> = {
  meeting_scheduled: "meeting-notice",
  meeting_cancelled: "meeting-notice",
  agenda_published: "agenda-published",
  minutes_review: "minutes-review",
  minutes_approved: "minutes-approved",
  minutes_published: "minutes-approved",
  admin_alert: "admin-alert",
  user_invited: "invite-user",
  password_reset: "password-reset",
};

// ─── NotificationService ──────────────────────────────────────────────

export class NotificationService {
  constructor(private readonly supabase: SupabaseClient) {}

  // ── Public: create + fire ──────────────────────────────────────────

  async createNotificationEvent(
    eventType: NotificationEventType,
    townId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from("notification_event")
      .insert({
        town_id: townId,
        event_type: eventType,
        payload,
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create notification event: ${error?.message}`);
    }

    const eventId = (data as { id: string }).id;

    // Process asynchronously — don't block the caller
    setImmediate(() => {
      this.processNotificationEvent(eventId).catch((err: unknown) => {
        console.error(`[notification] Failed to process event ${eventId}:`, err);
      });
    });

    return eventId;
  }

  // ── Core processing ────────────────────────────────────────────────

  async processNotificationEvent(eventId: string): Promise<void> {
    // Mark as processing
    await this.supabase
      .from("notification_event")
      .update({ status: "processing" })
      .eq("id", eventId);

    try {
      const { data: event } = await this.supabase
        .from("notification_event")
        .select("*")
        .eq("id", eventId)
        .single();

      if (!event) {
        throw new Error(`Event ${eventId} not found`);
      }

      const eventType = event.event_type as NotificationEventType;
      const townId = event.town_id as string;
      const payload = event.payload as Record<string, unknown>;

      // 1. Find subscribers
      const subscribers = await this.getSubscribersForEvent(
        eventType,
        townId,
        payload,
      );

      // 2. Filter disabled prefs
      const disabledIds = await getDisabledSubscriberIds(
        this.supabase,
        subscribers.map((s) => s.id),
        eventType,
      );

      const eligible = subscribers.filter((s) => !disabledIds.has(s.id));

      // 3. Get town sender config
      const senderConfig = await getTownSenderConfig(this.supabase, townId);

      // 4. Get Postmark client
      const pmClient = await getPostmarkClient(townId, this.supabase);
      const emailSender = new EmailSenderService(pmClient);

      // 5. Build template variables from payload
      const templateName = EVENT_TYPE_TO_TEMPLATE[eventType];
      if (!templateName) {
        throw new Error(`No template mapping for event type: ${eventType}`);
      }

      const messageStream = getMessageStream(eventType);
      const isBroadcast = isBroadcastEvent(eventType);

      // 6. Create delivery records + dispatch
      for (const subscriber of eligible) {
        const { data: delivery } = await this.supabase
          .from("notification_delivery")
          .insert({
            event_id: eventId,
            subscriber_id: subscriber.id,
            channel: "email",
            status: "pending",
            retry_count: 0,
          })
          .select("id")
          .single();

        if (!delivery) continue;
        const deliveryId = (delivery as { id: string }).id;

        const variables = {
          ...payload,
          recipientName: subscriber.display_name ?? subscriber.email,
          isBroadcast,
          preferencesUrl: `${process.env.APP_URL ?? "https://app.townmeetingmanager.com"}/settings/notifications`,
        };

        const { html, text, subject } = renderEmailTemplate(templateName, variables);
        const from = `${senderConfig.senderName} <${senderConfig.senderEmail}>`;

        await this.dispatchEmail(
          deliveryId,
          emailSender,
          {
            to: subscriber.email,
            from,
            replyTo: senderConfig.replyTo ?? undefined,
            subject,
            htmlBody: html,
            textBody: text,
            tag: eventType,
            messageStream,
            metadata: {
              town_id: townId,
              event_id: eventId,
              delivery_id: deliveryId,
            },
          },
        );
      }

      // 7. Mark event completed
      await this.supabase
        .from("notification_event")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("id", eventId);

    } catch (err) {
      console.error(`[notification] Event ${eventId} processing failed:`, err);
      await this.supabase
        .from("notification_event")
        .update({ status: "failed" })
        .eq("id", eventId);
    }
  }

  // ── Dispatch a single email ────────────────────────────────────────

  private async dispatchEmail(
    deliveryId: string,
    sender: EmailSenderService,
    options: Parameters<EmailSenderService["sendEmail"]>[0],
  ): Promise<void> {
    try {
      const result = await sender.sendEmail(options);

      await this.supabase
        .from("notification_delivery")
        .update({
          status: "sent",
          postmark_message_id: result.MessageID,
          sent_at: new Date().toISOString(),
        })
        .eq("id", deliveryId);

    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      console.error(`[notification] Dispatch failed for delivery ${deliveryId}:`, errorMessage);

      await this.supabase
        .from("notification_delivery")
        .update({
          status: "failed",
          error_message: errorMessage,
          retry_count: 1,
          next_retry_at: this.nextRetryAt(1),
        })
        .eq("id", deliveryId);
    }
  }

  // ── Subscriber resolution ──────────────────────────────────────────

  private async getSubscribersForEvent(
    eventType: NotificationEventType,
    townId: string,
    payload: Record<string, unknown>,
  ): Promise<SubscriberRow[]> {
    switch (eventType) {
      case "meeting_scheduled":
      case "meeting_cancelled":
      case "agenda_published":
      case "minutes_approved":
      case "minutes_published": {
        const boardId = payload.board_id as string | undefined;
        if (!boardId) return [];
        return getBoardSubscribers(this.supabase, boardId, townId);
      }

      case "minutes_review": {
        // Board members with permission to view draft minutes (R4)
        // For MVP: all active board members on the board
        const boardId = payload.board_id as string | undefined;
        if (!boardId) return [];
        return getBoardSubscribers(this.supabase, boardId, townId);
      }

      case "admin_alert": {
        return getAdminSubscribers(this.supabase, townId);
      }

      case "user_invited":
      case "password_reset": {
        const userId = payload.user_id as string | undefined;
        if (!userId) return [];
        return getSingleSubscriber(this.supabase, userId);
      }

      default:
        return [];
    }
  }

  // ── Delivery tracking helpers ──────────────────────────────────────

  async getDeliverySummary(eventId: string): Promise<DeliverySummary> {
    const { data } = await this.supabase
      .from("notification_delivery")
      .select("status")
      .eq("event_id", eventId);

    const rows = (data as { status: string }[]) ?? [];
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      sent: rows.filter((r) => r.status === "sent").length,
      delivered: rows.filter((r) => r.status === "delivered").length,
      bounced: rows.filter((r) => r.status === "bounced").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  }

  async getSubscriberDeliveryHistory(
    userId: string,
    limit = 20,
  ): Promise<DeliveryHistoryRow[]> {
    const { data } = await this.supabase
      .from("notification_delivery")
      .select("id, event_id, status, sent_at, delivered_at, created_at, notification_event(event_type, payload)")
      .eq("subscriber_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    // Supabase returns joined tables as arrays — cast through unknown
    return (data as unknown as DeliveryHistoryRow[]) ?? [];
  }

  // ── Retry processor ────────────────────────────────────────────────

  /**
   * Called periodically (e.g. every minute via setInterval in server startup).
   * Picks up deliveries past their next_retry_at and retries them.
   */
  async processRetries(): Promise<void> {
    const { data: pendingRetries } = await this.supabase
      .from("notification_delivery")
      .select("id, event_id, subscriber_id, retry_count")
      .in("status", ["failed", "sent"])
      .lt("retry_count", MAX_RETRIES)
      .not("next_retry_at", "is", null)
      .lte("next_retry_at", new Date().toISOString())
      .limit(50);

    if (!pendingRetries || pendingRetries.length === 0) return;

    for (const delivery of pendingRetries as RetryRow[]) {
      await this.retryDelivery(delivery);
    }
  }

  private async retryDelivery(delivery: RetryRow): Promise<void> {
    const newRetryCount = delivery.retry_count + 1;

    // Load event to reconstruct the send
    const { data: event } = await this.supabase
      .from("notification_event")
      .select("*")
      .eq("id", delivery.event_id)
      .single();

    const { data: subscriber } = await this.supabase
      .from("user_account")
      .select("id, email, display_name, email_bounced, email_complained")
      .eq("id", delivery.subscriber_id)
      .single();

    if (!event || !subscriber) return;
    if ((subscriber as SubscriberRow).email_bounced) return;

    const eventType = event.event_type as NotificationEventType;
    const townId = event.town_id as string;
    const payload = event.payload as Record<string, unknown>;
    const templateName = EVENT_TYPE_TO_TEMPLATE[eventType];
    if (!templateName) return;

    try {
      const senderConfig = await getTownSenderConfig(this.supabase, townId);
      const pmClient = await getPostmarkClient(townId, this.supabase);
      const emailSender = new EmailSenderService(pmClient);
      const messageStream = getMessageStream(eventType);
      const isBroadcast = isBroadcastEvent(eventType);

      const variables = {
        ...payload,
        recipientName: (subscriber as SubscriberRow).display_name ?? (subscriber as SubscriberRow).email,
        isBroadcast,
        preferencesUrl: `${process.env.APP_URL ?? "https://app.townmeetingmanager.com"}/settings/notifications`,
      };

      const { html, text, subject } = renderEmailTemplate(templateName, variables);
      const from = `${senderConfig.senderName} <${senderConfig.senderEmail}>`;

      const result = await emailSender.sendEmail({
        to: (subscriber as SubscriberRow).email,
        from,
        subject,
        htmlBody: html,
        textBody: text,
        tag: eventType,
        messageStream,
        metadata: {
          town_id: townId,
          event_id: delivery.event_id,
          delivery_id: delivery.id,
        },
      });

      await this.supabase
        .from("notification_delivery")
        .update({
          status: "sent",
          postmark_message_id: result.MessageID,
          sent_at: new Date().toISOString(),
          retry_count: newRetryCount,
          next_retry_at: null,
          error_message: null,
        })
        .eq("id", delivery.id);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[notification] Retry ${newRetryCount} failed for delivery ${delivery.id}:`, errorMessage);

      const isPermanentFailure = newRetryCount >= MAX_RETRIES;

      await this.supabase
        .from("notification_delivery")
        .update({
          status: isPermanentFailure ? "failed" : "failed",
          error_message: errorMessage,
          retry_count: newRetryCount,
          next_retry_at: isPermanentFailure ? null : this.nextRetryAt(newRetryCount),
        })
        .eq("id", delivery.id);

      if (isPermanentFailure) {
        console.warn(
          `[notification] Delivery ${delivery.id} permanently failed after ${MAX_RETRIES} attempts`,
        );
      }
    }
  }

  private nextRetryAt(attemptNumber: number): string | null {
    const delaySec = RETRY_DELAYS_SECONDS[attemptNumber];
    if (delaySec === undefined) return null;
    return new Date(Date.now() + delaySec * 1000).toISOString();
  }
}

// ─── Types ────────────────────────────────────────────────────────────

export interface DeliverySummary {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
}

export interface DeliveryHistoryRow {
  id: string;
  event_id: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
  notification_event: {
    event_type: string;
    payload: Record<string, unknown>;
  } | null;
}

interface RetryRow {
  id: string;
  event_id: string;
  subscriber_id: string;
  retry_count: number;
}
