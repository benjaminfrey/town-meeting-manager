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
 *
 * ─── Task G1: the three public routes here, and why each has to be ────────
 *
 * Under deny-by-default (`auth/route-access.ts`) these are marked public
 * deliberately rather than being unmarked by accident, which is what they were
 * before:
 *
 *   GET  /api/invitations/validate — the acceptance page renders from this
 *        before any account exists. The token is the credential; a wrong one
 *        returns 404 and a used or expired one returns `{valid:false}`.
 *   POST /api/invitations/accept   — THE reason a session cannot be required.
 *        This is the request that creates the account. Requiring a session
 *        here would mean an invited user must already have the thing the
 *        invitation exists to give them.
 *   GET  /api/unsubscribe          — reached from a link in an email, by
 *        someone who may have no account at all (subscribers are `person`
 *        rows, not `user_account` rows). Authenticated by an HMAC over
 *        `person:eventType` with a timing-safe comparison, above.
 *
 * The other four routes in this file take a session.
 */

import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { PUBLIC_ROUTE } from "../auth/route-access.js";
import { withTenant } from "../db/with-tenant.js";
import { toRows } from "../db/rows.js";
import { renderEmailTemplate, EmailSenderService } from "../services/email-sender.js";
import { getDefaultPostmarkClient } from "../lib/postmark.js";

const APP_URL = process.env.APP_URL ?? "https://app.townmeetingmanager.com";
const APP_SECRET = process.env.APP_SECRET ?? "default-secret-change-in-production";

// ─── HMAC-based unsubscribe tokens ───────────────────────────────────
// Encodes a PERSON id (notification subscribers are person, not
// user_account — see supabase/migrations/20260827000001_canonicalize_notifications.sql).

function generateUnsubscribeToken(personId: string, eventType: string): string {
  const data = `${personId}:${eventType}`;
  const hmac = crypto.createHmac("sha256", APP_SECRET).update(data).digest("hex");
  return Buffer.from(`${personId}:${eventType}:${hmac}`).toString("base64url");
}

