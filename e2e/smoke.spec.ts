import { test, expect } from "@playwright/test";

/**
 * Smoke test for the login page (packages/web/src/routes/login.tsx).
 *
 * This replaces a version that asserted `hasLogin || hasHeading` — true on
 * any page that renders any heading at all, including a 404. It could not
 * fail, and did not, through a rewrite of every screen it was meant to
 * guard (docs/backlog.md entry 22). The assertions below are read straight
 * off login.tsx's actual markup and copy, not guessed: the `Label`s are
 * literally "Email" and "Password", the button's resting text is "Sign in",
 * and a rejected credential renders `formError` — "Invalid email or
 * password" for a wrong password — inside the page rather than redirecting
 * or doing nothing.
 */

test.describe("smoke", () => {
  test("login page renders its email, password and sign-in controls", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("Sign in to your account")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("a wrong password produces a visible error, not a silent no-op", async ({ page }) => {
    await page.goto("/login");

    // A real, seeded email (packages/api/drizzle/seed/seed.sql) with a
    // syntactically valid but wrong password — this must fail on Better
    // Auth's credential check, not on the form's own client-side validation,
    // so the assertion below is exercising describeAuthError(), not Zod.
    await page.getByLabel("Email", { exact: true }).fill("mbragdon@newcastle.me.us");
    await page.getByLabel("Password", { exact: true }).fill("DefinitelyWrongPassword1!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText("Invalid email or password")).toBeVisible({ timeout: 10_000 });
    // Still on the login page — a broken auth call that swallowed the
    // error would otherwise look identical to success from here on out.
    await expect(page).toHaveURL(/\/login$/);
  });
});
