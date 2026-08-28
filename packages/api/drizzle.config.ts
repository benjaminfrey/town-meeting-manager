import { defineConfig } from "drizzle-kit";

// Task 4 (B1): schema introspection config for `drizzle-kit pull`.
//
// `entities.roles.exclude` is not optional. By default drizzle-kit manages
// Postgres roles as part of its schema diffing and will propose DROPPING
// any role it finds on the cluster that it doesn't already know about.
// Two classes of role must be excluded here:
//
//   - `tmm_owner` / `tmm_app`: the application's own login roles on the
//     dev VM. A generated migration that drops its own connecting role
//     is not hypothetical — this is the exact failure mode the config
//     exists to prevent.
//   - `anon` / `authenticated` / `service_role` / `supabase_auth_admin`:
//     the four roles GoTrue/Supabase create, present locally because
//     `scripts/dev/auth-shim.sql` stubs them so the migration corpus's
//     `GRANT ... TO authenticated` etc. statements have something to
//     grant to. They are not roles this schema should ever manage.
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
