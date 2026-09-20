import { test, expect } from "@playwright/test";

/**
 * E2E test for the complete onboarding flow.
 *
 * Requires:
 * - A local Postgres database built via `pnpm db:reset` (see README.md)
 * - Dev server (started by Playwright via webServer config)
 * - A fresh user (not yet onboarded) or the ability to sign up
 */

test.describe("onboarding wizard", () => {
  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  // QUARANTINED 2026-09-20 (docs/backlog.md entry 22/23) — measured broken
  // against the current app, not just the stale password below:
  //
  //   1. This test's sign-up detection looks for a link named
  //      /sign up|register|create account/i. login.tsx's actual link text
  //      is "Create one" (see packages/web/src/routes/login.tsx), which
  //      matches none of those — so `hasSignUp` is always false and this
  //      test never takes the fresh-signup path it's named for.
  //   2. It falls through to signing in with the seed admin's credentials,
  //      using a hard-coded password ("TestPassword123!") independent of
  //      e2e/fixtures.ts's TEST_PASSWORD — wrong for the same reason entry
  //      22 flagged fixtures.ts:30 (the dev bootstrap creates
  //      `TownMeeting!Dev1`/`DEV_PASSWORD`), so the sign-in itself fails and
  //      the subsequent `waitForURL(/\/(setup|dashboard)/)` times out.
  //   3. Even with the password fixed, the seed admin already belongs to a
  //      town, so login.tsx sends it straight past `/setup` — there is no
  //      "walk the 5-stage wizard" path available with the only real
  //      account this suite has. Exercising it for real needs a genuine
  //      fresh-signup flow (Zod's `z.uuid()` etc. all currently untested
  //      here), which is new spec authoring, not a fixture repair — out of
  //      scope for backlog entry 22.
  //
  // Left in place rather than deleted so the intent (and the found breakage)
  // stays visible; test("unauthenticated user is redirected to login") above
  // still runs and covers the one assertion here that was actually sound.
  test.skip("full wizard flow: login → stages 1-5 → dashboard", async ({ page }) => {
    // Sign up a unique test user for this run
    const uniqueEmail = `e2e-${Date.now()}@test.local`;
    const password = "TestPassword123!";

    // Navigate to login
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

    // If there's a sign-up link, use it; otherwise sign in with the existing
    // seed credentials
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
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 5_000 });
  });
});
