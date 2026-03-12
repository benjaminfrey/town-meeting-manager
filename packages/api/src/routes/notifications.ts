/**
 * Notification routes.
 *
 * POST /api/webhooks/postmark          — Postmark delivery callbacks
 * GET  /api/admin/notifications/summary    — 30-day summary stats
 * GET  /api/admin/notifications/events     — recent events with delivery counts
 * GET  /api/admin/notifications/events/:id/deliveries — per-event deliveries
 * GET  /api/admin/notifications/bounces    — bounced/complained addresses
 * DELETE /api/admin/notifications/bounces/:userId  — clear bounce flag
 * POST /api/admin/notifications/events    — create a notification event (internal)
 */

import type { FastifyInstance } from "fastify";
import { NotificationService } from "../services/notification-service.js";
import type { NotificationEventType } from "@town-meeting/shared";

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

export async function notificationRoutes(app: FastifyInstance) {
  const supabase = app.supabase;

  // ── Postmark Webhook ───────────────────────────────────────────────

  app.post<{ Body: PostmarkWebhookBody }>(
    "/webhooks/postmark",
    { config: { rawBody: true } },
    async (request, reply) => {
      // Acknowledge immediately — process async
      reply.status(200).send({ ok: true });

      const body = request.body;
      const meta = body.Metadata ?? {};
      const deliveryId = meta.delivery_id;

      if (!deliveryId) return;

      try {
        switch (body.RecordType) {
          case "Delivery": {
            await supabase
              .from("notification_delivery")
              .update({
                status: "delivered",
                delivered_at: body.DeliveredAt ?? new Date().toISOString(),
              })
              .eq("id", deliveryId);
            break;
          }

          case "Bounce": {
            const isHardBounce = body.Type === "HardBounce";
            await supabase
              .from("notification_delivery")
              .update({
                status: "bounced",
                error_message: body.Description ?? body.Type ?? "Bounce",
              })
              .eq("id", deliveryId);

            if (isHardBounce && meta.delivery_id) {
              // Flag the subscriber to prevent future sends
              const { data: delivery } = await supabase
                .from("notification_delivery")
                .select("subscriber_id")
                .eq("id", deliveryId)
                .single();

              if (delivery) {
                await supabase
                  .from("user_account")
                  .update({
                    email_bounced: true,
                    email_bounced_at: new Date().toISOString(),
                  })
                  .eq("id", (delivery as { subscriber_id: string }).subscriber_id);
              }
            } else if (!isHardBounce) {
              // Soft bounce — schedule retry
              const { data: delivery } = await supabase
                .from("notification_delivery")
                .select("retry_count")
                .eq("id", deliveryId)
                .single();

              const retryCount = (delivery as { retry_count: number } | null)?.retry_count ?? 0;
              if (retryCount < 3) {
                const nextRetryMs = retryCount === 0 ? 5 * 60 * 1000 : 30 * 60 * 1000;
                await supabase
                  .from("notification_delivery")
                  .update({
                    status: "failed",
                    next_retry_at: new Date(Date.now() + nextRetryMs).toISOString(),
                  })
                  .eq("id", deliveryId);
              }
            }
            break;
          }

          case "SpamComplaint": {
            await supabase
              .from("notification_delivery")
              .update({ status: "complained" })
              .eq("id", deliveryId);

            const { data: delivery } = await supabase
              .from("notification_delivery")
              .select("subscriber_id")
              .eq("id", deliveryId)
              .single();

            if (delivery) {
              await supabase
                .from("user_account")
                .update({
                  email_complained: true,
                  email_complained_at: new Date().toISOString(),
                })
                .eq("id", (delivery as { subscriber_id: string }).subscriber_id);
            }
            break;
          }

          case "Open": {
            await supabase
              .from("notification_delivery")
              .update({ opened_at: body.ReceivedAt ?? new Date().toISOString() })
              .eq("id", deliveryId);
            break;
          }

          default:
            break;
        }
      } catch (err) {
        app.log.error({ err, deliveryId, recordType: body.RecordType },
          "Postmark webhook processing error");
      }
    },
  );

  // ── Admin: Summary Stats (last 30 days) ────────────────────────────

  app.get("/admin/notifications/summary", async (_request, reply) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: deliveries } = await supabase
      .from("notification_delivery")
      .select("status, created_at")
      .gte("created_at", since);

    const rows = (deliveries ?? []) as { status: string }[];
    const total = rows.length;
    const sent = rows.filter((r) => r.status !== "pending").length;
    const delivered = rows.filter((r) => r.status === "delivered").length;
    const bounced = rows.filter((r) => r.status === "bounced").length;
    const complained = rows.filter((r) => r.status === "complained").length;

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
  });

  // ── Admin: Recent Events ───────────────────────────────────────────

  app.get("/admin/notifications/events", async (_request, reply) => {
    const { data: events } = await supabase
      .from("notification_event")
      .select("id, event_type, payload, status, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!events) return reply.send([]);

    // Attach delivery counts to each event
    const enriched = await Promise.all(
      (events as EventRow[]).map(async (evt) => {
        const service = new NotificationService(supabase);
        const summary = await service.getDeliverySummary(evt.id);
        return { ...evt, delivery: summary };
      }),
    );

    return reply.send(enriched);
  });

  // ── Admin: Delivery Detail for an Event ───────────────────────────

  app.get<{ Params: { eventId: string } }>(
    "/admin/notifications/events/:eventId/deliveries",
    async (request, reply) => {
      const { eventId } = request.params;

      const { data } = await supabase
        .from("notification_delivery")
        .select(`
          id, status, postmark_message_id, sent_at, delivered_at, opened_at,
          error_message, retry_count, created_at,
          user_account:subscriber_id (id, email, display_name)
        `)
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });

      return reply.send(data ?? []);
    },
  );

  // ── Admin: Bounced / Complained Addresses ─────────────────────────

  app.get("/admin/notifications/bounces", async (_request, reply) => {
    const { data } = await supabase
      .from("user_account")
      .select("id, email, display_name, email_bounced, email_bounced_at, email_complained, email_complained_at")
      .or("email_bounced.eq.true,email_complained.eq.true")
      .order("email_bounced_at", { ascending: false });

    return reply.send(data ?? []);
  });

  // ── Admin: Clear Bounce Flag ──────────────────────────────────────

  app.delete<{ Params: { userId: string } }>(
    "/admin/notifications/bounces/:userId",
    async (request, reply) => {
      const { userId } = request.params;
      await supabase
        .from("user_account")
        .update({
          email_bounced: false,
          email_bounced_at: null,
          email_complained: false,
          email_complained_at: null,
        })
        .eq("id", userId);

      return reply.send({ ok: true });
    },
  );

  // ── Internal: Create Notification Event ──────────────────────────

  app.post<{
    Body: {
      event_type: NotificationEventType;
      town_id: string;
      payload: Record<string, unknown>;
    };
  }>("/notifications/events", async (request, reply) => {
    const { event_type, town_id, payload } = request.body;
    const service = new NotificationService(supabase);
    const eventId = await service.createNotificationEvent(event_type, town_id, payload);
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
