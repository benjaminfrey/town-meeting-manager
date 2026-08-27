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
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
  },
});
