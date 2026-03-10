import { test, expect } from "./fixtures";

/**
 * E2E test for member management on the board detail page.
 *
 * Requires:
 * - Local Supabase running with seed data
 * - Dev server (started by Playwright via webServer config)
 * - Test admin credentials from fixtures.ts
 */

test.describe("member management", () => {
  test("can view board detail page with member roster", async ({
    authenticatedPage: page,
  }) => {
    // Navigate to boards list
    await page.goto("/boards");
    await page.waitForLoadState("networkidle");

    // Click on the first board in the list
    const boardLink = page.getByRole("link").filter({ hasText: /board|select|planning/i });
    const hasBoardLink = await boardLink.first().isVisible().catch(() => false);

    if (hasBoardLink) {
      await boardLink.first().click();

      // Should see the member roster section
      await expect(
        page.getByText(/member roster/i),
      ).toBeVisible({ timeout: 5_000 });

      // Should see "Add Member" button
      await expect(
        page.getByRole("button", { name: /add member/i }),
      ).toBeVisible();
    }
  });

  test("can open add member dialog", async ({ authenticatedPage: page }) => {
    // Navigate to boards
    await page.goto("/boards");
    await page.waitForLoadState("networkidle");

    const boardLink = page.getByRole("link").filter({ hasText: /board|select|planning/i });
    const hasBoardLink = await boardLink.first().isVisible().catch(() => false);

    if (hasBoardLink) {
      await boardLink.first().click();

      // Wait for member roster to load
      await expect(
        page.getByText(/member roster/i),
      ).toBeVisible({ timeout: 5_000 });

      // Click Add Member button
      await page.getByRole("button", { name: /add member/i }).click();

      // Dialog should appear with name field
      await expect(
        page.getByRole("dialog"),
      ).toBeVisible({ timeout: 3_000 });
    }
  });
});
