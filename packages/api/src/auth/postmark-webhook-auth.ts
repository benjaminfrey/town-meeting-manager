/**
 * Stage 1, Task G1 — authenticating Postmark's webhook callbacks.
 *
 * ─── Postmark does not sign its webhooks ──────────────────────────────────
 *
 * The brief for this task assumed an HMAC signature to verify. There isn't
 * one. Postmark's own webhooks documentation says so in as many words —
 * "Postmark does not currently support HMAC webhook signature verification" —
 * and directs integrators to two mechanisms instead:
 *
 *   1. **HTTP Basic authentication embedded in the webhook URL.** Postmark
 *      accepts `https://<username>:<password>@example.com/webhook` when you
 *      configure the webhook and sends those credentials as an `Authorization:
 *      Basic` header on every callback. Over HTTPS (which Postmark also
 *      recommends, and which `infrastructure/nginx/nginx.conf` terminates)
 *      the credentials are inside TLS.
 *   2. **Source-IP allowlisting** against the ranges on Postmark's
 *      "IPs for Firewalls" support page.
 *
 * https://postmarkapp.com/developer/webhooks/webhooks-overview
 *
 * This module implements (1) and deliberately does not implement (2). Postmark
 * has changed its webhook egress IPs with an "action may be required"
 * announcement before; an allowlist compiled into application code is a list
 * that goes stale silently and starts dropping delivery events months later.
 * If the operator wants it, it belongs in nginx where it can be edited without
 * a deploy. Basic auth is the mechanism that can be verified correctly *here*.
 *
 * Inventing an HMAC scheme instead would have been worse than doing nothing:
 * Postmark would never send the signature, so either the endpoint rejects
 * every real callback, or the check is written to pass when the header is
 * absent — which is an unauthenticated endpoint wearing a signature check.
 *
 * ─── Why a missing configuration REFUSES rather than allows ───────────────
 *
 * If `POSTMARK_WEBHOOK_USERNAME`/`_PASSWORD` are unset, this refuses every
 * request with 503 and logs an error. The alternative — treat "no credentials
 * configured" as "no check needed" — reproduces the exact hole this task
 * exists to close, and reproduces it in the one deployment state nobody tests:
 * a fresh production environment where someone missed an env var. A webhook
 * that stops recording bounces is a visible, recoverable outage. An open
 * fan-out endpoint on a DKIM-signed municipal domain is not.
 *
 * ─── What an unverified webhook would let someone do ──────────────────────
 *
 * The handler behind this writes `notification_delivery.status` and sets
 * `user_account.email_bounced`. Anyone who could POST a fabricated
 * `HardBounce` for a guessed delivery id would permanently suppress mail to a
 * real town official — a denial of service against statutory meeting notices,
 * delivered by the town's own notification system.
 */

import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface BasicCredentials {
  readonly username: string;
  readonly password: string;
}

export type WebhookAuthResult =
  /** The presented credentials match the configured ones. */
  | { readonly outcome: "ok" }
  /** No credentials are configured — the endpoint must refuse (503). */
  | { readonly outcome: "unconfigured"; readonly reason: string }
  /** Header absent, malformed, or wrong credentials — refuse (401). */
  | { readonly outcome: "rejected"; readonly reason: string };

/**
 * Read the configured credentials from the environment.
 *
 * Returns `null` when either half is absent or blank, which callers must treat
 * as "refuse", never as "skip the check".
 */
export function postmarkWebhookCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BasicCredentials | null {
  const username = env.POSTMARK_WEBHOOK_USERNAME?.trim();
  const password = env.POSTMARK_WEBHOOK_PASSWORD;
  if (!username || !password) return null;
  return { username, password };
}

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Both sides are hashed first so the buffers handed to `timingSafeEqual` are
 * always 32 bytes. Comparing the raw strings would throw on a length mismatch
 * — and catching that throw would turn "wrong length" into an early return,
 * which is a length oracle for the password.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a, "utf8").digest();
  const digestB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Verify an `Authorization: Basic …` header against the configured credentials.
 *
 * Pure, so `__tests__/postmark-webhook-auth.test.ts` can drive every branch
 * without a server or a database.
 */
