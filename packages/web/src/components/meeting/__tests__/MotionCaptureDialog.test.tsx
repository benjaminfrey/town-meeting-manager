/**
 * `MotionCaptureDialog` — its `trpc.motion.pathFilter()` call.
 *
 * Phase E wave 5, Task 4. The insert is still raw Supabase (Task 5 owns it);
 * the READ it feeds moved to `trpc.motion.byMeeting`, so the two legacy
 * `queryKeys.motions.*` lines this file carried stopped reaching the live
 * screen that renders the motion the moment it is filed. Conventions item 7,
 * pinned per item 8 in the same commit as the call.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  }),
}));

import { MotionCaptureDialog } from "../MotionCaptureDialog";

const queryClient = setupAppQueryClient();

describe("MotionCaptureDialog cache invalidation", () => {
  it("invalidates trpc.motion.pathFilter() when a motion is recorded", async () => {
    const key = trpc.motion.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <MotionCaptureDialog
        open
        onOpenChange={() => {}}
        // A procedural motion: its text is prefilled and it needs no seconder,
        // so the only field this test has to fill is the mover.
        mode={{ type: "table", itemTitle: "Site Plan Review" }}
        meetingId="m1"
        townId="town-1"
        agendaItemId="item-1"
        presentMembers={[
          { boardMemberId: "bm-1", personId: "p-1", name: "Alice", seatTitle: null },
        ]}
      />,
      { queryClient },
    );

    await user.selectOptions(screen.getByLabelText("Moved by"), "bm-1");
    await user.click(screen.getByRole("button", { name: /record motion/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
