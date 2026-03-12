/**
 * Invitation routes.
 *
 * POST /api/invitations/:id/send      — send invitation email
 * POST /api/invitations/:id/resend    — generate new token + resend
 * GET  /api/invitations/validate      — public: validate token, return details
 * POST /api/invitations/accept        — public: accept invitation, set up account
 * GET  /api/unsubscribe               — public: unsubscribe from email type
 * PUT  /api/notifications/preferences — update email notification preferences
 * GET  /api/notifications/preferences — get current user's preferences
 */

import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  renderEmailTemplate,
  EmailSenderService,
} from "../services/email-sender.js";
import { getDefaultPostmarkClient } from "../lib/postmark.js";

const APP_URL = process.env.APP_URL ?? "https://app.townmeetingmanager.com";
const APP_SECRET = process.env.APP_SECRET ?? "default-secret-change-in-production";

// ─── HMAC-based unsubscribe tokens ───────────────────────────────────

function generateUnsubscribeToken(userId: string, eventType: string): string {
  const data = `${userId}:${eventType}`;
  const hmac = crypto.createHmac("sha256", APP_SECRET).update(data).digest("hex");
  return Buffer.from(`${userId}:${eventType}:${hmac}`).toString("base64url");
}

function validateUnsubscribeToken(token: string): { userId: string; eventType: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 3) return null;
    const [userId, eventType, ...hmacParts] = parts;
    const hmac = hmacParts.join(":");
    if (!userId || !eventType || !hmac) return null;
    const expected = crypto.createHmac("sha256", APP_SECRET)
      .update(`${userId}:${eventType}`)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
    return { userId, eventType };
  } catch {
    return null;
  }
}

// ─── Route registration ───────────────────────────────────────────────