export function verifyPostmarkWebhookAuth(
  authorizationHeader: string | undefined,
  credentials: BasicCredentials | null,
): WebhookAuthResult {
  if (!credentials) {
    return {
      outcome: "unconfigured",
      reason:
        "POSTMARK_WEBHOOK_USERNAME and POSTMARK_WEBHOOK_PASSWORD are not both set. " +
        "Set them, then configure the Postmark webhook URL as " +
        "https://<username>:<password>@app.example.gov/api/webhooks/postmark. " +
        "Refusing rather than accepting unauthenticated callbacks.",
    };
  }

  if (!authorizationHeader) {
    return { outcome: "rejected", reason: "no Authorization header" };
  }

  // Scheme token is case-insensitive per RFC 7617; the space after it is not
  // optional. Matching on a lowercased copy avoids rejecting a well-formed
  // "basic " that some proxy normalised.
  const prefix = "basic ";
  if (authorizationHeader.slice(0, prefix.length).toLowerCase() !== prefix) {
    return { outcome: "rejected", reason: "Authorization header is not HTTP Basic" };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authorizationHeader.slice(prefix.length).trim(), "base64").toString(
      "utf8",
    );
  } catch {
    return { outcome: "rejected", reason: "Authorization credentials are not valid base64" };
  }

  // A password may itself contain ':' — RFC 7617 splits on the FIRST colon
  // only. `split(":")[1]` would silently truncate such a password and then
  // fail to match, which reads in a log as "wrong credentials" forever.
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return { outcome: "rejected", reason: "Authorization credentials are not user:password" };
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  // Both comparisons always run — `&&` would short-circuit on a wrong
  // username and leak, through response timing, whether the username was
  // right. Cheap to avoid; awkward to reintroduce later.
  const usernameOk = constantTimeEquals(username, credentials.username);
  const passwordOk = constantTimeEquals(password, credentials.password);
  if (!usernameOk || !passwordOk) {
    return { outcome: "rejected", reason: "Authorization credentials do not match" };
  }

  return { outcome: "ok" };
}

/**
 * A Fastify `preHandler` that applies {@link verifyPostmarkWebhookAuth}.
 *
 * Credentials are read per request rather than captured at registration so a
 * process that has them rotated in its environment picks them up, and so tests
 * can set them without rebuilding the server.
 */
export function verifyPostmarkWebhook(
  readCredentials: () => BasicCredentials | null = () => postmarkWebhookCredentialsFromEnv(),
) {
  return async function postmarkWebhookAuthPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const result = verifyPostmarkWebhookAuth(request.headers.authorization, readCredentials());

    if (result.outcome === "ok") return;

    if (result.outcome === "unconfigured") {
      // Error level: this is a misconfigured deployment silently dropping
      // delivery telemetry, and it will not fix itself.
      request.log.error(
        { reason: result.reason },
        "Postmark webhook authentication is unconfigured",
      );
      return reply.serviceUnavailable(
        "The Postmark webhook endpoint is not configured for authentication and will not " +
          "accept callbacks until it is.",
      );
    }

    // Warn, not error: on a public endpoint this is background noise from
    // scanners, and at error level it would drown the line above.
    request.log.warn(
      { reason: result.reason },
      "Rejected an unauthenticated Postmark webhook call",
    );
    // `WWW-Authenticate` is required with a 401 by RFC 7235, and it is what
    // tells Postmark's own delivery machinery this is an auth failure rather
    // than an application error.
    reply.header("WWW-Authenticate", 'Basic realm="postmark-webhook"');
    return reply.unauthorized("Invalid webhook credentials");
  };
}
