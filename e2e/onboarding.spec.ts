import { test, expect } from "@playwright/test";

/**
 * E2E test for the complete onboarding flow.
 *
 * Requires:
 * - Local Supabase running (supabase start)
 * - Dev server (started by Playwright via webServer config)
 * - A fresh user (not yet onboarded) or the ability to sign up
 */

test.describe("onboarding wizard", () => {
  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("full wizard flow: login → stages 1-5 → dashboard", async ({
    page,
  }) => {
    // Sign up a unique test user for this run
    const uniqueEmail = `e2e-${Date.now()}@test.local`;
    const password = "TestPassword123!";

    // Navigate to login
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

    // If there's a sign-up link, use it; otherwise use Supabase admin API
    const signUpLink = page.getByRole("link", { name: /sign up|register|create account/i });
    const hasSignUp = await signUpLink.isVisible().catch(() => false);

    if (hasSignUp) {
      await signUpLink.click();
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole("button", { name: /sign up|register|create/i }).click();
    } else {
      // Use the existing test credentials from fixtures
      await page.getByLabel(/email/i).fill("mbragdon@newcastle.me.us");
      await page.getByLabel(/password/i).fill("TestPassword123!");
      await page.getByRole("button", { name: /sign in/i }).click();
    }

    // Wait for redirect to setup wizard or dashboard
    await page.waitForURL(/\/(setup|dashboard)/, { timeout: 15_000 });

    // If we land on setup wizard, walk through it
    if (page.url().includes("/setup")) {
      // Stage 1: Town info
      await expect(page.getByText(/town name|municipality/i)).toBeVisible({
        timeout: 5_000,
      });

      // Fill in required fields
      const townNameInput = page.getByLabel(/town name/i);
      if (await townNameInput.isVisible().catch(() => false)) {
        await townNameInput.fill("E2E Test Town");
      }

      const contactNameInput = page.getByLabel(/your name|contact name/i);
      if (await contactNameInput.isVisible().catch(() => false)) {
        await contactNameInput.fill("Test Admin");
      }

      const contactRoleInput = page.getByLabel(/your role|title/i);
      if (await contactRoleInput.isVisible().catch(() => false)) {
        await contactRoleInput.fill("Town Clerk");
      }

      // Click Next through remaining stages
      const nextButton = page.getByRole("button", { name: /next|continue/i });

      // Navigate through stages (up to 5 stages)
      for (let stage = 1; stage <= 4; stage++) {
        if (await nextButton.isVisible().catch(() => false)) {
          await nextButton.click();
          // Wait briefly for stage transition
          await page.waitForTimeout(500);
        }
      }

      // Final stage — Complete/Finish button
      const completeButton = page.getByRole("button", {
        name: /complete|finish|get started/i,
      });
      if (await completeButton.isVisible().catch(() => false)) {
        await completeButton.click();
      }

      // Wait for redirect to dashboard
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    }

    // Verify dashboard loaded
    await expect(
      page.getByRole("heading").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
