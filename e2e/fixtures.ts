/**
 * Playwright test fixtures for Town Meeting Manager E2E tests.
 *
 * Provides pre-configured test contexts:
 * - authenticatedPage: a Page already logged in as a test admin
 * - seededTown: test data IDs for town/board/user
 *
 * Usage:
 *   import { test, expect } from "./fixtures";
 *
 *   test("admin can view dashboard", async ({ authenticatedPage }) => {
 *     await expect(authenticatedPage.getByRole("heading")).toContainText("Dashboard");
 *   });
 */

import { test as base, expect, type Page } from "@playwright/test";

// ─── Test data ──────────────────────────────────────────────────────

interface SeededTown {
  townId: string;
  boardId: string;
  adminUserId: string;
}

// Default test credentials — match the seed data admin account
// (packages/api/drizzle/seed/seed.sql) and the login the bootstrap script
// creates for it (scripts/dev/reset-local-db.sh's `seed-dev-logins-cli.ts`
// step). These require a local Postgres database built and seeded via
// `./scripts/dev/reset-local-db.sh` (see README.md) — plain `pnpm db:reset`
// alone does not create the Better Auth logins these tests sign in with.
//
// The password matches the bootstrap's own override knob (`DEV_PASSWORD`)
// rather than hard-coding two independent values that can drift apart.
const TEST_EMAIL = "mbragdon@newcastle.me.us";
const TEST_PASSWORD = process.env.DEV_PASSWORD ?? "TownMeeting!Dev1";

// ─── Fixtures ───────────────────────────────────────────────────────

interface TestFixtures {
  authenticatedPage: Page;
  seededTown: SeededTown;
}

export const test = base.extend<TestFixtures>({
  /**
   * A Page object that is already logged in as the test admin user.
   */
  authenticatedPage: async ({ page }, use) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for the post-login redirect. login.tsx sends an admin with a town
    // to "/dashboard", which is itself a back-compat redirect
    // (routes/redirect-home.tsx) straight through to "/" — so "/dashboard"
    // is transient and a regex race against it is not reliable. A user with
    // no town lands on "/setup" and stays there. Match on the settled
    // pathname rather than the momentary one.
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/setup", {
      timeout: 15_000,
    });

    await use(page);
  },

  /**
   * Returns test town/board/user IDs from the seed data.
   * These match packages/api/drizzle/seed/seed.sql values — verified against
   * that file 2026-09-20 (see docs/backlog.md entry 22). The previous values
   * here (`bbbb0001-...`, `aaaa1111-aaaa-aaaa-...`) matched nothing the seed
   * creates: wrong id entirely for the board, and a UUID missing the version
   * (4) / variant (8) nibbles Zod's `z.uuid()` requires, which the seed
   * file's own header now warns about at length.
   */
  // Playwright requires the object-destructuring form even for a fixture
  // function that uses none of the built-in fixtures; `(_fixtures, use)` is
  // rejected at runtime with "First argument must use the object
  // destructuring pattern".
  // eslint-disable-next-line no-empty-pattern
  seededTown: async ({}, use) => {
    await use({
      townId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      // Select Board — the governing board, and the one the seed's one
      // meeting (dddd1111-...) belongs to.
      boardId: "bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      adminUserId: "aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  },
});

export { expect };
