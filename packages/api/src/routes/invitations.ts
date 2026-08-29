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
 *        `person:town:eventType` with a timing-safe comparison, below.
 *
 * The other four routes in this file take a session.
 *
 * ─── Task D1c: every route here is now tenant-scoped ──────────────────────
 *
 * This file was the largest remaining consumer of the service-role Supabase
 * client — about twenty-five reads and writes with row level security
 * bypassed, four of them on a PUBLIC route. It has none now.
 *
 * The authenticated routes use `request.withTenant`, which is ordinary. The
 * public ones are the interesting half, because they are the case Phase C's
 * bridge does not cover: THE CALLER HAS NO TOWN. An invitee has no `person`
 * row and no session; the town is a property of the invitation being accepted.
 *
 * Two answers, one per route:
 *
 *   ACCEPT / VALIDATE — `resolveInvitationTown(token)`, a single narrow
 *        pre-tenant lookup that returns a town id and nothing else, and cannot
 *        grant access because everything it proposes is then verified by RLS.
 *        See `db/invitation-bootstrap.ts` for the full property statement.
 *
 *   UNSUBSCRIBE — the town is carried IN the signed token. The link is minted
 *        by this API (`generateUnsubscribeToken`), the HMAC covers the town, so
 *        a tampered town fails the signature check before any query runs. This
 *        replaces a pre-tenant read of `person` to discover the town, which is
 *        one more unscoped query than the problem requires.
 *
 * Both are hints that are USED rather than trusted: the row is read inside
 * `withTenant`, so a wrong town yields zero rows, not another town's data.
 */

import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { PUBLIC_ROUTE } from "../auth/route-access.js";
import { withTenant, type TenantTx } from "../db/with-tenant.js";
import { resolveInvitationTown } from "../db/invitation-bootstrap.js";
import { toRows } from "../db/rows.js";
import { renderEmailTemplate, EmailSenderService } from "../services/email-sender.js";
import { getDefaultPostmarkClient } from "../lib/postmark.js";

const APP_URL = process.env.APP_URL ?? "https://app.townmeetingmanager.com";
const APP_SECRET = process.env.APP_SECRET ?? "default-secret-change-in-production";

function rows<T>(result: unknown, what: string): T[] {
  return toRows<T>(result, (message) => new Error(`${what}: ${message}`));
}

/** See `routes/notifications.ts` for why this is a throw and not a `!`. */
function tenantOf(request: FastifyRequest): <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T> {
  const run = request.withTenant;
  if (!run) {
    throw new Error(
      "invitation routes: no tenant context on an authenticated route. The public " +
        "routes in this file resolve their own town; the rest require a session.",
    );
  }
  return run;
}

// ─── HMAC-based unsubscribe tokens ───────────────────────────────────
//
// Encodes a PERSON id (notification subscribers are person, not user_account —
// see supabase/migrations/20260827000001_canonicalize_notifications.sql) AND
// the town that person belongs to.
//
// The town is in the token because the route that consumes it has no session
// and therefore no tenant. The alternative was a pre-tenant read of
// `person.town_id` — a second privileged query, on a public route, to discover
// something the sender already knew when it minted the link. Signing it costs
// nothing and means a tampered town is rejected by the HMAC rather than by a
// query that has to be written correctly.
//
// Nothing consumed the previous two-field form: this function was exported and
// never imported (the email templates render an unsubscribe URL that nothing
// generated). There are therefore no tokens in the wild in the old shape, and
// no compatibility path is owed to one.

function generateUnsubscribeToken(personId: string, townId: string, eventType: string): string {
  const data = `${personId}:${townId}:${eventType}`;
  const hmac = crypto.createHmac("sha256", APP_SECRET).update(data).digest("hex");
  return Buffer.from(`${data}:${hmac}`).toString("base64url");
}

