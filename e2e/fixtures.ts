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

// Default test credentials — match the seed data admin account.
// These require Docker Supabase to be running with seed data loaded.
const TEST_EMAIL = "mbragdon@newcastle.me.us";
const TEST_PASSWORD = "TestPassword123!";

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

    // Wait for redirect to dashboard (or setup wizard)
    await page.waitForURL(/\/(dashboard|setup)/, { timeout: 15_000 });

    await use(page);
  },

  /**
   * Returns test town/board/user IDs from the seed data.
   * These match supabase/seed.sql values.
   */
  seededTown: async ({}, use) => {
    await use({
      townId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      boardId: "bbbb0001-0000-0000-0000-000000000000",
      adminUserId: "aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
  },
});

export { expect };
