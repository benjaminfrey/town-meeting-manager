import { defineConfig } from "drizzle-kit";

// Task 4 (B1): schema introspection config for `drizzle-kit pull`.
//
// `entities.roles.exclude` below is what keeps this schema from managing
// (and, on a future `generate`/`push`, proposing to DROP) any Postgres
// role it doesn't already know about — `tmm_owner` and `tmm_app`, the
// application's own roles. A generated migration that drops its own
// connecting role is not hypothetical. `tmm_app` is created by
// `drizzle/0000_baseline.sql` § 4 and is not modelled here.
//
// The mechanism is NOT "drizzle-kit manages roles by default and this
// carves out an exclusion" — verified against drizzle-kit@0.31.10's own
// source (`prepareRoles()` / the role-fetch loop in `api.mjs`):
// `entities.roles` defaults to `false`, and passing it as an object (as
// below) never sets the internal `useRoles` flag — only passing
// `entities.roles: true` does. Without `useRoles`, the per-role loop
// requires the role's name to appear in `entities.roles.include`, and
// `include` is intentionally never set here, so this condition can never
// pass — **no role is ever recorded, for any table, regardless of what
// `exclude` contains.** The six names below are effectively decorative;
// the real protection is `include` staying empty. The stated protection
// (excluded roles can't be dropped) is still correct and this config is
// safe — but the actual reason is "no role is ever introspected at all",
// not "these six are filtered out of a larger managed set". Recorded here
// so a future edit doesn't "simplify" this by relying on `exclude` to do
// filtering work it was never doing.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://ben@localhost:5432/postgres",
  },
  // `public` only. Task 4 had to add `auth` here so `pull` could resolve
  // user_account.auth_user_id's FK into Supabase GoTrue's auth.users;
  // Task B2 dropped that FK and the `auth` schema with it, so the workaround
  // is gone along with the thing it worked around. `public` is drizzle-kit's
  // default; stated explicitly so a future `pull` cannot widen silently.
  schemaFilter: ["public"],
  entities: {
    roles: {
      exclude: ["tmm_owner", "tmm_app"],
    },
  },
  verbose: true,
  strict: true,
});