function validateUnsubscribeToken(
  token: string,
): { personId: string; townId: string; eventType: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 4) return null;
    const [personId, townId, eventType, ...hmacParts] = parts;
    const hmac = hmacParts.join(":");
    if (!personId || !townId || !eventType || !hmac) return null;
    const expected = crypto
      .createHmac("sha256", APP_SECRET)
      .update(`${personId}:${townId}:${eventType}`)
      .digest("hex");
    const presented = Buffer.from(hmac, "hex");
    const computed = Buffer.from(expected, "hex");
    if (presented.length !== computed.length) return null;
    if (!crypto.timingSafeEqual(presented, computed)) return null;
    return { personId, townId, eventType };
  } catch {
    return null;
  }
}

// ─── Row shapes ──────────────────────────────────────────────────────

interface InvitationRow {
  id: string;
  person_id: string;
  user_account_id: string | null;
  town_id: string;
  token: string;
  status: string;
  expires_at: string | null;
  role: string | null;
  email: string | null;
}

interface SendContext {
  invitation: InvitationRow;
  recipientEmail: string | null;
  recipientName: string;
  townName: string;
  townSubdomain: string | null;
  inviterName: string;
}

/**
 * Everything the invitation emails need, in ONE tenant-scoped transaction.
 *
 * Four PostgREST round trips became one query. That is not only cheaper: the
 * invitation, the person, the town and the inviter are now read at a single
 * point in time under one tenancy decision, instead of four independently
 * filtered reads that could disagree with each other.
 *
 * `town` needs no join predicate beyond the invitation's own `town_id`,
 * because `town`'s policy is `id = get_current_town_id()` — the only town this
 * transaction can see is its own.
 */
