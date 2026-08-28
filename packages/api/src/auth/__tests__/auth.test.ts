/**
 * Stage 1, Task C1 — Better Auth, exercised against a real database.
 *
 * These are not configuration assertions dressed up as tests. Every one of
 * them drives the real `betterAuth()` instance, bound to the real committed
 * schema, over a real `tmm_app` connection — the same role production
 * connects as, which owns nothing and has DML only. If a grant were missing
 * from the migration, or the committed DDL disagreed with what Better Auth
 * expects, these fail rather than a deploy failing.
 *
 * ─── On `requireEmailVerification` and testing around it ──────────────────
 *
 * The setting is never turned off to make a test pass. Where a verified user
 * is needed, the test writes `better_auth."user"."emailVerified" = true`
 * directly — which is the same state a real verification click produces, minus
 * the email transport that Postmark's three outstanding manual setup steps
 * currently make unavailable. Constructing the state is not a bypass; a
 * config flag or a dev-only escape hatch would be, because it would ship.
 */

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth, type SendAuthEmail } from "../auth.js";
import { completeOnboarding } from "../onboarding.js";
import { resolveTenant } from "../tenant-context.js";

const PASSWORD = "correct-horse-battery-staple";

interface Harness {
  auth: ReturnType<typeof createAuth>;
  db: ReturnType<typeof drizzle>;
  sent: Parameters<SendAuthEmail>[0][];
}

function buildAuth(app: postgres.Sql): Harness {
  const sent: Parameters<SendAuthEmail>[0][] = [];
  const db = drizzle(app);
  const auth = createAuth({
    db,
    // 32 bytes. Test-only; the real one comes from the environment.
    secret: "0123456789abcdef0123456789abcdef",
    baseURL: "http://localhost:3000",
    sendAuthEmail: async (message) => {
      sent.push(message);
    },
  });
  return { auth, db, sent };
}

/** Cookies from a sign-in response, in the form `getSession` wants back. */
function cookieHeader(response: Response): Headers {
  const headers = new Headers();
  const jar = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  headers.set("cookie", jar);
  return headers;
}

describe("Better Auth", () => {
  it("refuses to sign in an unverified user, and lets a verified one through", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { auth, sent } = buildAuth(app);

        await auth.api.signUpEmail({
          body: { email: "clerk@example.gov", password: PASSWORD, name: "Town Clerk" },
        });

        // The verification email is attempted on sign-up. If this were not
        // wired, `requireEmailVerification` would lock every new user out of
        // an account they can never prove they own.
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ to: "clerk@example.gov", kind: "verify-email" });
        expect(sent[0]!.url).toContain("verify-email");

        const [row] = await app<{ id: string; emailVerified: boolean }[]>`
          SELECT id, "emailVerified" FROM better_auth."user" WHERE email = 'clerk@example.gov'
        `;
        expect(row).toBeTruthy();
        expect(row!.emailVerified).toBe(false);

        // THE non-negotiable behaviour: correct password, unverified email,
        // no session.
        await expect(
          auth.api.signInEmail({ body: { email: "clerk@example.gov", password: PASSWORD } }),
        ).rejects.toThrow();

        const sessionsBefore = await app`SELECT 1 FROM better_auth."session"`;
        expect(sessionsBefore).toHaveLength(0);

        // Verified state constructed directly — see this file's header.
        await app`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

        const signedIn = await auth.api.signInEmail({
          body: { email: "clerk@example.gov", password: PASSWORD },
          asResponse: true,
        });
        expect(signedIn.status).toBe(200);

        const sessionsAfter = await app<{ userId: string }[]>`
          SELECT "userId" FROM better_auth."session"
        `;
        expect(sessionsAfter.map((s) => s.userId)).toEqual([row!.id]);
      } finally {
        await app.end();
      }
    });
  });

  it("never stores the password in recoverable form", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { auth } = buildAuth(app);
        await auth.api.signUpEmail({
          body: { email: "clerk@example.gov", password: PASSWORD, name: "Town Clerk" },
        });

        const [account] = await app<{ password: string | null }[]>`
          SELECT password FROM better_auth."account"
        `;
        expect(account?.password).toBeTruthy();
        expect(account!.password).not.toContain(PASSWORD);
        // Long enough that it cannot be a truncation or an encoding of the
        // input; the point is that nothing here is reversible.
        expect(account!.password!.length).toBeGreaterThan(40);
      } finally {
        await app.end();
      }
    });
  });

  it("generates text ids, not UUIDs — which is why auth_user_id was retyped", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { auth } = buildAuth(app);
        await auth.api.signUpEmail({
          body: { email: "clerk@example.gov", password: PASSWORD, name: "Town Clerk" },
        });

        const [row] = await app<{ id: string }[]>`SELECT id FROM better_auth."user"`;
        const id = row!.id;

        // The observation Task C1 step 1 turned on. Recorded as an assertion
        // so that a future Better Auth release switching to UUIDs is a test
        // failure and a deliberate schema decision, not a surprise.
        expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(id.length).toBeGreaterThan(16);

        const [col] = await app<{ data_type: string }[]>`
          SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'user_account'
            AND column_name = 'auth_user_id'
        `;
        expect(col!.data_type).toBe("text");
      } finally {
        await app.end();
      }
    });
  });

  it("keeps requireEmailVerification on, and the organization plugin off or hardened", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { auth } = buildAuth(app);
        const options = auth.options as {
          emailAndPassword?: { enabled?: boolean; requireEmailVerification?: boolean };
          plugins?: { id?: string; options?: Record<string, unknown> }[];
        };

        expect(options.emailAndPassword?.enabled).toBe(true);
        expect(options.emailAndPassword?.requireEmailVerification).toBe(true);

        // The organization plugin is deliberately absent (see auth.ts). This
        // assertion is written so that ADDING it does not quietly reintroduce
        // GHSA-fmh4-wcc4-5jm3: if it ever appears, it must carry
        // requireEmailVerificationOnInvitation. A comment could not enforce
        // that; this does.
        const org = (options.plugins ?? []).find((p) => p?.id === "organization");
        if (org) {
          expect(
            org.options?.requireEmailVerificationOnInvitation,
            "the organization plugin is enabled without requireEmailVerificationOnInvitation: " +
              "that is GHSA-fmh4-wcc4-5jm3, unauthorized invitation acceptance by matching " +
              "an unverified email",
          ).toBe(true);
        }
      } finally {
        await app.end();
      }
    });
  });

  it("carries a real session all the way to a tenant context", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const { auth, db } = buildAuth(app);

        await auth.api.signUpEmail({
          body: { email: "clerk@example.gov", password: PASSWORD, name: "Town Clerk" },
        });
        const [row] = await app<{ id: string }[]>`SELECT id FROM better_auth."user"`;
        await app`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

        const onboarded = await completeOnboarding(db, {
          authUserId: row!.id,
          townName: "Newcastle",
          contactName: "Town Clerk",
          contactEmail: "clerk@example.gov",
        });

        const signedIn = await auth.api.signInEmail({
          body: { email: "clerk@example.gov", password: PASSWORD },
          asResponse: true,
        });

        // The whole chain, end to end: cookie → session → user → user_tenant →
        // user_account → town. This is the thing Phase D depends on.
        const session = await auth.api.getSession({ headers: cookieHeader(signedIn) });
        expect(session?.user.id).toBe(row!.id);

        const tenant = await resolveTenant(db, session as { user: { id: string } });
        expect(tenant).toEqual({
          townId: onboarded.townId,
          personId: onboarded.personId,
          userAccountId: onboarded.userAccountId,
        });
      } finally {
        await app.end();
      }
    });
  });
});
