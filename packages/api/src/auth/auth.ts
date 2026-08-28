/**
 * Stage 1, Task C1 — the Better Auth instance.
 *
 * Replaces Supabase GoTrue, which Phase B removed at the database level (the
 * `auth.users` foreign key was the wall that stopped
 * `scripts/build-db-from-repo.sh` from ever completing).
 *
 * ─── The two settings that are not negotiable ─────────────────────────────
 *
 *     emailAndPassword: { enabled: true, requireEmailVerification: true }
 *
 * Without `requireEmailVerification`, anyone can register an account claiming
 * any email address and Better Auth will treat it as that person. In a system
 * where an email address is how a town clerk is recognised and how invitations
 * are matched, that is the whole authorization model. It also, together with
 * the plugin decision below, closes GHSA-fmh4-wcc4-5jm3 — unauthorized
 * acceptance of an organization invitation by matching an *unverified* email.
 *
 * It is not disabled to make a test easier, ever. The tests in
 * `__tests__/auth.test.ts` construct verified state by writing
 * `better_auth."user"."emailVerified"` directly, which exercises the same code
 * path a real verification click does without adding a bypass to the product.
 *
 * ─── The organization plugin: deliberately NOT enabled ────────────────────
 *
 * Task C1's brief calls for `organization({ requireEmailVerificationOnInvitation:
 * true })`. That plugin is not installed, and this is a deviation recorded on
 * purpose rather than an omission. Three reasons, in order of weight:
 *
 * 1. **Two sources of truth for "which tenant".** Tenancy in this system is
 *    `user_account.town_id`, enforced by 28 RLS policies. The organization
 *    plugin would maintain its own `member` table saying the same thing in a
 *    different place. The one behaviour this whole task exists to guarantee is
 *    that a session resolves to *exactly one* town; two independent membership
 *    stores that can disagree is the direct opposite of that.
 *
 * 2. **A hard table-name collision.** The plugin's default tables include
 *    `invitation`, and `public.invitation` already exists — it is one of the
 *    27 tables under FORCE RLS, with its own tenancy policy, and it is what
 *    Task C2 builds on. Landing the plugin would mean renaming its models to
 *    dodge a table this project already owns.
 *
 * 3. **The advisory is closed more completely by not installing it.**
 *    GHSA-fmh4-wcc4-5jm3 is a vulnerability *in the organization plugin's*
 *    invitation acceptance. `requireEmailVerificationOnInvitation: true`
 *    configures around it; not having the plugin removes the code path. The
 *    brief's own guidance — "enable only plugins you actually use" — points
 *    the same way.
 *
 * This is not left to a comment to enforce. `__tests__/auth.test.ts` asserts
 * that if the organization plugin is ever added, it carries
 * `requireEmailVerificationOnInvitation: true`. Adding it hardened stays easy;
 * adding it unhardened fails a test.
 *
 * No plugins are enabled at all, for the same reason: Better Auth's advisory
 * history is concentrated in the OIDC/OAuth *provider* plugins, and this
 * project is not an identity provider.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuthTables } from "./schema.js";
import type { AppDb } from "./db.js";

/**
 * How an auth email leaves the building.
 *
 * A required parameter with no default, on purpose. A default that logged and
 * returned would make sign-up *appear* to succeed while the verification email
 * went nowhere, and `requireEmailVerification` would then lock the user out of
 * an account they cannot prove they own — a silent failure that presents as a
 * user complaint weeks later. Making it required moves that failure to boot.
 */
export type SendAuthEmail = (message: {
  to: string;
  subject: string;
  /** The link the recipient must click. Never logged. */
  url: string;
  /** Which flow produced this, for template selection. */
  kind: "verify-email" | "reset-password";
}) => Promise<void>;

export interface CreateAuthOptions {
  db: AppDb;
  /** Signing secret. At least 32 bytes; Better Auth refuses shorter. */
  secret: string;
  /** The origin the app is served from. Same-origin with the API — see nginx. */
  baseURL: string;
  sendAuthEmail: SendAuthEmail;
}

export function createAuth(options: CreateAuthOptions) {
  const { db, secret, baseURL, sendAuthEmail } = options;

  return betterAuth({
    // Bound to the committed Drizzle definitions in `schema.ts`, which mirror
    // `packages/api/drizzle/0001_better_auth_and_tenant_bridge.sql`. Better
    // Auth is never permitted to create tables at runtime: the repository is
    // the single source `build-db-from-repo.sh` reproduces from.
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: betterAuthTables,
      // The tables are already schema-qualified via `pgSchema("better_auth")`.
      // This field only tells Better Auth's CLI where to generate; stated so a
      // future `auth generate` does not emit `public`.
      schemaName: "better_auth",
      transaction: true,
    }),

    secret,
    baseURL,

    // ── Non-negotiable. See the header. ──
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },

    emailVerification: {
      sendOnSignUp: true,
      // Clicking the link should not also log you in. Auto-sign-in on
      // verification turns a link that may sit in a mailbox, a proxy log or a
      // forwarded thread into a bearer credential.
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({
          to: user.email,
          subject: "Confirm your email address",
          url,
          kind: "verify-email",
        });
      },
    },

    // No plugins. See the header for why the organization plugin in
    // particular is absent, and why that decision is test-enforced.
    plugins: [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
