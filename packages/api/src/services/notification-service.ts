/**
 * Notification service.
 *
 * Implements the full event pipeline:
 *   createNotificationEvent → processNotificationEvent
 *   → subscriber query → filter → dispatch → delivery tracking
 *
 * Also handles retry scheduling and retry processing.
 *
 * ─── Task D1c: this is a JOB, and a job names its town ────────────────────
 *
 * Everything here runs with no request and no session — from a `setInterval`,
 * and from `setImmediate` callbacks that outlive the request that queued them.
 * There is nothing to resolve a tenant from, so the tenant is supplied when
 * the service is constructed and there is no default: `new
 * NotificationService(tenantJob(db, townId))`, and `tenantJob` throws if the
 * town is missing. See `jobs/tenant-job.ts` for why construction is the right
 * place for that to fail.
 *
 * What that replaces: a service-role Supabase client, RLS bypassed, and
 * eleven queries whose tenancy was whatever `.eq("town_id", …)` the developer
 * remembered — three of them had no town filter at all
 * (`getDisabledSubscriberIds`, `getSingleSubscriber`, `processRetries`), so a
 * preference or a subscriber in another town was reachable by id. Every query
 * below now runs inside a transaction with `app.town_id` set, so tenancy is
 * decided by the database and not by this file.
 *
 * ─── Subscribers are PERSON records ───────────────────────────────────────
 *
 * Not `user_account` records (decided 2026-08-27 — see the header of
 * supabase/migrations/20260827000001_canonicalize_notifications.sql). A person
 * can exist with no user_account ("directory-only" people — see
 * AddPersonDialog), and `notification_delivery.subscriber_id` /
 * `subscriber_notification_preference.person_id` both reference `person(id)`.
 * Bounce/complaint flags still live on `user_account` (out of scope to
 * relocate), so an account-less person is treated as never-bounced — there is
 * nothing to have bounced yet.
 */

import { sql } from "drizzle-orm";
import type { NotificationEventType } from "@town-meeting/shared";
import type { TenantJob } from "../jobs/tenant-job.js";
import type { TenantTx } from "../db/with-tenant.js";
import { toRows } from "../db/rows.js";
import { getPostmarkClient } from "../lib/postmark.js";
import {
  EmailSenderService,
  getMessageStream,
  isBroadcastEvent,
  renderEmailTemplate,
} from "./email-sender.js";
import { dispatchPushToTown, type PushEventType } from "../lib/push.js";

// ─── Retry backoff schedule (seconds after failure) ──────────────────

const RETRY_DELAYS_SECONDS = [
  0, // attempt 1: immediate (first try)
  5 * 60, // attempt 2: 5 minutes
  30 * 60, // attempt 3: 30 minutes
];
const MAX_RETRIES = 3;

/** How many pending events one sweep of one town will process. */
const PENDING_EVENT_BATCH = 50;

function rows<T>(result: unknown, what: string): T[] {
  return toRows<T>(result, (message) => new Error(`${what}: ${message}`));
}

/**
 * A parameterised list of uuids, for `... IN ${uuidList(ids)}`.
 *
 * Drizzle expands a JS array inside a `sql` template into a comma-separated
 * list of placeholders — `($1, $2, $3)` — which is a record, not an array, so
 * `= ANY(${ids}::uuid[])` fails with "cannot cast type record to uuid[]". One
 * JSON parameter unnested in SQL keeps it a single bound value regardless of
 * length, which also means the statement text is stable enough to be prepared.
 */
function uuidList(ids: readonly string[]) {
  return sql`(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`;
}

// ─── Subscriber query helpers ─────────────────────────────────────────

export interface SubscriberRow {
  id: string;
  email: string;
  display_name: string | null;
  email_bounced: boolean;
  email_complained: boolean;
}

interface RawPersonSubscriberRow {
  id: string;
  name: string | null;
  email: string | null;
  email_bounced: boolean | null;
  email_complained: boolean | null;
}

/**
 * Normalise one person(+optional user_account) row into a SubscriberRow, or
 * null if the person cannot currently receive an email (no address on file, or
 * the linked account has bounced/complained).
 */
