import { defineConfig, devices } from "@playwright/test";

/**
 * DATABASE_URL must point at the RUNTIME (non-owner) role of a database
 * already built and seeded by scripts/dev/reset-local-db.sh — e.g.:
 *
 *   ./scripts/dev/reset-local-db.sh tmm_e2e
 *   # prints a "Runtime URL" of the form
 *   # postgres://tmm_owner@localhost:5432/tmm_e2e?options=-c%20role%3Dtmm_app
 *   DATABASE_URL="postgres://tmm_owner@localhost:5432/tmm_e2e?options=-c%20role%3Dtmm_app" \
 *     npx playwright test --project=chromium
 *
 * This config does not build or seed a database itself — see
 * docs/backlog.md entry 22 and .github/workflows/ci.yml's `e2e` job for the
 * bootstrap sequence that has to run first.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Build a seeded database first, e.g.:\n" +
      "  ./scripts/dev/reset-local-db.sh tmm_e2e\n" +
      "then export the printed Runtime URL " +
      "(postgres://tmm_owner@localhost:5432/<db>?options=-c%20role%3Dtmm_app) " +
      "before running Playwright. See playwright.config.ts and docs/backlog.md entry 22.",
  );
}

// Not a production secret — this process and its sessions are thrown away
// at the end of the run. Override with a real BETTER_AUTH_SECRET if you
// need a stable value across runs (e.g. to reuse a storageState).
const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "e2e-local-only-secret-do-not-use-in-production-32bytes";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? APP_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,

  use: {
    baseURL: APP_URL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "on-first-retry",
  },

  // CI runs chromium only (`playwright test --project=chromium` in
  // .github/workflows/ci.yml) — firefox/webkit stay configured here for
  // local use, invoked the same way with --project=firefox / --project=webkit.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  // Two servers: the API is not started for you. Both must come up for any
  // spec that reads real data to have a chance of passing — see
  // docs/backlog.md entry 22, break #3.
  webServer: [
    {
      // Runs as the NON-OWNER `tmm_app` role via DATABASE_URL's
      // `options=-c role=tmm_app`, same as production — never the owner
      // connection (see packages/api/.env.example).
      command: "pnpm --filter @town-meeting/api exec tsx src/index.ts",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL,
        APP_URL,
        PORT: "3001",
      },
    },
    {
      // Proxies /api to localhost:3001 in dev (packages/web/vite.config.ts)
      // — same-origin, matching production's nginx arrangement.
      command: "pnpm --filter @town-meeting/web dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
