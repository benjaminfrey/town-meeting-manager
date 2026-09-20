import { test, expect } from "./fixtures";

/**
 * Proves data actually reaches the browser from the API — not just that a
 * page renders *a* heading, but that the heading contains the specific
 * seeded town name for the account that just signed in.
 *
 * This is the shape of assertion that would have caught Phase E wave 5's
 * blank live-meeting screen (docs/backlog.md entry 22): 1725 green unit
 * tests coexisted with a real screen that rendered nothing, because nothing
 * exercised the running product end to end. `home.tsx` renders
 * `trpc.town.detail`'s `name` field as its top `<h1>`, falling back to
 * "Your town" only while the query is loading or if it errors — so seeing
 * "Newcastle" here means: the browser loaded the app, Better Auth accepted
 * the seeded admin's session, the tenant-scoped tRPC call reached Postgres
 * through the non-owner `tmm_app` role, and the response was painted.
 */

test.describe("authenticated dashboard", () => {
  test("shows the signed-in admin's seeded town name, not a placeholder", async ({
    authenticatedPage: page,
  }) => {
    await expect(page.getByRole("heading", { name: "Newcastle", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
  });
});
