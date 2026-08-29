/**
 * Notification routes.
 *
 * POST   /api/webhooks/postmark                       — public, Basic-auth verified
 * GET    /api/admin/notifications/summary             — C2
 * GET    /api/admin/notifications/events              — C2
 * GET    /api/admin/notifications/events/:id/deliveries — C2
 * GET    /api/admin/notifications/bounces             — C2
 * DELETE /api/admin/notifications/bounces/:userId     — C2
 * POST   /api/notifications/push/subscribe            — session
 * DELETE /api/notifications/push/unsubscribe          — session
 * POST   /api/notifications/events                    — C2
 *
 * ─── Task G1 ──────────────────────────────────────────────────────────────
 *
 * Every route in this file was reachable without authentication. The webhook
 * legitimately has to be — Postmark calls it, and Postmark has no session —
 * so it is marked public and verified by HTTP Basic credentials instead (see
 * `auth/postmark-webhook-auth.ts`; Postmark does not sign its webhooks). The
 * rest are administrative and now carry `verifyAuth` plus the
 * `manage_notification_settings` permission.
 *
 * `POST /test/push` was deleted rather than authenticated. It was guarded by
 * `process.env.NODE_ENV !== "production"`, which is a guard that fails OPEN.
 * `git show` has it if it is ever wanted back.
 *
 * ─── Task D1c: nothing here reaches the database through Supabase ─────────
 *
 * The comments this file used to carry — "`app.supabase` is the service-role
 * client and bypasses RLS, so without these filters a clerk in one town would
 * be reading every town's delivery telemetry", "Task D1 removes that client
 * and makes the scoping structural" — described hand-written `.eq("town_id",
 * request.user!.townId)` filters holding the line. Those filters are gone,
 * along with the client. Every authenticated route below runs its queries
 * through `request.withTenant`, so tenancy is decided by row level security
 * and a forgotten filter is no longer a cross-tenant read.
 *
 * The webhook is the one route with no session, and therefore the one that
 * cannot get its tenant that way. See its handler for how it gets one and why
 * that is safe.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { NotificationService } from "../services/notification-service.js";
import { withTenant, type TenantTx } from "../db/with-tenant.js";
import { tenantJob } from "../jobs/tenant-job.js";
import { toRows } from "../db/rows.js";
import { PUBLIC_ROUTE } from "../auth/route-access.js";
import { verifyPostmarkWebhook } from "../auth/postmark-webhook-auth.js";
import { requirePermission } from "../plugins/auth.js";
import { PERMISSIONS, type NotificationEventType } from "@town-meeting/shared";

// ─── Postmark webhook body types ─────────────────────────────────────

interface PostmarkWebhookBody {
  RecordType: string;
  MessageID: string;
  Metadata?: Record<string, string>;
  // Delivery
  DeliveredAt?: string;
  // Bounce
  Type?: string;
  Description?: string;
  BouncedAt?: string;
  Email?: string;
  // Open
  ReceivedAt?: string;
  // Click
  ClickLocation?: string;
  OriginalLink?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rows<T>(result: unknown, what: string): T[] {
  return toRows<T>(result, (message) => new Error(`${what}: ${message}`));
}

/**
 * The tenant-scoped runner for an authenticated request.
 *
 * `auth/fastify.ts` sets `request.withTenant` on every non-public route before
 * any preHandler runs, so on the routes below it is always present. The throw
 * is not defensive noise — it is what keeps the `!` off the call sites, so a
 * future route added to this file without a session fails loudly here rather
 * than crashing inside a handler.
 */
function tenantOf(request: FastifyRequest): <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T> {
  const run = request.withTenant;
  if (!run) {
    throw new Error(
      "notification routes: no tenant context on an authenticated route. Every route " +
        "in this file except the Postmark webhook requires a session; the webhook " +
        "resolves its town from the delivery metadata instead.",
    );
  }
  return run;
}

