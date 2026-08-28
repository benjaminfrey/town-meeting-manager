/**
 * Stage 1, Task C1 — Drizzle definitions for the `better_auth` schema.
 *
 * These are the TypeScript side of
 * `packages/api/drizzle/0001_better_auth_and_tenant_bridge.sql`, which is the
 * authority. Nothing here creates anything: Better Auth is never allowed to
 * create its own tables at runtime, because `scripts/build-db-from-repo.sh`
 * has to be able to rebuild the whole database from the repository, and a
 * table that exists only because a process happened to start once is not
 * reproducible.
 *
 * `packages/api/src/auth/__tests__/auth-schema-invariants.test.ts` re-runs
 * Better Auth's own migration generator against a database built from that
 * SQL and asserts it plans nothing further, so these two files cannot drift
 * apart without a test failing.
 *
 * ─── Why `pgSchema("better_auth")` and not `public` ───────────────────────
 *
 * Every table in `public` is under FORCE ROW LEVEL SECURITY with a tenancy
 * policy. These four cannot be: resolving a session requires reading
 * `better_auth.session`, and reading it under a tenancy policy would require
 * already knowing the tenant, which is what the read is for. Keeping them in
 * their own schema makes "not tenant-scoped" a structural fact instead of an
 * exemption on a list that later tables could quietly join — and it leaves
 * Phase B's `schema-invariants.test.ts`, every query in which is scoped to
 * `nspname = 'public'`, passing unchanged with its exact 27-table set still
 * exact. The full argument is in section 1 of the migration.
 *
 * ─── Why the column names are quoted camelCase ────────────────────────────
 *
 * Because Better Auth's generator emits them that way and this file mirrors
 * the database rather than improving on it. Renaming them to snake_case would
 * mean every Better Auth upgrade has to be re-diffed by hand against a mapping
 * table nobody remembers exists.
 */

import { pgSchema, text, boolean, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const betterAuthSchema = pgSchema("better_auth");

export const user = betterAuthSchema.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const session = betterAuthSchema.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = betterAuthSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
    scope: text("scope"),
    /** Argon2id hash. Never a plaintext password, never logged. */
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = betterAuthSchema.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * The identity → town hint. NOT managed by Better Auth, and deliberately not
 * an `additionalFields` entry on `user`: those are settable by the client at
 * sign-up unless `input: false` is set, and getting that wrong once would let
 * a registering user name their own town. A table Better Auth does not know
 * about removes that whole class of mistake rather than configuring around it.
 *
 * Not authoritative either — `public.user_account.town_id` is. See
 * `tenant-context.ts`, which verifies this value against `user_account`
 * through RLS and throws when they disagree.
 */
export const userTenant = betterAuthSchema.table("user_tenant", {
  authUserId: text("auth_user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  townId: uuid("town_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The four models Better Auth's drizzle adapter binds to, by model name. */
export const betterAuthTables = { user, session, account, verification };