function toSubscriberRow(row: RawPersonSubscriberRow): SubscriberRow | null {
  if (!row.email) return null;

  const emailBounced = row.email_bounced ?? false;
  const emailComplained = row.email_complained ?? false;
  if (emailBounced || emailComplained) return null;

  return {
    id: String(row.id),
    email: row.email,
    display_name: row.name,
    email_bounced: emailBounced,
    email_complained: emailComplained,
  };
}

/**
 * Notifiable people for the given person ids, within the transaction's town.
 *
 * The LEFT JOIN replaces a PostgREST embed (`person(…, user_account(…))`),
 * which returned the to-one relation as either an object or an array-of-one
 * depending on how the client inferred the relationship and needed unwrapping
 * at every call site. A join returns columns.
 */
async function getSubscribersForPersonIds(
  tx: TenantTx,
  personIds: string[],
): Promise<SubscriberRow[]> {
  if (personIds.length === 0) return [];

  const result = rows<RawPersonSubscriberRow>(
    await tx.execute(sql`
      SELECT p.id, p.name, p.email, ua.email_bounced, ua.email_complained
        FROM person p
        LEFT JOIN user_account ua ON ua.person_id = p.id
       WHERE p.id IN ${uuidList(personIds)}
    `),
    "getSubscribersForPersonIds",
  );

  return result.map(toSubscriberRow).filter((row): row is SubscriberRow => row !== null);
}

/**
 * Notifiable people for all active members of a board.
 *
 * Resolved through `board_member.person_id`. `board_member` has no
 * `user_account_id` column — membership links to a PERSON, who may or may not
 * have a login. `test/__tests__/notification-schema.test.ts` pins that.
 */
export async function getBoardSubscribers(tx: TenantTx, boardId: string): Promise<SubscriberRow[]> {
  const result = rows<RawPersonSubscriberRow>(
    await tx.execute(sql`
      SELECT p.id, p.name, p.email, ua.email_bounced, ua.email_complained
        FROM board_member bm
        JOIN person p ON p.id = bm.person_id
        LEFT JOIN user_account ua ON ua.person_id = p.id
       WHERE bm.board_id = ${boardId}::uuid
         AND bm.status = 'active'
    `),
    "getBoardSubscribers",
  );

  return result.map(toSubscriberRow).filter((row): row is SubscriberRow => row !== null);
}

async function getAdminSubscribers(tx: TenantTx): Promise<SubscriberRow[]> {
  // Admin/sys_admin is a user_account-level role, so this starts from
  // user_account (unlike getBoardSubscribers), but still resolves to the
  // linked person for the actual subscriber identity.
  const result = rows<RawPersonSubscriberRow>(
    await tx.execute(sql`
      SELECT p.id, p.name, p.email, ua.email_bounced, ua.email_complained
        FROM user_account ua
        JOIN person p ON p.id = ua.person_id
       WHERE ua.role IN ('admin', 'sys_admin')
    `),
    "getAdminSubscribers",
  );

  return result.map(toSubscriberRow).filter((row): row is SubscriberRow => row !== null);
}

async function getSingleSubscriber(tx: TenantTx, personId: string): Promise<SubscriberRow[]> {
  return getSubscribersForPersonIds(tx, [personId]);
}

/**
 * Subscriber (person) ids who have explicitly disabled this notification.
 */
async function getDisabledSubscriberIds(
  tx: TenantTx,
  personIds: string[],
  eventType: NotificationEventType,
): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const result = rows<{ person_id: string }>(
    await tx.execute(sql`
      SELECT person_id
        FROM subscriber_notification_preference
       WHERE person_id IN ${uuidList(personIds)}
         AND event_type = ${eventType}
         AND channel = 'email'
         AND enabled = false
    `),
    "getDisabledSubscriberIds",
  );
  return new Set(result.map((r) => String(r.person_id)));
}

// ─── Sender config ────────────────────────────────────────────────────

interface TownSenderConfig {
  senderEmail: string;
  senderName: string;
  replyTo: string | null;
}