export async function notificationRoutes(app: FastifyInstance) {
  /**
   * Managing a town's notification machinery — reading delivery telemetry,
   * clearing a bounce flag, firing an event — is `manage_notification_settings`
   * (C2). Delegable to staff on purpose: this is the town clerk's job, and
   * routing it through the admin role would mean an administrator has to clear
   * every bounced address personally.
   */
  const notificationAdmin = [app.verifyAuth, requirePermission(PERMISSIONS.C2)];

  // ── Postmark Webhook ───────────────────────────────────────────────
  //
  // Public by necessity — Postmark has no session — and therefore verified by
  // the Basic credentials Postmark sends. `verifyPostmarkWebhook` REFUSES when
  // those are unconfigured; see its header for why that is not negotiable.
  //
  // ─── Where its tenant comes from (Task D1c) ─────────────────────────────
  //
  // From `Metadata.town_id`, which this API set on the outbound message
  // (`notification-service.ts`, `metadata: { town_id, event_id, delivery_id }`)
  // and which Postmark echoes back. That is a value arriving in a request
  // body, so it is treated as a HINT and never as an authorisation — exactly
  // the way `better_auth.user_tenant` is a hint in `auth/tenant-context.ts`.
  //
  // What makes it safe is that the hint is USED, not trusted: every statement
  // below runs inside `withTenant(hint)` and matches on `delivery_id`. A
  // caller who named the wrong town updates ZERO rows, because the delivery is
  // not visible from there — so the worst a forged pairing achieves is to do
  // nothing, which is logged. There is no shape of it that writes another
  // town's row.
  //
  // Without a usable hint the webhook is acknowledged and dropped. Postmark
  // retries on a non-2xx and this is not a condition a retry fixes.

  app.post<{ Body: PostmarkWebhookBody }>(
    "/webhooks/postmark",
    { config: { ...PUBLIC_ROUTE }, preHandler: [verifyPostmarkWebhook()] },
    async (request, reply) => {
      // Acknowledge immediately — process async
      reply.status(200).send({ ok: true });

      const body = request.body;
      const meta = body.Metadata ?? {};
      const deliveryId = meta.delivery_id;
      const townId = meta.town_id;

      if (!deliveryId || !UUID_RE.test(deliveryId)) return;
      if (!townId || !UUID_RE.test(townId)) {
        app.log.warn(
          { deliveryId, recordType: body.RecordType },
          "Postmark webhook carried no usable town_id in Metadata; nothing to scope the " +
            "update to, so it is dropped rather than applied without a tenant",
        );
        return;
      }

      try {
        await withTenant(app.tenantDb, { townId }, async (tx) => {
          switch (body.RecordType) {
            case "Delivery": {
              await tx.execute(sql`
                UPDATE notification_delivery
                   SET status = 'delivered',
                       delivered_at = ${body.DeliveredAt ?? new Date().toISOString()}::timestamptz
                 WHERE id = ${deliveryId}::uuid
              `);
              break;
            }

            case "Bounce": {
              const isHardBounce = body.Type === "HardBounce";
              const updated = rows<{ subscriber_id: string; retry_count: number }>(
                await tx.execute(sql`
                  UPDATE notification_delivery
                     SET status = 'bounced',
                         error_message = ${body.Description ?? body.Type ?? "Bounce"}
                   WHERE id = ${deliveryId}::uuid
                  RETURNING subscriber_id, retry_count
                `),
                "postmark webhook",
              );

              const delivery = updated[0];
              if (!delivery) {
                app.log.warn(
                  { deliveryId, townId },
                  "Postmark webhook named a delivery that is not visible from the town its " +
                    "metadata claims; no row was changed",
                );
                break;
              }

              if (isHardBounce) {
                // Flag the subscriber to prevent future sends. `subscriber_id`
                // is a person id — the bounce flag itself still lives on
                // user_account, so this reaches it via person_id (an
                // account-less person has no account row to flag, and
                // therefore nothing that can bounce).
                await tx.execute(sql`
                  UPDATE user_account
                     SET email_bounced = true, email_bounced_at = now()
                   WHERE person_id = ${String(delivery.subscriber_id)}::uuid
                `);
              } else {
                // Soft bounce — schedule retry
                const retryCount = Number(delivery.retry_count ?? 0);
                if (retryCount < 3) {
                  const nextRetryMs = retryCount === 0 ? 5 * 60 * 1000 : 30 * 60 * 1000;
                  await tx.execute(sql`
                    UPDATE notification_delivery
                       SET status = 'failed',
                           next_retry_at = ${new Date(Date.now() + nextRetryMs).toISOString()}::timestamptz
                     WHERE id = ${deliveryId}::uuid
                  `);
                }
              }
              break;
            }

            case "SpamComplaint": {
              const updated = rows<{ subscriber_id: string }>(
                await tx.execute(sql`
                  UPDATE notification_delivery
                     SET status = 'complained'
                   WHERE id = ${deliveryId}::uuid
                  RETURNING subscriber_id
                `),
                "postmark webhook",
              );

              const delivery = updated[0];
              if (!delivery) break;

              // subscriber_id is a person id — see the hard-bounce branch above.
              await tx.execute(sql`
                UPDATE user_account
                   SET email_complained = true, email_complained_at = now()
                 WHERE person_id = ${String(delivery.subscriber_id)}::uuid
              `);
              break;
            }

            case "Open": {
              await tx.execute(sql`
                UPDATE notification_delivery
                   SET opened_at = ${body.ReceivedAt ?? new Date().toISOString()}::timestamptz
                 WHERE id = ${deliveryId}::uuid
              `);
              break;
            }

            default:
              break;
          }
        });
      } catch (err) {
        app.log.error(
          { err, deliveryId, recordType: body.RecordType },
          "Postmark webhook processing error",
        );
      }
    },
  );

  // ── Admin: Summary Stats (last 30 days) ────────────────────────────

  app.get(
    "/admin/notifications/summary",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const result = await tenantOf(request)(async (tx) =>
        rows<{ status: string }>(
          await tx.execute(sql`
            SELECT status FROM notification_delivery
             WHERE created_at >= now() - interval '30 days'
          `),
          "notifications summary",
        ),
      );

      const total = result.length;
      const sent = result.filter((r) => r.status !== "pending").length;
      const delivered = result.filter((r) => r.status === "delivered").length;
      const bounced = result.filter((r) => r.status === "bounced").length;
      const complained = result.filter((r) => r.status === "complained").length;

      return reply.send({
        total,
        sent,
        delivered,
        bounced,
        complained,
        deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
        bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
        complaintRate: sent > 0 ? Math.round((complained / sent) * 100) : 0,
      });
    },
  );

  // ── Admin: Recent Events ───────────────────────────────────────────
  //
  // Events and their delivery counts in ONE query. The previous version read
  // the events and then ran a `getDeliverySummary` per event — 51 round trips
  // for a page of 50 — which was affordable only because none of it was
  // transactional. It is one aggregate now.

  app.get(
    "/admin/notifications/events",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const events = await tenantOf(request)(async (tx) =>
        rows<EventRow>(
          await tx.execute(sql`
            SELECT e.id, e.event_type, e.payload, e.status, e.created_at, e.processed_at,
                   jsonb_build_object(
                     'total',     count(d.id),
                     'pending',   count(*) FILTER (WHERE d.status = 'pending'),
                     'sent',      count(*) FILTER (WHERE d.status = 'sent'),
                     'delivered', count(*) FILTER (WHERE d.status = 'delivered'),
                     'bounced',   count(*) FILTER (WHERE d.status = 'bounced'),
                     'failed',    count(*) FILTER (WHERE d.status = 'failed')
                   ) AS delivery
              FROM notification_event e
              LEFT JOIN notification_delivery d ON d.event_id = e.id
             GROUP BY e.id
             ORDER BY e.created_at DESC
             LIMIT 50
          `),
          "notification events",
        ),
      );

      return reply.send(events);
    },
  );

  // ── Admin: Delivery Detail for an Event ───────────────────────────

  app.get<{ Params: { eventId: string } }>(
    "/admin/notifications/events/:eventId/deliveries",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const { eventId } = request.params;
      if (!UUID_RE.test(eventId)) return reply.badRequest("eventId must be a uuid");

      const deliveries = await tenantOf(request)(async (tx) =>
        rows(
          await tx.execute(sql`
            SELECT d.id, d.status, d.postmark_message_id, d.sent_at, d.delivered_at, d.opened_at,
                   d.error_message, d.retry_count, d.created_at,
                   jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email) AS person
              FROM notification_delivery d
              LEFT JOIN person p ON p.id = d.subscriber_id
             WHERE d.event_id = ${eventId}::uuid
             ORDER BY d.created_at ASC
          `),
          "event deliveries",
        ),
      );

      return reply.send(deliveries);
    },
  );

  // ── Admin: Bounced / Complained Addresses ─────────────────────────

  app.get(
    "/admin/notifications/bounces",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const bounces = await tenantOf(request)(async (tx) =>
        rows(
          await tx.execute(sql`
            SELECT id, email, display_name, email_bounced, email_bounced_at,
                   email_complained, email_complained_at
              FROM user_account
             WHERE email_bounced = true OR email_complained = true
             ORDER BY email_bounced_at DESC NULLS LAST
          `),
          "bounced addresses",
        ),
      );

      return reply.send(bounces);
    },
  );

  // ── Admin: Clear Bounce Flag ──────────────────────────────────────

  app.delete<{ Params: { userId: string } }>(
    "/admin/notifications/bounces/:userId",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const { userId } = request.params;
      if (!UUID_RE.test(userId)) return reply.badRequest("userId must be a uuid");

      // No `.eq("town_id", …)` any more. `app.town_id` is set for the length
      // of this transaction, so an id belonging to another town matches
      // nothing — one town's administrator cannot clear another's bounce flag
      // by guessing a uuid, and that is now the database's guarantee rather
      // than this line's.
      await tenantOf(request)(async (tx) => {
        await tx.execute(sql`
          UPDATE user_account
             SET email_bounced = false, email_bounced_at = NULL,
                 email_complained = false, email_complained_at = NULL
           WHERE id = ${userId}::uuid
        `);
      });

      return reply.send({ ok: true });
    },
  );

  // ── Push Subscription: Subscribe ─────────────────────────────────

  const pushSubscriptionSchema = z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
    userAgent: z.string().optional(),
  });

  app.post<{
    Body: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string };
  }>("/notifications/push/subscribe", { preHandler: [app.verifyAuth] }, async (request, reply) => {
    const parsed = pushSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid push subscription data");
    }

    const { endpoint, keys, userAgent } = parsed.data;

    try {
      await tenantOf(request)(async (tx) => {
        await tx.execute(sql`
          INSERT INTO push_subscription
                 (user_account_id, endpoint, p256dh, auth, user_agent, updated_at)
          VALUES (${request.user!.id}::uuid, ${endpoint}, ${keys.p256dh}, ${keys.auth},
                  ${userAgent ?? null}, now())
          ON CONFLICT (user_account_id, endpoint)
          DO UPDATE SET p256dh = EXCLUDED.p256dh,
                        auth = EXCLUDED.auth,
                        user_agent = EXCLUDED.user_agent,
                        updated_at = now()
        `);
      });
    } catch (err) {
      app.log.error({ err }, "Failed to save push subscription");
      return reply.internalServerError("Failed to save subscription");
    }

    return reply.send({ ok: true });
  });

  // ── Push Subscription: Unsubscribe ──────────────────────────────

  app.delete<{
    Body: { endpoint: string };
  }>(
    "/notifications/push/unsubscribe",
    { preHandler: [app.verifyAuth] },
    async (request, reply) => {
      const { endpoint } = request.body ?? {};
      if (!endpoint) {
        return reply.badRequest("Missing endpoint");
      }

      await tenantOf(request)(async (tx) => {
        await tx.execute(sql`
          DELETE FROM push_subscription
           WHERE user_account_id = ${request.user!.id}::uuid
             AND endpoint = ${endpoint}
        `);
      });

      return reply.code(204).send();
    },
  );

  // ── Create Notification Event ────────────────────────────────────
  //
  // This is the fan-out trigger: it queues an event that
  // `NotificationService` turns into email to every subscriber of a town, from
  // that town's own sending domain. It was unauthenticated, and it took
  // `town_id` from the request body — so an anonymous caller could name any
  // town and any payload.
  //
  // Task D1c removed the parameter rather than checking it. The service is
  // constructed from a `TenantJob` built out of the resolved session, so there
  // is no second place to state the town and therefore nothing for a body
  // field to disagree with. A body that still names one is refused rather than
  // silently overridden, so a caller that believes it is addressing another
  // town finds out.

  app.post<{
    Body: {
      event_type: NotificationEventType;
      town_id?: string;
      payload: Record<string, unknown>;
    };
  }>("/notifications/events", { preHandler: notificationAdmin }, async (request, reply) => {
    const { event_type, town_id, payload } = request.body ?? {};
    const callerTownId = request.tenant!.townId;

    if (town_id && town_id !== callerTownId) {
      return reply.forbidden("Cannot create a notification event for another town");
    }
    if (!event_type) {
      return reply.badRequest("event_type is required");
    }

    const service = new NotificationService(tenantJob(app.tenantDb, callerTownId));
    const eventId = await service.createNotificationEvent(event_type, payload ?? {});
    return reply.status(201).send({ event_id: eventId });
  });
}

interface EventRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  processed_at: string | null;
}
