import { defineConfig } from "drizzle-kit";

// Task 4 (B1): schema introspection config for `drizzle-kit pull`.
//
// `entities.roles.exclude` below is what keeps this schema from managing
// (and, on a future `generate`/`push`, proposing to DROP) any Postgres
// role it doesn't already know about — `tmm_owner`/`tmm_app` (the
// application's own login roles on the dev VM — a generated migration
// that drops its own connecting role is not hypothetical) and the four
// roles GoTrue/Supabase create (`anon`/`authenticated`/`service_role`/
// `supabase_auth_admin`, present locally only because
// `scripts/dev/auth-shim.sql` stubs them so the corpus's
// `GRANT ... TO authenticated` etc. statements have something to grant
// to).
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
  // Includes `auth` alongside `public` so `pull` also introspects the auth
  // shim's `auth.users` table (see scripts/dev/auth-shim.sql). Without this,
  // pull only sees `public`, but user_account.auth_user_id still has a real
  // FK into auth.users — pull then emits a dangling, unresolvable `users`
  // reference in the generated schema/relations files instead of a proper
  // `auth.table(...)` definition. This is throwaway scaffolding: Task B2
  // removes the corpus's dependency on Supabase GoTrue's `auth` schema
  // entirely, at which point this line (and `auth.users` in the generated
  // schema) goes away too.
  schemaFilter: ["public", "auth"],
  entities: {
    roles: {
      exclude: [
        "tmm_owner",
        "tmm_app",
        "anon",
        "authenticated",
        "service_role",
        "supabase_auth_admin",
      ],
    },
  },
  verbose: true,
  strict: true,
});
