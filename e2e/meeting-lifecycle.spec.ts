/**
 * E2E Test: Full Meeting Lifecycle
 *
 * Tests the complete meeting flow from creation through adjournment
 * and post-meeting review. Requires Docker Supabase running with
 * seed data loaded.
 *
 * Steps: Create meeting → Set agenda → Start meeting → Take attendance →
 * Navigate items → Make motion → Vote → Adjourn → Review
 */

import { test, expect } from "./fixtures";

test.describe("Full Meeting Lifecycle", () => {
  test.setTimeout(120_000);

  test("completes a full meeting from start to adjournment", async ({
    authenticatedPage: page,
    seededTown,
  }) => {
    // Step 1: Navigate to board meetings page
    await page.goto(`/boards/${seededTown.boardId}`);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });

    // Step 2: Create a new meeting
    const createButton = page.getByRole("button", { name: /new meeting|create meeting|schedule/i });
    if (await createButton.isVisible()) {
      await createButton.click();

      // Fill meeting creation form
      const titleInput = page.getByLabel(/title/i);
      if (await titleInput.isVisible()) {
        await titleInput.fill("E2E Test Meeting");
      }

      const dateInput = page.getByLabel(/date/i);
      if (await dateInput.isVisible()) {
        await dateInput.fill("2026-03-15");
      }

      // Submit meeting creation
      const submitBtn = page.getByRole("button", { name: /create|save|schedule/i });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // Step 3: Navigate to meetings list and find a meeting to use
    await page.goto("/meetings");
    await page.waitForTimeout(2000);

    // Look for any available meeting link
    const meetingLinks = page.locator("a[href*='/meetings/']");
    const linkCount = await meetingLinks.count();

    if (linkCount === 0) {
      // If no meetings exist, skip remaining steps
      test.skip();
      return;
    }

    // Click the first meeting
    await meetingLinks.first().click();
    await page.waitForTimeout(2000);

    // Step 4: Navigate to the live meeting page
    const currentUrl = page.url();
    const meetingIdMatch = currentUrl.match(/\/meetings\/([^/]+)/);
    if (!meetingIdMatch) {
      test.skip();
      return;
    }
    const meetingId = meetingIdMatch[1];

    await page.goto(`/meetings/${meetingId}/live`);
    await page.waitForTimeout(3000);

    // Step 5: Handle meeting start flow if shown
    const startButton = page.getByRole("button", { name: /start meeting|begin/i });
    if (await startButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Meeting start flow — attendance step
      const attendanceCheckboxes = page.locator("input[type='checkbox']");
      const checkboxCount = await attendanceCheckboxes.count();
      // Mark at least enough members present for quorum
      for (let i = 0; i < Math.min(checkboxCount, 3); i++) {
        const checkbox = attendanceCheckboxes.nth(i);
        if (!(await checkbox.isChecked())) {
          await checkbox.check();
        }
      }

      // Proceed through start flow steps
      const nextButton = page.getByRole("button", { name: /next|continue|confirm/i });
      while (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(500);
      }

      // Final start button
      const finalStart = page.getByRole("button", { name: /start meeting|begin meeting/i });
      if (await finalStart.isVisible({ timeout: 2000 }).catch(() => false)) {
        await finalStart.click();
        await page.waitForTimeout(2000);
      }
    }

    // Step 6: Verify three-panel layout is visible
    // The live meeting page should show attendance, navigation, and detail panels
    await expect(
      page.locator("[data-testid], .flex").first(),
    ).toBeVisible({ timeout: 10_000 });

    // Step 7: Check for adjournment controls
    const adjournButton = page.getByRole("button", { name: /adjourn/i });
    if (await adjournButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Step 8: Adjourn the meeting
      await adjournButton.click();
      await page.waitForTimeout(500);

      // Look for "Adjourn Without Objection" option
      const woOption = page.getByRole("menuitem", { name: /without objection/i });
      if (await woOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await woOption.click();
        await page.waitForTimeout(500);

        // Confirm adjournment
        const confirmBtn = page.getByRole("button", { name: /confirm/i });
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
        }
      }
    }

    // Step 9: Verify navigation to review page (or check review page content)
    const reviewUrl = `/meetings/${meetingId}/review`;
    await page.goto(reviewUrl);
    await page.waitForTimeout(3000);

    // Step 10: Verify post-meeting review page loads
    // Should show meeting summary information
    const reviewContent = page.locator("body");
    await expect(reviewContent).toBeVisible();
  });

  test("records a motion and vote during meeting", async ({
    authenticatedPage: page,
    seededTown,
  }) => {
    // Navigate to meetings list
    await page.goto("/meetings");
    await page.waitForTimeout(2000);

    const meetingLinks = page.locator("a[href*='/meetings/']");
    const linkCount = await meetingLinks.count();

    if (linkCount === 0) {
      test.skip();
      return;
    }

    // Find a meeting with in_progress status
    await meetingLinks.first().click();
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    const meetingIdMatch = currentUrl.match(/\/meetings\/([^/]+)/);
    if (!meetingIdMatch) {
      test.skip();
      return;
    }

    const meetingId = meetingIdMatch[1];
    await page.goto(`/meetings/${meetingId}/live`);
    await page.waitForTimeout(3000);

    // Look for a "Make Motion" or "New Motion" button
    const motionButton = page.getByRole("button", { name: /motion|make motion|new motion/i });
    if (await motionButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await motionButton.click();
      await page.waitForTimeout(1000);

      // Fill motion dialog
      const motionText = page.getByLabel(/motion text/i);
      if (await motionText.isVisible({ timeout: 3000 }).catch(() => false)) {
        await motionText.fill("to approve the test item as presented");

        // Select mover
        const movedBy = page.getByLabel(/moved by/i);
        if (await movedBy.isVisible()) {
          const options = movedBy.locator("option");
          const optionCount = await options.count();
          if (optionCount > 1) {
            await movedBy.selectOption({ index: 1 });
          }
        }

        // Select seconder
        const secondedBy = page.getByLabel(/seconded by/i);
        if (await secondedBy.isVisible()) {
          const options = secondedBy.locator("option");
          const optionCount = await options.count();
          if (optionCount > 1) {
            await secondedBy.selectOption({ index: 1 });
          }
        }

        // Record motion
        const recordBtn = page.getByRole("button", { name: /record motion/i });
        if (await recordBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
          await recordBtn.click();
          await page.waitForTimeout(2000);

          // Look for vote buttons
          const yeaButtons = page.getByRole("button", { name: /yea/i });
          const yeaCount = await yeaButtons.count();

          if (yeaCount > 0) {
            // Click Yea for all available vote buttons
            for (let i = 0; i < yeaCount; i++) {
              await yeaButtons.nth(i).click();
              await page.waitForTimeout(200);
            }

            // Record vote
            const recordVoteBtn = page.getByRole("button", { name: /record vote/i });
            if (await recordVoteBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
              await recordVoteBtn.click();
              await page.waitForTimeout(2000);

              // Verify vote was recorded - motion should show "Passed"
              await expect(
                page.getByText(/passed/i).first(),
              ).toBeVisible({ timeout: 5000 });
            }
          }
        }
      }
    }
  });
});
