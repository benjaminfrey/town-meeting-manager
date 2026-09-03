/**
 * `CancelMeetingDialog` — `trpc.meeting.cancel` on tRPC, and its cache
 * invalidation.
 *
 * Phase E, wave 3, Task 2 closes a real authorization hole here (see this
 * component's own doc comment) — not a completeness gap, so conventions
 * item 6 ("authorization is not re-proven on the web") applies: this file
 * covers rendering, the write itself, and cache invalidation, not the
 * `requireBoardActor` guard, which is the API's own `meeting.test.ts` job.
 *
 * Real options proxy, real `QueryClient` singleton, only `globalThis.fetch`
 * replaced — see `boards.$boardId.test.tsx` for why that distinction
 * matters.
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";
import { CancelMeetingDialog } from "../CancelMeetingDialog";

const queryClient = setupAppQueryClient();

/** Set by the `meeting.cancel` handler, so a test can assert on the exact input sent. */
const received: { cancel?: unknown } = {};

const stub = installTRPCFetchStub({
  "meeting.cancel": (input) => {
    received.cancel = input;
    return { id: input.meetingId };
  },
});

async function cancel() {
  const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "b1" }).queryKey;
  const legacyDetailKey = queryKeys.meetings.detail("m1");
  const legacyAllKey = queryKeys.meetings.all;
  queryClient.setQueryData(byBoardKey, []);
  queryClient.setQueryData(legacyDetailKey, {});
  queryClient.setQueryData(legacyAllKey, []);
  expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <CancelMeetingDialog
      meetingId="m1"
      meetingTitle="Regular Meeting"
      boardId="b1"
      open
      onOpenChange={() => {}}
    />,
    { queryClient },
  );

  await user.click(screen.getByRole("button", { name: "Cancel Meeting" }));
  await waitFor(() => expect(stub.countFor("meeting.cancel")).toBe(1));

  return { byBoardKey, legacyDetailKey, legacyAllKey };
}

describe("CancelMeetingDialog", () => {
  it("sends the meetingId and boardId through trpc.meeting.cancel", async () => {
    await cancel();
    expect(received.cancel).toEqual({ meetingId: "m1", boardId: "b1" });
  });

  it("invalidates trpc.meeting.pathFilter() — the key boards.$boardId.meetings.tsx and meetings.tsx read under", async () => {
    const { byBoardKey } = await cancel();
    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("invalidates the legacy meetings.detail/meetings.all keys — other, unmigrated readers still use them", async () => {
    const { legacyDetailKey, legacyAllKey } = await cancel();
    await waitFor(() =>
      expect(queryClient.getQueryState(legacyDetailKey)?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(legacyAllKey)?.isInvalidated).toBe(true);
  });
});
