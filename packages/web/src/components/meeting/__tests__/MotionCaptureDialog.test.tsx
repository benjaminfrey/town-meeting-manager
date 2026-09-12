/**
 * `MotionCaptureDialog` — its `trpc.motion.pathFilter()` call, and its refusal.
 *
 * Phase E wave 5, Task 5. The insert is `motion.insert` now; it was raw
 * Supabase with no authorization check of any kind (`motion_tenant_isolation`
 * is tenancy-only), so FORBIDDEN is newly reachable. The refusal renders inside
 * the `DialogContent`, which is where it has to be: a refused insert leaves
 * this dialog open, and everything outside an open Radix dialog is
 * `aria-hidden`. The test asserts `role="alert"`, not the string.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { MotionCaptureDialog } from "../MotionCaptureDialog";

const queryClient = setupAppQueryClient();

const server = { insertRefuses: false };

const stub = installTRPCFetchStub({
  "motion.insert": () => {
    if (server.insertRefuses) trpcTestError("FORBIDDEN");
    return { id: "motion-new" };
  },
});

function renderDialog() {
  return renderWithProviders(
    <MotionCaptureDialog
      open
      onOpenChange={() => {}}
      // A procedural motion: its text is prefilled and it needs no seconder,
      // so the only field this test has to fill is the mover.
      mode={{ type: "table", itemTitle: "Site Plan Review" }}
      meetingId="m1"
      boardId="board-1"
      agendaItemId="item-1"
      presentMembers={[{ boardMemberId: "bm-1", personId: "p-1", name: "Alice", seatTitle: null }]}
    />,
    { queryClient },
  );
}

describe("MotionCaptureDialog", () => {
  beforeEach(() => {
    server.insertRefuses = false;
  });

  it("invalidates trpc.motion.pathFilter() when a motion is recorded", async () => {
    const key = trpc.motion.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();

    await user.selectOptions(screen.getByLabelText("Moved by"), "bm-1");
    await user.click(screen.getByRole("button", { name: /record motion/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
    expect(stub.countFor("motion.insert")).toBe(1);
  });

  it("shows a refusal INSIDE the dialog when the insert is FORBIDDEN", async () => {
    server.insertRefuses = true;
    const { user } = renderDialog();

    await user.selectOptions(screen.getByLabelText("Moved by"), "bm-1");
    await user.click(screen.getByRole("button", { name: /record motion/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to record a motion/i);
  });
});
