import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // db-harness.ts tests provision a real database and apply the full
    // migration corpus per test (see packages/api/src/test/db-harness.ts).
    // That's ~0.7s over a local Unix socket but has more headroom to spend
    // over the CI service container's TCP connection, so the default 5s
    // vitest timeout is raised for this package specifically.
    testTimeout: 30_000,
    // Drops the four cluster-scoped auth-shim roles (anon, authenticated,
    // service_role, supabase_auth_admin) once, after the whole run — see
    // packages/api/src/test/global-teardown.ts. Roles outlive the
    // per-test databases withTestDb() drops, so without this they leak
    // onto whatever Postgres cluster the tests ran against.
    globalSetup: ["./src/test/global-teardown.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
  },
});
