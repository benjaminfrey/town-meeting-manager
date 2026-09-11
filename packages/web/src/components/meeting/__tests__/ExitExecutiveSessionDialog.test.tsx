/**
 * `ExitExecutiveSessionDialog` — its `trpc.executiveSession.pathFilter()` call,
 * and its refusal.
 *
 * Phase E wave 5, Task 5. The write is `executiveSession.markExited` now; it
 * was a raw `.update({exited_at})` with no authorization check of any kind
 * under `executive_session_tenant_isolation`, which is tenancy-only. So
 * FORBIDDEN is newly reachable here, and the second test pins where it is
 * rendered: INSIDE the dialog, which stays open on a refusal while Radix marks
 * everything outside it `aria-hidden` (conventions item 2, wave 4 Task 3). It
 * asserts on `role="alert"` rather than the string, which is what makes the
 * placement — not just the presence — the thing under test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { ExitExecutiveSessionDialog } from "../ExitExecutiveSessionDialog";

const queryClient = setupAppQueryClient();

const server = { exitRefuses: false };

installTRPCFetchStub({
  "executiveSession.markExited": ({ executiveSessionId }) => {
    if (server.exitRefuses) trpcTestError("FORBIDDEN");
    return { id: executiveSessionId };
  },
});

function renderDialog() {
  return renderWithProviders(
    <ExitExecutiveSessionDialog
      open
      onOpenChange={() => {}}
      execSessionId="es-1"
      boardId="board-1"
      onReturnWithActions={() => {}}
      onReturnNoActions={() => {}}
    />,
    { queryClient },
  );
}

describe("ExitExecutiveSessionDialog", () => {
  beforeEach(() => {
    server.exitRefuses = false;
  });

  it("invalidates trpc.executiveSession.pathFilter() when the session is exited", async () => {
    const key = trpc.executiveSession.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: /confirm return/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("shows a refusal INSIDE the dialog when returning to open session is FORBIDDEN", async () => {
    server.exitRefuses = true;
    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: /confirm return/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to return this board to open session/i);
    // The dialog did NOT advance to its second step, so the message is inside
    // the surface the user is still looking at.
    expect(screen.getByRole("button", { name: /confirm return/i })).toBeInTheDocument();
  });
});