export async function invitationRoutes(app: FastifyInstance) {
  const supabase = app.supabase;

  // ── POST /api/invitations/:id/send ───────────────────────────────
  // Authenticated: send initial invitation email

  app.post<{ Params: { id: string } }>(
    "/invitations/:id/send",
    { preHandler: [app.verifyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      // Fetch invitation with person + town
      const { data: inv } = await supabase
        .from("invitation")
        .select("id, person_id, user_account_id, town_id, token, expires_at, status, role, email")
        .eq("id", id)
        .single();

      if (!inv) return reply.notFound("Invitation not found");
      if ((inv.town_id as string) !== user.townId) return reply.forbidden();

      if ((inv.status as string) === "accepted") {
        return reply.badRequest("Invitation already accepted");
      }

      // Get person email if not on invitation
      let recipientEmail = (inv.email as string) ?? null;
      let recipientName = "Team Member";

      const { data: person } = await supabase
        .from("person")
        .select("name, email")
        .eq("id", inv.person_id as string)
        .single();

      if (person) {
        recipientEmail = recipientEmail ?? (person.email as string);
        recipientName = (person.name as string) ?? recipientName;
      }

      if (!recipientEmail) {
        return reply.badRequest("No email address found for this person");
      }

      // Get town info
      const { data: town } = await supabase
        .from("town")
        .select("name, subdomain")
        .eq("id", inv.town_id as string)
        .single();

      if (!town) return reply.notFound("Town not found");

      // Get inviter name
      const { data: inviter } = await supabase
        .from("user_account")
        .select("display_name, email")
        .eq("id", user.id)
        .single();

      const inviterName = (inviter?.display_name as string)
        ?? (inviter?.email as string)
        ?? "Town Administrator";

      const setupUrl = `${APP_URL}/invite/accept?token=${inv.token as string}`;
      const expiresDate = new Date(inv.expires_at as string).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      // Render template
      const { html, text, subject } = renderEmailTemplate("invite-user", {
        recipientName,
        townName: town.name as string,
        role: (inv.role as string) ?? "board_member",
        inviterName,
        setupUrl,
        expiresAt: expiresDate,
        isBroadcast: false,
      });

      // Send via Postmark
      try {
        const pmClient = getDefaultPostmarkClient();
        const sender = new EmailSenderService(pmClient);

        const subdomain = (town.subdomain as string | null) ?? "notifications";
        const from = `Town of ${town.name as string} <notifications@${subdomain}.townmeetingmanager.com>`;

        const result = await sender.sendEmail({
          to: recipientEmail,
          from,
          subject,
          htmlBody: html,
          textBody: text,
          tag: "user_invited",
          messageStream: "outbound",
          metadata: { invitation_id: id, town_id: inv.town_id as string },
        });

        // Update invitation sent_at and email
        await supabase
          .from("invitation")
          .update({
            sent_at: new Date().toISOString(),
            email: recipientEmail,
            invited_by: user.id,
          })
          .eq("id", id);

        return reply.status(200).send({ ok: true, message_id: result.MessageID });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Email send failed";
        app.log.error({ err, invitationId: id }, "Failed to send invitation email");
        return reply.internalServerError(msg);
      }
    },
  );

  // ── POST /api/invitations/:id/resend ─────────────────────────────
  // Authenticated: generate new token + resend

  app.post<{ Params: { id: string } }>(
    "/invitations/:id/resend",
    { preHandler: [app.verifyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user!;

      const { data: inv } = await supabase
        .from("invitation")
        .select("id, person_id, user_account_id, town_id, status, role, email")
        .eq("id", id)
        .single();

      if (!inv) return reply.notFound("Invitation not found");
      if ((inv.town_id as string) !== user.townId) return reply.forbidden();
      if ((inv.status as string) === "accepted") {
        return reply.badRequest("Invitation already accepted");
      }

      // Generate new token + extend expiry
      const newToken = crypto.randomUUID();
      const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await supabase
        .from("invitation")
        .update({
          token: newToken,
          expires_at: newExpiry,
          status: "pending",
          sent_at: null,
        })
        .eq("id", id);

      // Re-fetch with new token, then send
      const { data: updated } = await supabase
        .from("invitation")
        .select("id, token, expires_at, email, role")
        .eq("id", id)
        .single();

      if (!updated) return reply.internalServerError();

      // Get person for name/email
      let recipientEmail = (updated.email as string) ?? null;
      let recipientName = "Team Member";

      const { data: person } = await supabase
        .from("person")
        .select("name, email")
        .eq("id", inv.person_id as string)
        .single();

      if (person) {
        recipientEmail = recipientEmail ?? (person.email as string);
        recipientName = (person.name as string) ?? recipientName;
      }

      if (!recipientEmail) return reply.badRequest("No email address found");

      const { data: town } = await supabase
        .from("town")
        .select("name, subdomain")
        .eq("id", inv.town_id as string)
        .single();

      if (!town) return reply.notFound("Town not found");

      const { data: inviter } = await supabase
        .from("user_account")
        .select("display_name, email")
        .eq("id", user.id)
        .single();

      const inviterName = (inviter?.display_name as string)
        ?? (inviter?.email as string)
        ?? "Town Administrator";

      const setupUrl = `${APP_URL}/invite/accept?token=${updated.token as string}`;
      const expiresDate = new Date(updated.expires_at as string).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      const { html, text, subject } = renderEmailTemplate("invite-user", {
        recipientName,
        townName: town.name as string,
        role: (updated.role as string) ?? (inv.role as string) ?? "board_member",
        inviterName,
        setupUrl,
        expiresAt: expiresDate,
        isBroadcast: false,
      });

      try {
        const pmClient = getDefaultPostmarkClient();
        const sender = new EmailSenderService(pmClient);
        const subdomain = (town.subdomain as string | null) ?? "notifications";
        const from = `Town of ${town.name as string} <notifications@${subdomain}.townmeetingmanager.com>`;

        await sender.sendEmail({
          to: recipientEmail,
          from,
          subject,
          htmlBody: html,
          textBody: text,
          tag: "user_invited",
          messageStream: "outbound",
          metadata: { invitation_id: id, town_id: inv.town_id as string },
        });

        await supabase
          .from("invitation")
          .update({ sent_at: new Date().toISOString(), email: recipientEmail, invited_by: user.id })
          .eq("id", id);

        return reply.send({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Email send failed";
        return reply.internalServerError(msg);
      }
    },
  );

  // ── GET /api/invitations/validate ────────────────────────────────
  // Public: validate token, return details for acceptance page

  app.get<{ Querystring: { token: string } }>(
    "/invitations/validate",
    async (request, reply) => {
      const { token } = request.query;
      if (!token) return reply.badRequest("token required");

      const { data: inv } = await supabase
        .from("invitation")
        .select("id, person_id, user_account_id, town_id, token, expires_at, status, role")
        .eq("token", token)
        .single();

      if (!inv) return reply.notFound("Invitation not found or already used");

      if ((inv.status as string) === "accepted") {
        return reply.send({ valid: false, reason: "already_accepted" });
      }

      if (new Date(inv.expires_at as string) < new Date()) {
        return reply.send({ valid: false, reason: "expired" });
      }

      // Get person info
      const { data: person } = await supabase
        .from("person")
        .select("name, email")
        .eq("id", inv.person_id as string)
        .single();

      // Get town info
      const { data: town } = await supabase
        .from("town")
        .select("name")
        .eq("id", inv.town_id as string)
        .single();

      return reply.send({
        valid: true,
        invitation_id: inv.id,
        person_name: person?.name ?? null,
        person_email: person?.email ?? null,
        town_name: town?.name ?? null,
        role: inv.role ?? "board_member",
        expires_at: inv.expires_at,
      });
    },
  );

  // ── POST /api/invitations/accept ─────────────────────────────────
  // Public: accept invitation — creates auth user + links account

  app.post<{
    Body: {
      token: string;
      password: string;
      display_name?: string;
    };
  }>("/invitations/accept", async (request, reply) => {
    const { token, password, display_name } = request.body;

    if (!token || !password) {
      return reply.badRequest("token and password required");
    }

    // Validate invitation
    const { data: inv } = await supabase
      .from("invitation")
      .select("id, person_id, user_account_id, town_id, status, expires_at, role")
      .eq("token", token)
      .single();

    if (!inv) return reply.notFound("Invalid invitation");
    if ((inv.status as string) === "accepted") {
      return reply.badRequest("Invitation already accepted");
    }
    if (new Date(inv.expires_at as string) < new Date()) {
      return reply.badRequest("Invitation has expired");
    }

    // Get person for email
    const { data: person } = await supabase
      .from("person")
      .select("name, email")
      .eq("id", inv.person_id as string)
      .single();

    if (!person?.email) {
      return reply.internalServerError("No email found for this person");
    }

    const email = person.email as string;
    const name = display_name ?? (person.name as string) ?? email;

    // Create Supabase auth user
    // Note: This uses the service_role key to create a user server-side.
    // In production, supabase.auth.admin methods require service_role key.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm since they accepted via invitation
      user_metadata: {
        display_name: name,
        town_id: inv.town_id as string,
        role: inv.role as string ?? "board_member",
      },
    });

    if (authError || !authData.user) {
      app.log.error({ authError }, "Failed to create auth user for invitation acceptance");
      return reply.internalServerError(
        authError?.message ?? "Failed to create account",
      );
    }

    const authUserId = authData.user.id;
    const now = new Date().toISOString();

    // Link auth user to user_account + set email/display_name
    await supabase
      .from("user_account")
      .update({
        auth_user_id: authUserId,
        email,
        display_name: name,
      })
      .eq("id", inv.user_account_id as string);

    // Mark invitation accepted
    await supabase
      .from("invitation")
      .update({ status: "accepted", accepted_at: now })
      .eq("id", inv.id as string);

    return reply.status(200).send({
      ok: true,
      email,
      town_id: inv.town_id,
      role: inv.role,
    });
  });

  // ── GET /api/unsubscribe ─────────────────────────────────────────
  // Public: unsubscribe from a specific email type via signed token

  app.get<{ Querystring: { t: string } }>(
    "/unsubscribe",
    async (request, reply) => {
      const { t: token } = request.query;
      if (!token) return reply.badRequest("token required");

      const parsed = validateUnsubscribeToken(token);
      if (!parsed) {
        return reply.status(400).send({ error: "Invalid or expired unsubscribe link" });
      }

      const { userId, eventType } = parsed;

      // Upsert preference: enabled = false
      await supabase
        .from("subscriber_notification_preference")
        .upsert(
          {
            subscriber_id: userId,
            event_type: eventType,
            channel: "email",
            enabled: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "subscriber_id,event_type,channel" },
        );

      // Return a simple HTML confirmation
      return reply
        .header("Content-Type", "text/html")
        .status(200)
        .send(`<!DOCTYPE html>
<html>
<head><title>Unsubscribed</title>
<style>body{font-family:Arial,sans-serif;max-width:600px;margin:60px auto;text-align:center;color:#374151;}
h1{color:#1a3a6b;}a{color:#1a3a6b;}</style></head>
<body>
<h1>You've been unsubscribed</h1>
<p>You will no longer receive <strong>${eventType.replace(/_/g, " ")}</strong> emails.</p>
<p>You can <a href="${APP_URL}/settings/notifications">manage all your notification preferences</a> at any time.</p>
</body>
</html>`);
    },
  );

  // ── GET /api/notifications/preferences ──────────────────────────
  // Authenticated: get current user's email preferences

  app.get(
    "/notifications/preferences",
    { preHandler: [app.verifyAuth] },
    async (request, reply) => {
      const user = request.user!;

      const { data } = await supabase
        .from("subscriber_notification_preference")
        .select("event_type, channel, enabled")
        .eq("subscriber_id", user.id);

      return reply.send(data ?? []);
    },
  );

  // ── PUT /api/notifications/preferences ──────────────────────────
  // Authenticated: update a single preference

  app.put<{
    Body: {
      event_type: string;
      channel?: string;
      enabled: boolean;
    };
  }>(
    "/notifications/preferences",
    { preHandler: [app.verifyAuth] },
    async (request, reply) => {
      const user = request.user!;
      const { event_type, channel = "email", enabled } = request.body;

      await supabase
        .from("subscriber_notification_preference")
        .upsert(
          {
            subscriber_id: user.id,
            event_type,
            channel,
            enabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "subscriber_id,event_type,channel" },
        );

      return reply.send({ ok: true });
    },
  );
}

// ─── Export helper for use in email templates ─────────────────────────

export { generateUnsubscribeToken };
