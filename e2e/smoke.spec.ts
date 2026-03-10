import { test, expect } from "@playwright/test";

test.describe("smoke tests", () => {
  test("app loads and shows login page", async ({ page }) => {
    await page.goto("/");

    // The app should either show the login page or redirect to it
    await page.waitForURL(/\/(login)?/, { timeout: 10_000 });

    // Verify the page loaded with meaningful content
    const title = await page.title();
    expect(title).toBeTruthy();

    // Should have a sign-in form or heading
    const loginForm = page.getByRole("button", { name: /sign in/i });
    const heading = page.getByRole("heading");

    // At least one of these should be visible
    const hasLogin = await loginForm.isVisible().catch(() => false);
    const hasHeading = await heading.first().isVisible().catch(() => false);

    expect(hasLogin || hasHeading).toBe(true);
  });
});
