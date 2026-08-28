/**
 * Stage 1, Task C2 — password reset, end to end.
 *
 * ─── Why this is a whole file ─────────────────────────────────────────────
 *
 * "A user can reset a password" is one of Phase C's exit criteria, and it has
 * never worked in this application — under Supabase either. Three separate
 * things had to be true and none of them was:
 *
 *   1. The auth instance needs `emailAndPassword.sendResetPassword`. Without
 *      it Better Auth answers 400 `RESET_PASSWORD_DISABLED` and never mints a
 *      token at all. C1 did not configure one, because C1 only needed
 *      verification email.
 *   2. `redirectTo` must satisfy `trustedOrigins`, which are derived from
 *      `baseURL` — the same relationship `same-origin.test.ts` covers for
 *      sign-in, and it would have failed identically with the old
 *      `localhost:3000` default.
 *   3. Something has to be listening at the page the link lands on.
 *      `forgot-password.tsx` has always pointed at `/reset-password`, and no
 *      such route existed. That half is `packages/web/src/routes.ts`; this
 *      file covers the server half and asserts the URL shape the page depends
 *      on.
 *
 * Each of those fails in a way the next one hides, which is exactly why this
 * drives the whole sequence rather than the pieces.
 */

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../auth.js";

const APP_ORIGIN = "http://localhost:5173";
const EMAIL = "clerk@example.gov";
const OLD_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-different-long-passphrase";

interface SentEmail {
  to: string;
  url: string;
  kind: string;
}

async function build(client: postgres.Sql) {
  const sent: SentEmail[] = [];
  const auth = createAuth({
    db: drizzle(client),
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: APP_ORIGIN,
    sendAuthEmail: async ({ to, url, kind }) => {
      sent.push({ to, url, kind });
    },
  });

  await auth.api.signUpEmail({ body: { email: EMAIL, password: OLD_PASSWORD, name: "Clerk" } });
  await client`UPDATE better_auth."user" SET "emailVerified" = true WHERE email = ${EMAIL}`;

  return { auth, sent };
}

describe("password reset", () => {
  it("sends a link, accepts the token, and the new password is the one that works", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { auth, sent } = await build(client);

        await auth.api.requestPasswordReset({
          body: { email: EMAIL, redirectTo: `${APP_ORIGIN}/reset-password` },
        });

        const email = sent.find((m) => m.kind === "reset-password");
        expect(
          email,
          "no reset email was sent — sendResetPassword is not configured",
        ).toBeDefined();
        expect(email!.to).toBe(EMAIL);

        // The URL shape the web page depends on: the token is the last path
        // segment, and `callbackURL` names the page that will receive it.
        const url = new URL(email!.url);
        expect(url.origin).toBe(APP_ORIGIN);
        expect(url.pathname).toMatch(/^\/api\/auth\/reset-password\//);
        expect(decodeURIComponent(url.searchParams.get("callbackURL") ?? "")).toBe(
          `${APP_ORIGIN}/reset-password`,
        );
        const token = url.pathname.split("/").pop()!;
        expect(token).toBeTruthy();

        await auth.api.resetPassword({ body: { token, newPassword: NEW_PASSWORD } });

        // The new password works…
        const session = await auth.api.signInEmail({
          body: { email: EMAIL, password: NEW_PASSWORD },
        });
        expect(session.user.email).toBe(EMAIL);

        // …and the old one does not. Without this the test would pass against
        // a reset that silently did nothing.
        await expect(
          auth.api.signInEmail({ body: { email: EMAIL, password: OLD_PASSWORD } }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    });
  });

  it("will not let one token be used twice", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { auth, sent } = await build(client);
        await auth.api.requestPasswordReset({
          body: { email: EMAIL, redirectTo: `${APP_ORIGIN}/reset-password` },
        });
        const token = new URL(sent.find((m) => m.kind === "reset-password")!.url).pathname
          .split("/")
          .pop()!;

        await auth.api.resetPassword({ body: { token, newPassword: NEW_PASSWORD } });

        // A reset link may sit in a mailbox, a proxy log or a forwarded
        // thread. Single use is what stops it being a standing credential.
        await expect(
          auth.api.resetPassword({ body: { token, newPassword: "yet-another-passphrase" } }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    });
  });

  it("says nothing about whether an address is registered", async () => {
    await withTestDb(async (owner) => {
      const client = await connectAsAppRole(owner);
      try {
        const { auth, sent } = await build(client);

        const answer = await auth.api.requestPasswordReset({
          body: { email: "nobody@example.gov", redirectTo: `${APP_ORIGIN}/reset-password` },
        });

        // Same success answer as for a real address — and no email.
        expect(answer.status).toBe(true);
        expect(sent.filter((m) => m.kind === "reset-password")).toHaveLength(0);
      } finally {
        await client.end();
      }
    });
  });
});