async function getTownSenderConfig(tx: TenantTx): Promise<TownSenderConfig> {
  const configured = rows<{ sender_email: string | null; sender_name: string | null }>(
    await tx.execute(sql`
      SELECT postmark_sender_email AS sender_email, postmark_sender_name AS sender_name
        FROM town_notification_config
       LIMIT 1
    `),
    "getTownSenderConfig",
  );

  const config = configured[0];
  if (config?.sender_email && config.sender_name) {
    return { senderEmail: config.sender_email, senderName: config.sender_name, replyTo: null };
  }

  // Fallback: derive from the town's subdomain. One row — `town`'s policy is
  // `id = get_current_town_id()`, so this transaction can see exactly its own.
  const towns = rows<{ name: string | null; subdomain: string | null }>(
    await tx.execute(sql`SELECT name, subdomain FROM town LIMIT 1`),
    "getTownSenderConfig",
  );

  const town = towns[0];
  const subdomain = town?.subdomain ?? "notifications";
  return {
    senderEmail: `notifications@${subdomain}.townmeetingmanager.com`,
    senderName: `Town of ${town?.name ?? "Town Meeting Manager"}`,
    replyTo: null,
  };
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
  /**
   * @param job the town this service works for. There is no second
   * constructor and no default — see this file's header.
   */
  constructor(private readonly job: TenantJob) {}

  /** The town every query this service makes is scoped to. */
  get townId(): string {
    return this.job.townId;
  }

  // ── Public: create + fire ──────────────────────────────────────────

  /**
   * Queue an event for this service's town.
   *
   * There is no `townId` parameter any more. It used to be one, and
   * `routes/notifications.ts` had to check the caller's town against it by
   * hand — a cross-tenant check settled in TypeScript. The town is now the
   * job's, so the two cannot disagree.
   */
  async createNotificationEvent(
    eventType: NotificationEventType,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const inserted = await this.job.run(async (tx) =>
      rows<{ id: string }>(
        await tx.execute(sql`
          INSERT INTO notification_event (town_id, event_type, payload, status)
          VALUES (${this.job.townId}::uuid, ${eventType}, ${JSON.stringify(payload)}::jsonb, 'pending')
          RETURNING id
        `),
        "createNotificationEvent",
      ),
    );

    if (inserted.length !== 1) {
      throw new Error(
        `Failed to create notification event: expected 1 row, got ${inserted.length}`,
      );
    }

    const eventId = String(inserted[0]!.id);

    // Process asynchronously — don't block the caller. If this process dies
    // first the event stays `pending` and the sweep in `server.ts` picks it
    // up, which is why `processPendingEvents` exists.
    setImmediate(() => {
      this.processNotificationEvent(eventId).catch((err: unknown) => {
        console.error(`[notification] Failed to process event ${eventId}:`, err);
      });
    });

    return eventId;
  }

  // ── Core processing ────────────────────────────────────────────────

  /**
   * Process every `pending` event in this job's town.
   *
   * The durable half of `createNotificationEvent`'s `setImmediate`: an event
   * whose queuing process died before delivering it is picked up here on the
   * next sweep. Task D1c also relied on this as the ONLY delivery path for
   * `services/notification-triggers.ts`, which had no tenant and so could not
   * schedule its own; D1f gave it one, so this is crash recovery again rather
   * than the normal route.
   */
  async processPendingEvents(): Promise<number> {
    const pending = await this.job.run(async (tx) =>
      rows<{ id: string }>(
        await tx.execute(sql`
          SELECT id FROM notification_event
           WHERE status = 'pending'
           ORDER BY created_at
           LIMIT ${PENDING_EVENT_BATCH}
        `),
        "processPendingEvents",
      ),
    );

    for (const event of pending) {
      await this.processNotificationEvent(String(event.id));
    }
    return pending.length;
  }

  async processNotificationEvent(eventId: string): Promise<void> {
    // Claim it. `status = 'pending'` in the WHERE plus the returned row count
    // is what stops two sweeps — or a sweep and the `setImmediate` above —
    // sending the same event twice.
    const claimed = await this.job.run(async (tx) =>
      rows<{ event_type: string; payload: Record<string, unknown> }>(
        await tx.execute(sql`
          UPDATE notification_event
             SET status = 'processing'
           WHERE id = ${eventId}::uuid
             AND status = 'pending'
          RETURNING event_type, payload
        `),
        "processNotificationEvent",
      ),
    );

    if (claimed.length === 0) {
      // Either another worker has it, or it is already done, or it belongs to
      // another town and this transaction cannot see it. All three mean
      // "not this job's work" and none is an error.
      return;
    }

    const eventType = claimed[0]!.event_type as NotificationEventType;
    const payload = claimed[0]!.payload ?? {};

    try {
      const templateName = EVENT_TYPE_TO_TEMPLATE[eventType];
      if (!templateName) {
        throw new Error(`No template mapping for event type: ${eventType}`);
      }

      // One transaction for the whole read side: subscribers, their
      // preferences, the town's sender identity and its Postmark token. The
      // sends themselves are deliberately outside it — see `auth/fastify.ts`
      // on why a transaction is not held across network calls.
      const plan = await this.job.run(async (tx) => {
        const subscribers = await this.getSubscribersForEvent(tx, eventType, payload);
        const disabledIds = await getDisabledSubscriberIds(
          tx,
          subscribers.map((s) => s.id),
          eventType,
        );
        return {
          eligible: subscribers.filter((s) => !disabledIds.has(s.id)),
          senderConfig: await getTownSenderConfig(tx),
          pmClient: await getPostmarkClient(tx),
        };
      });

      const emailSender = new EmailSenderService(plan.pmClient);
      const messageStream = getMessageStream(eventType);
      const isBroadcast = isBroadcastEvent(eventType);

      for (const subscriber of plan.eligible) {
        const created = await this.job.run(async (tx) =>
          rows<{ id: string }>(
            await tx.execute(sql`
              INSERT INTO notification_delivery
                     (event_id, town_id, subscriber_id, channel, status, retry_count)
              VALUES (${eventId}::uuid, ${this.job.townId}::uuid, ${subscriber.id}::uuid,
                      'email', 'pending', 0)
              RETURNING id
            `),
            "processNotificationEvent",
          ),
        );

        const deliveryId = created[0] ? String(created[0].id) : null;
        if (!deliveryId) continue;

        const variables = {
          ...payload,
          recipientName: subscriber.display_name ?? subscriber.email,
          isBroadcast,
          preferencesUrl: `${process.env.APP_URL ?? "https://app.townmeetingmanager.com"}/settings/notifications`,
        };

        const { html, text, subject } = renderEmailTemplate(templateName, variables);
        const from = `${plan.senderConfig.senderName} <${plan.senderConfig.senderEmail}>`;

        await this.dispatchEmail(deliveryId, emailSender, {
          to: subscriber.email,
          from,
          replyTo: plan.senderConfig.replyTo ?? undefined,
          subject,
          htmlBody: html,
          textBody: text,
          tag: eventType,
          messageStream,
          metadata: {
            town_id: this.job.townId,
            event_id: eventId,
            delivery_id: deliveryId,
          },
        });
      }

      await this.dispatchPushForEvent(eventType, payload);

      await this.job.run(async (tx) => {
        await tx.execute(sql`
          UPDATE notification_event
             SET status = 'completed', processed_at = now()
           WHERE id = ${eventId}::uuid
        `);
      });
    } catch (err) {
      console.error(`[notification] Event ${eventId} processing failed:`, err);
      await this.job
        .run(async (tx) => {
          await tx.execute(sql`
            UPDATE notification_event SET status = 'failed' WHERE id = ${eventId}::uuid
          `);
        })
        .catch((markErr: unknown) => {
          console.error(`[notification] Could not mark event ${eventId} failed:`, markErr);
        });
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

      await this.job.run(async (tx) => {
        await tx.execute(sql`
          UPDATE notification_delivery
             SET status = 'sent', postmark_message_id = ${result.MessageID}, sent_at = now()
           WHERE id = ${deliveryId}::uuid
        `);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[notification] Dispatch failed for delivery ${deliveryId}:`, errorMessage);

      await this.job.run(async (tx) => {
        await tx.execute(sql`
          UPDATE notification_delivery
             SET status = 'failed',
                 error_message = ${errorMessage},
                 retry_count = 1,
                 next_retry_at = ${this.nextRetryAt(1)}
           WHERE id = ${deliveryId}::uuid
        `);
      });
    }
  }

  // ── Subscriber resolution ──────────────────────────────────────────

  private async getSubscribersForEvent(
    tx: TenantTx,
    eventType: NotificationEventType,
    payload: Record<string, unknown>,
  ): Promise<SubscriberRow[]> {
    switch (eventType) {
      case "meeting_scheduled":
      case "meeting_cancelled":
      case "agenda_published":
      case "minutes_approved":
      case "minutes_published":
      case "minutes_review": {
        // `minutes_review` should be board members with R4 rather than all of
        // them; permissions live in TypeScript (Phase D) and this pipeline has
        // no actor to check them against, so for now it is the whole board.
        const boardId = payload.board_id as string | undefined;
        if (!boardId) return [];
        return getBoardSubscribers(tx, boardId);
      }

      case "admin_alert":
        return getAdminSubscribers(tx);

      case "user_invited":
      case "password_reset": {
        // `payload.user_id` is dead-code-era naming (nothing currently calls
        // createNotificationEvent with these event types) — kept as the wire
        // key since no caller exists to migrate, but it resolves to a person
        // id, not a user_account id.
        const personId = payload.user_id as string | undefined;
        if (!personId) return [];
        return getSingleSubscriber(tx, personId);
      }

      default:
        return [];
    }
  }

  // ── Delivery tracking helpers ──────────────────────────────────────

  async getDeliverySummary(eventId: string): Promise<DeliverySummary> {
    const result = await this.job.run(async (tx) =>
      rows<{ status: string }>(
        await tx.execute(
          sql`SELECT status FROM notification_delivery WHERE event_id = ${eventId}::uuid`,
        ),
        "getDeliverySummary",
      ),
    );

    return {
      total: result.length,
      pending: result.filter((r) => r.status === "pending").length,
      sent: result.filter((r) => r.status === "sent").length,
      delivered: result.filter((r) => r.status === "delivered").length,
      bounced: result.filter((r) => r.status === "bounced").length,
      failed: result.filter((r) => r.status === "failed").length,
    };
  }

  async getSubscriberDeliveryHistory(personId: string, limit = 20): Promise<DeliveryHistoryRow[]> {
    return this.job.run(async (tx) =>
      rows<DeliveryHistoryRow>(
        await tx.execute(sql`
          SELECT d.id, d.event_id, d.status, d.sent_at, d.delivered_at, d.created_at,
                 jsonb_build_object('event_type', e.event_type, 'payload', e.payload)
                   AS notification_event
            FROM notification_delivery d
            LEFT JOIN notification_event e ON e.id = d.event_id
           WHERE d.subscriber_id = ${personId}::uuid
           ORDER BY d.created_at DESC
           LIMIT ${limit}
        `),
        "getSubscriberDeliveryHistory",
      ),
    );
  }

  // ── Retry processor ────────────────────────────────────────────────

  /**
   * Pick up this town's deliveries that are past their `next_retry_at` and
   * retry them.
   *
   * Called for one town at a time. The old version swept every town in one
   * query, with no `town_id` filter — see `server.ts` for the loop that
   * replaced it and `jobs/tenant-job.ts` for why it is a loop.
   */
  async processRetries(): Promise<void> {
    const pendingRetries = await this.job.run(async (tx) =>
      rows<RetryRow>(
        await tx.execute(sql`
          SELECT id, event_id, subscriber_id, retry_count
            FROM notification_delivery
           WHERE status IN ('failed', 'sent')
             AND retry_count < ${MAX_RETRIES}
             AND next_retry_at IS NOT NULL
             AND next_retry_at <= now()
           LIMIT 50
        `),
        "processRetries",
      ),
    );

    for (const delivery of pendingRetries) {
      await this.retryDelivery(delivery);
    }
  }

  private async retryDelivery(delivery: RetryRow): Promise<void> {
    const newRetryCount = Number(delivery.retry_count) + 1;

    const context = await this.job.run(async (tx) => {
      const events = rows<{ event_type: string; payload: Record<string, unknown> }>(
        await tx.execute(
          sql`SELECT event_type, payload FROM notification_event WHERE id = ${delivery.event_id}::uuid`,
        ),
        "retryDelivery",
      );
      const subscribers = await getSubscribersForPersonIds(tx, [String(delivery.subscriber_id)]);
      if (!events[0] || !subscribers[0]) return null;
      return {
        eventType: events[0].event_type as NotificationEventType,
        payload: events[0].payload ?? {},
        subscriber: subscribers[0],
        senderConfig: await getTownSenderConfig(tx),
        pmClient: await getPostmarkClient(tx),
      };
    });

    if (!context) return;

    const templateName = EVENT_TYPE_TO_TEMPLATE[context.eventType];
    if (!templateName) return;

    try {
      const emailSender = new EmailSenderService(context.pmClient);
      const messageStream = getMessageStream(context.eventType);
      const isBroadcast = isBroadcastEvent(context.eventType);

      const variables = {
        ...context.payload,
        recipientName: context.subscriber.display_name ?? context.subscriber.email,
        isBroadcast,
        preferencesUrl: `${process.env.APP_URL ?? "https://app.townmeetingmanager.com"}/settings/notifications`,
      };

      const { html, text, subject } = renderEmailTemplate(templateName, variables);
      const from = `${context.senderConfig.senderName} <${context.senderConfig.senderEmail}>`;

      const result = await emailSender.sendEmail({
        to: context.subscriber.email,
        from,
        subject,
        htmlBody: html,
        textBody: text,
        tag: context.eventType,
        messageStream,
        metadata: {
          town_id: this.job.townId,
          event_id: String(delivery.event_id),
          delivery_id: String(delivery.id),
        },
      });

      await this.job.run(async (tx) => {
        await tx.execute(sql`
          UPDATE notification_delivery
             SET status = 'sent',
                 postmark_message_id = ${result.MessageID},
                 sent_at = now(),
                 retry_count = ${newRetryCount},
                 next_retry_at = NULL,
                 error_message = NULL
           WHERE id = ${delivery.id}::uuid
        `);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[notification] Retry ${newRetryCount} failed for delivery ${delivery.id}:`,
        errorMessage,
      );

      const isPermanentFailure = newRetryCount >= MAX_RETRIES;

      await this.job.run(async (tx) => {
        await tx.execute(sql`
          UPDATE notification_delivery
             SET status = 'failed',
                 error_message = ${errorMessage},
                 retry_count = ${newRetryCount},
                 next_retry_at = ${isPermanentFailure ? null : this.nextRetryAt(newRetryCount)}
           WHERE id = ${delivery.id}::uuid
        `);
      });

      if (isPermanentFailure) {
        console.warn(
          `[notification] Delivery ${delivery.id} permanently failed after ${MAX_RETRIES} attempts`,
        );
      }
    }
  }

  // ── Push dispatch ──────────────────────────────────────────────────

  private async dispatchPushForEvent(
    eventType: NotificationEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const PUSH_EVENT_MAP: Partial<Record<NotificationEventType, PushEventType>> = {
      agenda_published: "agenda_published",
      minutes_approved: "minutes_approved",
      meeting_cancelled: "meeting_cancelled",
    };

    const pushEventType = PUSH_EVENT_MAP[eventType];
    if (!pushEventType) return;

    const PUSH_PAYLOAD_MAP: Record<
      string,
      (p: Record<string, unknown>) => { title: string; body: string; tag: string; url: string }
    > = {
      agenda_published: (p) => ({
        title: "Agenda Published",
        body: `The agenda for ${(p.meeting_title as string) ?? "a meeting"} has been published.`,
        tag: `agenda-${(p.meeting_id as string) ?? "unknown"}`,
        url: `/meetings/${(p.meeting_id as string) ?? ""}`,
      }),
      minutes_approved: (p) => ({
        title: "Minutes Approved",
        body: `Minutes for ${(p.meeting_title as string) ?? "a meeting"} have been approved.`,
        tag: `minutes-${(p.meeting_id as string) ?? "unknown"}`,
        url: `/meetings/${(p.meeting_id as string) ?? ""}/minutes`,
      }),
      meeting_cancelled: (p) => ({
        title: "Meeting Cancelled",
        body: `${(p.meeting_title as string) ?? "A meeting"} has been cancelled.`,
        tag: `cancelled-${(p.meeting_id as string) ?? "unknown"}`,
        url: `/meetings/${(p.meeting_id as string) ?? ""}`,
      }),
    };

    const buildPayload = PUSH_PAYLOAD_MAP[pushEventType];
    if (!buildPayload) return;

    try {
      await dispatchPushToTown(this.job, pushEventType, buildPayload(payload));
    } catch (err) {
      // Push failures should not break the notification pipeline
      console.error(`[notification] Push dispatch failed for ${pushEventType}:`, err);
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