function validateUnsubscribeToken(token: string): { personId: string; eventType: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 3) return null;
    const [personId, eventType, ...hmacParts] = parts;
    const hmac = hmacParts.join(":");
    if (!personId || !eventType || !hmac) return null;
    const expected = crypto
      .createHmac("sha256", APP_SECRET)
      .update(`${personId}:${eventType}`)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }
    return { personId, eventType };
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

      const inviterName =
        (inviter?.display_name as string) ?? (inviter?.email as string) ?? "Town Administrator";

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

      const inviterName =
        (inviter?.display_name as string) ?? (inviter?.email as string) ?? "Town Administrator";

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
    { config: { ...PUBLIC_ROUTE } },
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
  }>("/invitations/accept", { config: { ...PUBLIC_ROUTE } }, async (request, reply) => {
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

    // ─── Creating the login ────────────────────────────────────────────
    //
    // Task C2 replaced `supabase.auth.admin.createUser` here. That call used
    // the Supabase SERVICE-ROLE key to mint a GoTrue user out of band — a
    // privileged side door around the normal sign-up path. Better Auth has no
    // equivalent, deliberately, and none is built: an account is created by
    // the same endpoint a person's own sign-up uses, with the same password
    // hashing and the same validation. The only privilege this route holds is
    // the invitation token the caller presented.
    //
    // `signUpEmail` also sends a verification email (see `auth/auth.ts`), and
    // that send is awaited inside it. With Postmark's manual setup still
    // outstanding, the sender throws and this route answers 500 — the same
    // state ordinary sign-up is in. That is reported rather than worked
    // around: a "skip the email in development" switch is an account-takeover
    // primitive that would also ship.
    let authUserId: string;
    try {
      const created = await app.auth.api.signUpEmail({
        body: { email, password, name },
      });
      authUserId = created.user.id;
    } catch (err) {
      // Better Auth returns a 422 for a duplicate email. Answering 409 with a
      // sentence is better than surfacing its code, because the person reading
      // it is a board member who has just clicked a link in an email.
      //
      // Deliberately NOT auto-linking to the pre-existing identity. That would
      // attach this invitation's `user_account` to an account whose password
      // was never checked in this request, which is a different and much
      // sharper security question than the one this route is answering.
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { body?: { code?: string } })?.body?.code ?? "";

      // ─── A rejected password is the CALLER's problem, not an incident ──
      //
      // Better Auth enforces `minPasswordLength` (8) — which is, incidentally,
      // the first server-side password policy this route has ever had; Task C1
      // recorded that it had none. But a policy violation answered with 500
      // and an error-level log tells the person nothing about what to change,
      // and puts a routine validation failure in the same bucket an operator
      // pages on. It gets a 400 that names the rule, and a warn.
      if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
        app.log.warn(
          { code, invitationId: inv.id },
          "invitation acceptance rejected: password does not meet the policy",
        );
        return reply.badRequest(
          code === "PASSWORD_TOO_SHORT"
            ? "Your password must be at least 8 characters."
            : "That password is too long.",
        );
      }

      app.log.error(
        { err, invitationId: inv.id },
        "sign-up failed during invitation acceptance; invitation NOT marked accepted",
      );
      if (code === "USER_ALREADY_EXISTS" || /exist/i.test(message)) {
        return reply.conflict(
          "An account already exists for this email address. Sign in with it, then " +
            "ask your town administrator to link it to this invitation.",
        );
      }
      return reply.internalServerError(
        "Could not create the account for this invitation. The invitation has not " +
          "been used and can be tried again.",
      );
    }

    const now = new Date().toISOString();

    // ─── The link, and why it is one transaction ───────────────────────
    //
    // Four writes have to happen together or not at all:
    //
    //   1. `better_auth."user"."emailVerified" = true`
    //   2. `user_account.auth_user_id` — the real foreign key Task C1 added,
    //      and what `resolveTenant` verifies against.
    //   3. `better_auth.user_tenant` — the hint that lets tenant resolution
    //      START. Before this task, invitation acceptance never wrote it, so
    //      an invited user authenticated successfully and then hit the
    //      bridge's 403 on EVERY request, invitation already burnt.
    //   4. `invitation.status = 'accepted'`.
    //
    // Any subset of these is unrecoverable without database surgery. Writing
    // them one at a time through PostgREST — which is what this route did —
    // cannot be atomic; `withTenant` opens one transaction with `app.town_id`
    // set, and every write inside it is subject to the same row level security
    // policies as the rest of the application.
    //
    // On (1): the invitation token was emailed to `person.email` and the
    // caller presented it, so possession of that address is already proven —
    // more directly than a verification click proves it. Marking the address
    // verified here is that proof being recorded, not a bypass of it. The
    // redundant verification email `signUpEmail` sends becomes a no-op the
    // recipient can ignore.
    try {
      await withTenant(app.tenantDb, { townId: inv.town_id as string }, async (tx) => {
        await tx.execute(
          sql`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${authUserId}`,
        );

        // ─── Why both UPDATEs use RETURNING and count the rows ──────────
        //
        // These run under row level security, and an UPDATE whose WHERE
        // matches nothing is not an error — it is a successful statement that
        // changed nothing. So an invitation naming a `user_account` that
        // belongs to a DIFFERENT town than `invitation.town_id`, or one that
        // was deleted since the invitation was issued, would sail through
        // here: the account would stay unlinked, `user_tenant` would still be
        // written, and the caller would get 200. The invited user would then
        // authenticate and hit the tenant bridge's 403 forever, invitation
        // consumed — which is precisely the failure this rewrite exists to
        // end, reappearing one layer down.
        //
        // `RETURNING id` turns "matched nothing" into an exception, which
        // rolls the transaction back and leaves the invitation reusable.
        //
        // `auth_user_id IS NULL` is the other half, and it is not belt and
        // braces. Without it, matching on `id` alone RE-LINKS an account that
        // already has a login: two pending invitations for one `user_account`
        // (a re-issue, or two administrators inviting the same person) and the
        // second acceptance repoints `auth_user_id` at identity #2 — while
        // identity #1 stays live and signable, and its `better_auth.user_tenant`
        // row stays behind mapping it to the town. That identity then
        // authenticates successfully and is refused by the tenant bridge on
        // every request forever, which is precisely the state this rewrite
        // exists to end. The row count below turns it into a rollback.
        const linked = toRows<{ id: string }>(
          await tx.execute(sql`
            UPDATE user_account
               SET auth_user_id = ${authUserId},
                   email = ${email},
                   display_name = ${name}
             WHERE id = ${inv.user_account_id as string}::uuid
               AND auth_user_id IS NULL
             RETURNING id
          `),
          (message) => new Error(`invitation acceptance: linking user_account: ${message}`),
        );
        if (linked.length !== 1) {
          throw new Error(
            `invitation acceptance: expected to link exactly 1 user_account, matched ${linked.length}. ` +
              `Invitation ${String(inv.id)} names user_account ${String(inv.user_account_id)} ` +
              `in town ${String(inv.town_id)}. Either that row is not visible from that town ` +
              "under row level security (missing, or belonging to another town), or it already " +
              "has a login — an account is linked once, and re-linking it would strand the " +
              "identity already pointing at it.",
          );
        }

        await tx.execute(sql`
          INSERT INTO better_auth.user_tenant (auth_user_id, town_id)
          VALUES (${authUserId}, ${inv.town_id as string}::uuid)
        `);

        const accepted = toRows<{ id: string }>(
          await tx.execute(sql`
            UPDATE invitation
               SET status = 'accepted', accepted_at = ${now}::timestamptz
             WHERE id = ${inv.id as string}::uuid
             RETURNING id
          `),
          (message) => new Error(`invitation acceptance: closing the invitation: ${message}`),
        );
        if (accepted.length !== 1) {
          throw new Error(
            `invitation acceptance: expected to close exactly 1 invitation, matched ${accepted.length}. ` +
              "Leaving a live token for an account that now exists is worse than refusing.",
          );
        }
      });
    } catch (err) {
      // ─── The compensating delete ─────────────────────────────────────
      //
      // The transaction rolled back, so the invitation is untouched and can be
      // retried. But the Better Auth user created above is OUTSIDE it and
      // survives — and on the retry its email is taken, so the caller would
      // meet the 409 above forever with no way out but manual surgery.
      //
      // Deleting it puts the world back where it was. It is safe precisely
      // because it is unreachable: nothing links to it (that is what just
      // failed), it has never been signed into, and `user_account.auth_user_id`
      // is ON DELETE SET NULL so no historical record could be taken with it.
      await app.tenantDb
        .execute(sql`DELETE FROM better_auth."user" WHERE id = ${authUserId}`)
        .catch((cleanupErr: unknown) => {
          app.log.error(
            { cleanupErr, authUserId, invitationId: inv.id },
            "could not remove the orphaned identity after a failed invitation link; " +
              "a retry will report the email as already registered until it is deleted by hand",
          );
        });

      app.log.error(
        { err, invitationId: inv.id, userAccountId: inv.user_account_id },
        "linking the new account to this invitation failed; invitation NOT marked accepted",
      );
      return reply.internalServerError(
        "Could not link the new account to this invitation. The invitation has not been " +
          "used and can be tried again once the underlying problem is fixed.",
      );
    }

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
    { config: { ...PUBLIC_ROUTE } },
    async (request, reply) => {
      const { t: token } = request.query;
      if (!token) return reply.badRequest("token required");

      const parsed = validateUnsubscribeToken(token);
      if (!parsed) {
        return reply.status(400).send({ error: "Invalid or expired unsubscribe link" });
      }

      const { personId, eventType } = parsed;

      // subscriber_notification_preference.town_id is NOT NULL — this route
      // is unauthenticated (reached via a signed link, not a session), so
      // town_id has to be looked up from the person rather than read off a
      // request.user. subscriber_notification_preference also carries no
      // created_at/updated_at columns (that's the ported shape, not the
      // canonical one — see the migration's header comment), so none is set here.
      const { data: person } = await supabase
        .from("person")
        .select("town_id")
        .eq("id", personId)
        .single();

      if (!person) {
        return reply.status(400).send({ error: "Invalid or expired unsubscribe link" });
      }

      // Upsert preference: enabled = false
      await supabase.from("subscriber_notification_preference").upsert(
        {
          person_id: personId,
          town_id: (person as { town_id: string }).town_id,
          event_type: eventType,
          channel: "email",
          enabled: false,
        },
        { onConflict: "person_id,channel,event_type" },
      );

      // Return a simple HTML confirmation
      return reply.header("Content-Type", "text/html").status(200).send(`<!DOCTYPE html>
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
      if (!user.personId) return reply.send([]);

      const { data } = await supabase
        .from("subscriber_notification_preference")
        .select("event_type, channel, enabled")
        .eq("person_id", user.personId);

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
  }>("/notifications/preferences", { preHandler: [app.verifyAuth] }, async (request, reply) => {
    const user = request.user!;
    if (!user.personId || !user.townId) {
      return reply.badRequest("No person/town associated with this account");
    }
    const { event_type, channel = "email", enabled } = request.body;

    await supabase.from("subscriber_notification_preference").upsert(
      {
        person_id: user.personId,
        town_id: user.townId,
        event_type,
        channel,
        enabled,
      },
      { onConflict: "person_id,channel,event_type" },
    );

    return reply.send({ ok: true });
  });
}

// ─── Export helper for use in email templates ─────────────────────────

export { generateUnsubscribeToken };
