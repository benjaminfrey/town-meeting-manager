/**
 * `ExitExecutiveSessionDialog` — its `trpc.executiveSession.pathFilter()` call.
 *
 * Phase E wave 5, Task 4. The write is still raw Supabase (Task 5 owns it),
 * but the READ it moves is now `trpc.executiveSession.byMeeting`: the live
 * screen's banner and its `isInExecSession` branch both come from there, and
 * the `queryKeys.executiveSessions.detail` line this file already carried
 * never reached either. Conventions item 7's completion gate, with item 8's
 * pin in the same commit.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain = {
        update: () => chain,
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { ExitExecutiveSessionDialog } from "../ExitExecutiveSessionDialog";

const queryClient = setupAppQueryClient();

describe("ExitExecutiveSessionDialog cache invalidation", () => {
  it("invalidates trpc.executiveSession.pathFilter() when the session is exited", async () => {
    const key = trpc.executiveSession.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderWithProviders(
      <ExitExecutiveSessionDialog
        open
        onOpenChange={() => {}}
        execSessionId="es-1"
        onReturnWithActions={() => {}}
        onReturnNoActions={() => {}}
      />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: /confirm return/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
