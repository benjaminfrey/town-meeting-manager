/**
 * Auth email transport.
 *
 * ─── Why there is no fallback that "works" without Postmark ───────────────
 *
 * `requireEmailVerification: true` means an account is unusable until its
 * verification email is delivered. A sender that logged the link and returned
 * successfully would make sign-up look like it worked and leave the user
 * permanently locked out of an account they cannot prove they own — a failure
 * that shows up days later as a support ticket, with nothing in the logs
 * marked as an error.
 *
 * So this throws. Loudly, at the moment of sending, naming what is missing.
 *
 * ─── Known state of the world, as of Task C1 ──────────────────────────────
 *
 * Postmark has three manual setup steps outstanding — the sending domain's
 * DNS (SPF/DKIM/DMARC), the broadcast message stream, and the webhook URL —
 * so no verification email can currently be delivered in this project's
 * environments. That is a real blocker on the sign-up flow and is reported as
 * such, not worked around here. A development-only "skip verification" switch
 * would make the flow testable and would also ship, and a shipped
 * verification bypass is an account-takeover primitive: anyone could register
 * as anyone.
 *
 * The tests construct verified state by writing
 * `better_auth."user"."emailVerified"` directly. That exercises the same code
 * path a real click produces without putting a bypass in the product.
 *
 * No town context exists at sign-up — the user has not been onboarded yet —
 * so this uses the environment-level Postmark token rather than the
 * per-town one in `town_notification_config`.
 */

import { getDefaultPostmarkClient } from "../lib/postmark.js";
import type { SendAuthEmail } from "./auth.js";

const SUBJECT_TEXT: Record<Parameters<SendAuthEmail>[0]["kind"], (url: string) => string> = {
  "verify-email": (url) =>
    `Confirm your email address to finish setting up your Town Meeting Manager account:\n\n${url}\n\n` +
    `If you did not create an account, ignore this message.`,
  "reset-password": (url) =>
    `Reset your Town Meeting Manager password:\n\n${url}\n\n` +
    `If you did not request this, ignore this message — your password has not changed.`,
};

export function createPostmarkAuthEmailSender(): SendAuthEmail {
  return async ({ to, subject, url, kind }) => {
    const from = process.env.POSTMARK_AUTH_FROM_EMAIL;
    if (!from) {
      throw new Error(
        "POSTMARK_AUTH_FROM_EMAIL is not set, so no verification email can be sent — " +
          "and with requireEmailVerification on, an account that cannot receive one " +
          "can never be used. Refusing to report a successful sign-up.",
      );
    }

    // Throws when POSTMARK_SERVER_TOKEN is unset. Deliberately not caught.
    const client = getDefaultPostmarkClient();

    await client.sendEmail({
      From: from,
      To: to,
      Subject: subject,
      TextBody: SUBJECT_TEXT[kind](url),
      // Transactional: a verification link is not something a recipient may
      // unsubscribe from and still hold an account.
      MessageStream: "outbound",
    });
  };
}
