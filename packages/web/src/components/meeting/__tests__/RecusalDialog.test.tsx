/**
 * `RecusalDialog` — its `trpc.voteRecord.pathFilter()` call, and its refusal.
 *
 * Phase E wave 5, Task 5. A recusal is a `vote_record` row, written through
 * `voteRecord.insert` now. This is the one path in the product where rule 5's
 * self-vote branch is reachable, so the refusal a board member sees comes from
 * the rule rather than from the middleware prefilter — either way it is
 * FORBIDDEN, and either way it renders inside this dialog, which stays open.
 *
 * The third test pins the OTHER reachability path, which is not a dialog
 * question but a precondition one: with no motion in front of the board there
 * is nothing to insert, and the component must still complete the recusal
 * locally rather than call a procedure with a null motion id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { RecusalDialog } from "../RecusalDialog";

const queryClient = setupAppQueryClient();

const server = { insertRefuses: false };

const stub = installTRPCFetchStub({
  "voteRecord.insert": () => {
    if (server.insertRefuses) trpcTestError("FORBIDDEN");
    return { id: "vr-1" };
  },
});

function renderDialog(activeMotionId: string | null, onRecusalRecorded = () => {}) {
  return renderWithProviders(
    <RecusalDialog
      open
      onOpenChange={() => {}}
      memberName="Alice Smith"
      boardMemberId="bm-1"
      meetingId="m1"
      boardId="board-1"
      activeMotionId={activeMotionId}
      onRecusalRecorded={onRecusalRecorded}
    />,
    { queryClient },
  );
}

async function fillAndSubmit(user: ReturnType<typeof renderDialog>["user"]) {
  await user.type(
    screen.getByPlaceholderText(/conflict of interest/i),
    "Applicant is a family member",
  );
  await user.click(screen.getByRole("button", { name: /record recusal/i }));
}

describe("RecusalDialog", () => {
  beforeEach(() => {
    server.insertRefuses = false;
  });

  it("invalidates trpc.voteRecord.pathFilter() when a recusal is recorded against a live motion", async () => {
    const key = trpc.voteRecord.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog("motion-1");
    await fillAndSubmit(user);

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("shows a refusal INSIDE the dialog when the vote record is FORBIDDEN", async () => {
    server.insertRefuses = true;
    const { user } = renderDialog("motion-1");
    await fillAndSubmit(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to record this recusal/i);
  });

  it("records the recusal locally, with no procedure call, when no motion is in front of the board", async () => {
    const onRecusalRecorded = vi.fn();
    const before = stub.countFor("voteRecord.insert");
    const { user } = renderDialog(null, onRecusalRecorded);
    await fillAndSubmit(user);

    await waitFor(() => expect(onRecusalRecorded).toHaveBeenCalledTimes(1));
    expect(stub.countFor("voteRecord.insert")).toBe(before);
  });
});