async function readSendContext(
  tx: TenantTx,
  invitationId: string,
  inviterAccountId: string,
): Promise<SendContext | null> {
  const found = rows<{
    id: string;
    person_id: string;
    user_account_id: string | null;
    town_id: string;
    token: string;
    status: string;
    expires_at: string | null;
    role: string | null;
    email: string | null;
    person_name: string | null;
    person_email: string | null;
    town_name: string | null;
    town_subdomain: string | null;
    inviter_display_name: string | null;
    inviter_email: string | null;
  }>(
    await tx.execute(sql`
      SELECT i.id, i.person_id, i.user_account_id, i.town_id, i.token, i.status,
             i.expires_at, i.role, i.email,
             p.name  AS person_name,
             p.email AS person_email,
             t.name  AS town_name,
             t.subdomain AS town_subdomain,
             inviter.display_name AS inviter_display_name,
             inviter.email        AS inviter_email
        FROM invitation i
        LEFT JOIN person p ON p.id = i.person_id
        LEFT JOIN town   t ON t.id = i.town_id
        LEFT JOIN user_account inviter ON inviter.id = ${inviterAccountId}::uuid
       WHERE i.id = ${invitationId}::uuid
    `),
    "invitation send context",
  );

  const row = found[0];
  if (!row) return null;

  return {
    invitation: {
      id: String(row.id),
      person_id: String(row.person_id),
      user_account_id: row.user_account_id ? String(row.user_account_id) : null,
      town_id: String(row.town_id),
      token: row.token,
      status: row.status,
      expires_at: row.expires_at,
      role: row.role,
      email: row.email,
    },
    recipientEmail: row.email ?? row.person_email ?? null,
    recipientName: row.person_name ?? "Team Member",
    townName: row.town_name ?? "",
    townSubdomain: row.town_subdomain,
    inviterName: row.inviter_display_name ?? row.inviter_email ?? "Town Administrator",
  };
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "";
  return new Date(expiresAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Route registration ───────────────────────────────────────────────

export async function invitationRoutes(app: FastifyInstance) {
  /**
   * Render and send one invitation email, then record that it was sent.
   *
   * The send is deliberately outside any transaction — see `auth/fastify.ts`
   * on why a transaction is not held across a network call — so the `sent_at`
   * write opens its own.
   */
  async function sendInvitationEmail(
    runInTenant: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>,
    context: SendContext,
    recipientEmail: string,
    inviterAccountId: string,
  ): Promise<string | undefined> {
    const { html, text, subject } = renderEmailTemplate("invite-user", {
      recipientName: context.recipientName,
      townName: context.townName,
      role: context.invitation.role ?? "board_member",
      inviterName: context.inviterName,
      setupUrl: `${APP_URL}/invite/accept?token=${context.invitation.token}`,
      expiresAt: formatExpiry(context.invitation.expires_at),
      isBroadcast: false,
    });

    const pmClient = getDefaultPostmarkClient();
    const sender = new EmailSenderService(pmClient);
    const subdomain = context.townSubdomain ?? "notifications";
    const from = `Town of ${context.townName} <notifications@${subdomain}.townmeetingmanager.com>`;

    const result = await sender.sendEmail({
      to: recipientEmail,
      from,
      subject,
      htmlBody: html,
      textBody: text,
      tag: "user_invited",
      messageStream: "outbound",
      metadata: { invitation_id: context.invitation.id, town_id: context.invitation.town_id },
    });

    await runInTenant(async (tx) => {
      await tx.execute(sql`
        UPDATE invitation
           SET sent_at = now(), email = ${recipientEmail}, invited_by = ${inviterAccountId}::uuid
         WHERE id = ${context.invitation.id}::uuid
      `);
    });

    return result.MessageID;
  }

  // ── POST /api/invitations/:id/send ───────────────────────────────
  // Authenticated: send initial invitation email
  //
  // The `if (inv.town_id !== user.townId) return reply.forbidden()` this used
  // to carry is gone, and its absence is the improvement. That check was a
  // cross-tenant decision made in TypeScript against a value read with RLS
  // bypassed; `plugins/auth.ts` records that before Task G1 the town it
  // compared against came out of an unverified JWT claim. An invitation in
  // another town is now simply not visible to this query, so the answer is 404
  // — which is also the right thing to tell a caller about a row they have no
  // business knowing exists.

  app.post<{ Params: { id: string } }>(
    "/invitations/:id/send",
    { preHandler: [app.verifyAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const inviterAccountId = request.user!.id;
      const runInTenant = tenantOf(request);

      const context = await runInTenant((tx) => readSendContext(tx, id, inviterAccountId));

      if (!context) return reply.notFound("Invitation not found");
      if (context.invitation.status === "accepted") {
        return reply.badRequest("Invitation already accepted");
      }
      if (!context.recipientEmail) {
        return reply.badRequest("No email address found for this person");
      }
      if (!context.townName) return reply.notFound("Town not found");

      try {
        const messageId = await sendInvitationEmail(
          runInTenant,
          context,
          context.recipientEmail,
          inviterAccountId,
        );
        return reply.status(200).send({ ok: true, message_id: messageId });
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
      const inviterAccountId = request.user!.id;
      const runInTenant = tenantOf(request);

      const newToken = crypto.randomUUID();

      // Reissue and re-read in one transaction. `RETURNING` rather than an
      // UPDATE followed by a SELECT: the previous version did both, and
      // between them the row could have changed — or, under RLS, the UPDATE
      // could have matched nothing while the code carried on with the values
      // it had already read. `status <> 'accepted'` in the WHERE means a
      // race with acceptance loses here rather than reopening a closed
      // invitation.
      const reissued = await runInTenant(async (tx) =>
        rows<{ id: string }>(
          await tx.execute(sql`
            UPDATE invitation
               SET token = ${newToken},
                   expires_at = now() + interval '7 days',
                   status = 'pending',
                   sent_at = NULL
             WHERE id = ${id}::uuid
               AND status <> 'accepted'
            RETURNING id
          `),
          "invitation resend",
        ),
      );

      if (reissued.length !== 1) {
        // Either it does not exist, it belongs to another town (invisible), or
        // it is already accepted. All three are "there is nothing here to
        // resend"; distinguishing them for the caller would disclose whether a
        // row exists in a town they cannot see.
        return reply.notFound("No pending invitation to resend");
      }

      const context = await runInTenant((tx) => readSendContext(tx, id, inviterAccountId));
      if (!context) return reply.internalServerError();
      if (!context.recipientEmail) return reply.badRequest("No email address found");
      if (!context.townName) return reply.notFound("Town not found");

      try {
        await sendInvitationEmail(runInTenant, context, context.recipientEmail, inviterAccountId);
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

      const townId = await resolveInvitationTown(app.tenantDb, token);
      if (!townId) return reply.notFound("Invitation not found or already used");

      const found = await withTenant(app.tenantDb, { townId }, async (tx) =>
        rows<{
          id: string;
          status: string;
          expires_at: string | null;
          role: string | null;
          person_name: string | null;
          person_email: string | null;
          town_name: string | null;
        }>(
          await tx.execute(sql`
            SELECT i.id, i.status, i.expires_at, i.role,
                   p.name AS person_name, p.email AS person_email, t.name AS town_name
              FROM invitation i
              LEFT JOIN person p ON p.id = i.person_id
              LEFT JOIN town   t ON t.id = i.town_id
             WHERE i.token = ${token}
          `),
          "invitation validate",
        ),
      );

      // The bootstrap proposed a town; RLS is what decided. A hint pointing at
      // the wrong town lands here with zero rows and is answered exactly like
      // an unknown token.
      const inv = found[0];
      if (!inv) return reply.notFound("Invitation not found or already used");

      if (inv.status === "accepted") {
        return reply.send({ valid: false, reason: "already_accepted" });
      }
      if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
        return reply.send({ valid: false, reason: "expired" });
      }

      return reply.send({
        valid: true,
        invitation_id: inv.id,
        person_name: inv.person_name ?? null,
        person_email: inv.person_email ?? null,
        town_name: inv.town_name ?? null,
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

    // The bootstrap. One query, one column, and the only thing in this route
    // that runs outside a tenant context — see `db/invitation-bootstrap.ts`.
    const townId = await resolveInvitationTown(app.tenantDb, token);
    if (!townId) return reply.notFound("Invalid invitation");

    const found = await withTenant(app.tenantDb, { townId }, async (tx) =>
      rows<{
        id: string;
        person_id: string;
        user_account_id: string | null;
        town_id: string;
        status: string;
        expires_at: string | null;
        role: string | null;
        person_name: string | null;
        person_email: string | null;
      }>(
        await tx.execute(sql`
          SELECT i.id, i.person_id, i.user_account_id, i.town_id, i.status, i.expires_at, i.role,
                 p.name AS person_name, p.email AS person_email
            FROM invitation i
            LEFT JOIN person p ON p.id = i.person_id
           WHERE i.token = ${token}
        `),
        "invitation accept",
      ),
    );

    const inv = found[0];
    if (!inv) return reply.notFound("Invalid invitation");
    if (inv.status === "accepted") {
      return reply.badRequest("Invitation already accepted");
    }
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return reply.badRequest("Invitation has expired");
    }
    if (!inv.person_email) {
      return reply.internalServerError("No email found for this person");
    }
    if (!inv.user_account_id) {
      return reply.internalServerError("This invitation names no account to link");
    }

    const email = inv.person_email;
    const name = display_name ?? inv.person_name ?? email;
    const userAccountId = inv.user_account_id;

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

    // ─── The link, and why it is one transaction ───────────────────────
    //
    // Four writes have to happen together or not at all:
    //
    //   1. `better_auth."user"."emailVerified" = true`
    //   2. `user_account.auth_user_id` — the real foreign key Task C1 added,
    //      and what `resolveTenant` verifies against.
    //   3. `better_auth.user_tenant` — the hint that lets tenant resolution
    //      START. Before Task C2, invitation acceptance never wrote it, so
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
      await withTenant(app.tenantDb, { townId: inv.town_id }, async (tx) => {
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
        const linked = rows<{ id: string }>(
          await tx.execute(sql`
            UPDATE user_account
               SET auth_user_id = ${authUserId},
                   email = ${email},
                   display_name = ${name}
             WHERE id = ${userAccountId}::uuid
               AND auth_user_id IS NULL
             RETURNING id
          `),
          "invitation acceptance: linking user_account",
        );
        if (linked.length !== 1) {
          throw new Error(
            `invitation acceptance: expected to link exactly 1 user_account, matched ${linked.length}. ` +
              `Invitation ${inv.id} names user_account ${userAccountId} ` +
              `in town ${inv.town_id}. Either that row is not visible from that town ` +
              "under row level security (missing, or belonging to another town), or it already " +
              "has a login — an account is linked once, and re-linking it would strand the " +
              "identity already pointing at it.",
          );
        }

        await tx.execute(sql`
          INSERT INTO better_auth.user_tenant (auth_user_id, town_id)
          VALUES (${authUserId}, ${inv.town_id}::uuid)
        `);

        // `status = 'pending'` in the WHERE, not just the id. Two acceptances
        // of the same token arriving together would otherwise both see
        // `pending` in the read above and both close it — two identities, one
        // account, one of them stranded. Whichever transaction commits second
        // matches nothing here and rolls back.
        const accepted = rows<{ id: string }>(
          await tx.execute(sql`
            UPDATE invitation
               SET status = 'accepted', accepted_at = now()
             WHERE id = ${inv.id}::uuid
               AND status = 'pending'
             RETURNING id
          `),
          "invitation acceptance: closing the invitation",
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
        { err, invitationId: inv.id, userAccountId },
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

      const { personId, townId, eventType } = parsed;

      // The signature covers the town, so this cannot be pointed at another
      // town's transaction by editing the link. And even a validly-signed
      // token for a person who has since moved or been deleted writes nothing:
      // `subscriber_notification_preference.person_id` is a foreign key, and
      // the row is inserted inside the town's own context, so the insert fails
      // rather than creating a preference for a person this town does not have.
      let ok = true;
      try {
        await withTenant(app.tenantDb, { townId }, async (tx) => {
          const exists = rows<{ id: string }>(
            await tx.execute(sql`SELECT id FROM person WHERE id = ${personId}::uuid`),
            "unsubscribe",
          );
          if (exists.length !== 1) {
            ok = false;
            return;
          }

          // No created_at/updated_at columns on this table — that is the
          // ported shape, not the canonical one; see the migration's header.
          await tx.execute(sql`
            INSERT INTO subscriber_notification_preference
                   (person_id, town_id, event_type, channel, enabled)
            VALUES (${personId}::uuid, ${townId}::uuid, ${eventType}, 'email', false)
            ON CONFLICT (person_id, channel, event_type)
            DO UPDATE SET enabled = false
          `);
        });
      } catch (err) {
        app.log.error({ err, personId, townId, eventType }, "unsubscribe failed");
        ok = false;
      }

      if (!ok) {
        return reply.status(400).send({ error: "Invalid or expired unsubscribe link" });
      }

      // Return a simple HTML confirmation. `eventType` is signed, so it is not
      // attacker-chosen — but it is still interpolated into HTML, so it is
      // escaped rather than trusted to be well-behaved.
      const label = escapeHtml(eventType.replace(/_/g, " "));
      return reply.header("Content-Type", "text/html").status(200).send(`<!DOCTYPE html>
<html>
<head><title>Unsubscribed</title>
<style>body{font-family:Arial,sans-serif;max-width:600px;margin:60px auto;text-align:center;color:#374151;}
h1{color:#1a3a6b;}a{color:#1a3a6b;}</style></head>
<body>
<h1>You've been unsubscribed</h1>
<p>You will no longer receive <strong>${label}</strong> emails.</p>
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
      const personId = request.user!.personId;
      if (!personId) return reply.send([]);

      const preferences = await tenantOf(request)(async (tx) =>
        rows(
          await tx.execute(sql`
            SELECT event_type, channel, enabled
              FROM subscriber_notification_preference
             WHERE person_id = ${personId}::uuid
          `),
          "notification preferences",
        ),
      );

      return reply.send(preferences);
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
    const personId = request.user!.personId;
    const townId = request.user!.townId;
    if (!personId || !townId) {
      return reply.badRequest("No person/town associated with this account");
    }
    const { event_type, channel = "email", enabled } = request.body;

    await tenantOf(request)(async (tx) => {
      await tx.execute(sql`
        INSERT INTO subscriber_notification_preference
               (person_id, town_id, event_type, channel, enabled)
        VALUES (${personId}::uuid, ${townId}::uuid, ${event_type},
                ${channel}::notification_channel, ${enabled})
        ON CONFLICT (person_id, channel, event_type)
        DO UPDATE SET enabled = EXCLUDED.enabled
      `);
    });

    return reply.send({ ok: true });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Export helper for use in email templates ─────────────────────────

export { generateUnsubscribeToken };
