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
 * Three of them (`push/subscribe`, `push/unsubscribe`, `test/push`) DID call
 * `app.verifyAuth` — from inside the handler body rather than as a preHandler,
 * which is why a preHandler count read zero. That form works but is easy to
 * read past, and its `if (!request.user) return;` line silently returns an
 * empty 200 body on failure. They are preHandlers now like everything else.
 *
 * `POST /test/push` was deleted rather than authenticated. It was guarded by
 * `process.env.NODE_ENV !== "production"`, which is a guard that fails OPEN:
 * the route exists whenever the variable is unset or misspelled, which is
 * exactly what a hand-rolled container or a systemd unit gets wrong. It sent
 * an arbitrary title and body to a signed-in user's registered devices, and
 * nothing in the product needed it — push can be exercised end to end through
 * a real notification event. `git show` has it if it is ever wanted back.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotificationService } from "../services/notification-service.js";
// `dispatchPushToUser` is no longer imported here — it was only used by the
// deleted `/test/push` route. `lib/push.ts` keeps it for the real event path.
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

export async function notificationRoutes(app: FastifyInstance) {
  const supabase = app.supabase;

  /**
   * Managing a town's notification machinery — reading delivery telemetry,
   * clearing a bounce flag, firing an event — is `manage_notification_settings`
   * (C2). Delegable to staff on purpose: this is the town clerk's job, and
   * routing it through the admin role would mean an administrator has to clear
   * every bounced address personally.
   */
  const notificationAdmin = [app.verifyAuth, requirePermission(PERMISSIONS.C2)];

  // ── Postmark Webhook ───────────────────────────────────────────────
  // Public by necessity — Postmark has no session — and therefore verified by
  // the Basic credentials Postmark sends. `verifyPostmarkWebhook` REFUSES when
  // those are unconfigured; see its header for why that is not negotiable.
  //
  // (The former `config: { rawBody: true }` is gone. Nothing registers a
  // raw-body parser in this process, so it was inert, and it existed to
  // support a signature check Postmark does not offer.)

  app.post<{ Body: PostmarkWebhookBody }>(
    "/webhooks/postmark",
    { config: { ...PUBLIC_ROUTE }, preHandler: [verifyPostmarkWebhook()] },
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
              // Flag the subscriber to prevent future sends. subscriber_id
              // is a person id — the bounce flag itself still lives on
              // user_account, so this reaches it via person_id (an
              // account-less person has no account row to flag, and
              // therefore nothing that can bounce).
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
                  .eq("person_id", (delivery as { subscriber_id: string }).subscriber_id);
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
              // subscriber_id is a person id — see the hard-bounce branch above.
              await supabase
                .from("user_account")
                .update({
                  email_complained: true,
                  email_complained_at: new Date().toISOString(),
                })
                .eq("person_id", (delivery as { subscriber_id: string }).subscriber_id);
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
        app.log.error(
          { err, deliveryId, recordType: body.RecordType },
          "Postmark webhook processing error",
        );
      }
    },
  );

  // ── Admin: Summary Stats (last 30 days) ────────────────────────────

  // Every read below is scoped by `town_id` in the query rather than by the
  // database. `app.supabase` is the service-role client and bypasses RLS, so
  // without these filters a clerk in one town would be reading every town's
  // delivery telemetry and bounced addresses. Task D1 removes that client and
  // makes the scoping structural; these filters are what holds until it does.
  app.get(
    "/admin/notifications/summary",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data: deliveries } = await supabase
        .from("notification_delivery")
        .select("status, created_at")
        .eq("town_id", request.user!.townId)
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
    },
  );

  // ── Admin: Recent Events ───────────────────────────────────────────

  app.get(
    "/admin/notifications/events",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const { data: events } = await supabase
        .from("notification_event")
        .select("id, event_type, payload, status, created_at, processed_at")
        .eq("town_id", request.user!.townId)
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
    },
  );

  // ── Admin: Delivery Detail for an Event ───────────────────────────

  app.get<{ Params: { eventId: string } }>(
    "/admin/notifications/events/:eventId/deliveries",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const { eventId } = request.params;

      const { data } = await supabase
        .from("notification_delivery")
        .select(
          `
          id, status, postmark_message_id, sent_at, delivered_at, opened_at,
          error_message, retry_count, created_at,
          person:subscriber_id (id, name, email)
        `,
        )
        .eq("event_id", eventId)
        .eq("town_id", request.user!.townId)
        .order("created_at", { ascending: true });

      return reply.send(data ?? []);
    },
  );

  // ── Admin: Bounced / Complained Addresses ─────────────────────────

  app.get(
    "/admin/notifications/bounces",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const { data } = await supabase
        .from("user_account")
        .select(
          "id, email, display_name, email_bounced, email_bounced_at, email_complained, email_complained_at",
        )
        .eq("town_id", request.user!.townId)
        .or("email_bounced.eq.true,email_complained.eq.true")
        .order("email_bounced_at", { ascending: false });

      return reply.send(data ?? []);
    },
  );

  // ── Admin: Clear Bounce Flag ──────────────────────────────────────

  app.delete<{ Params: { userId: string } }>(
    "/admin/notifications/bounces/:userId",
    { preHandler: notificationAdmin },
    async (request, reply) => {
      const { userId } = request.params;
      // `supabase` here is the SERVICE-ROLE client, which bypasses RLS — so
      // this update is not scoped to a town by the database. Scoping it here
      // by the caller's town keeps one town's administrator from clearing
      // another town's bounce flag by guessing a uuid. Task D1 removes the
      // service-role client entirely and makes that structural; until then it
      // is this line.
      await supabase
        .from("user_account")
        .update({
          email_bounced: false,
          email_bounced_at: null,
          email_complained: false,
          email_complained_at: null,
        })
        .eq("id", userId)
        .eq("town_id", request.user!.townId);

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

    const { error } = await supabase.from("push_subscription").upsert(
      {
        user_account_id: request.user!.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_account_id,endpoint" },
    );

    if (error) {
      app.log.error({ error }, "Failed to save push subscription");
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

      await supabase
        .from("push_subscription")
        .delete()
        .eq("user_account_id", request.user!.id)
        .eq("endpoint", endpoint);

      return reply.code(204).send();
    },
  );

  // ── Create Notification Event ────────────────────────────────────
  //
  // This is the fan-out trigger: it queues an event that
  // `NotificationService` turns into email to every subscriber of a town, from
  // that town's own sending domain. It was unauthenticated, and it took
  // `town_id` from the request body — so an anonymous caller could name any
  // town and any payload. The payload becomes the template variables (see
  // `notification-service.ts`, `variables = { ...payload, … }`), which is the
  // other half of the `admin-alert.hbs` triple-stash this task also closed.
  //
  // `town_id` in the body is now checked against the caller's town rather than
  // trusted. Rejecting a mismatch rather than silently overriding it means a
  // caller that believes it is addressing another town finds out.

  app.post<{
    Body: {
      event_type: NotificationEventType;
      town_id?: string;
      payload: Record<string, unknown>;
    };
  }>("/notifications/events", { preHandler: notificationAdmin }, async (request, reply) => {
    const { event_type, town_id, payload } = request.body ?? {};
    const callerTownId = request.user!.townId;

    if (town_id && town_id !== callerTownId) {
      return reply.forbidden("Cannot create a notification event for another town");
    }
    if (!event_type) {
      return reply.badRequest("event_type is required");
    }

    const service = new NotificationService(supabase);
    const eventId = await service.createNotificationEvent(event_type, callerTownId, payload ?? {});
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
