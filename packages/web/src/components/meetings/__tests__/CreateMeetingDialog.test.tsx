/**
 * `CreateMeetingDialog` — `trpc.meeting.insert`/`trpc.agendaTemplate.list` on
 * tRPC, and its cache invalidation.
 *
 * Phase E, wave 3, Task 2. Real options proxy, real `QueryClient` singleton,
 * only `globalThis.fetch` replaced (see `boards.$boardId.test.tsx` for why
 * that distinction matters — it is what lets the second/third tests below
 * prove a writer's `trpc.meeting.pathFilter()`/legacy-key invalidations
 * reach the reads migrated screens actually use).
 *
 * `@/hooks/useSupabase` is still mocked: the member-count and town-retention
 * reads stay raw Supabase (not this task's file list — see this component's
 * own header for what did move).
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

const { memberChain, townChain } = vi.hoisted(() => {
  const memberChain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ count: 5, error: null }).then(resolve),
  };
  for (const m of ["select", "eq"]) {
    memberChain[m] = () => memberChain;
  }

  const townChain: Record<string, unknown> = {
    single: () =>
      Promise.resolve({
        data: { retention_policy_acknowledged_at: "2026-01-01T00:00:00Z", state: "ME" },
        error: null,
      }),
  };
  for (const m of ["select", "eq"]) {
    townChain[m] = () => townChain;
  }

  return { memberChain, townChain };
});

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: (table: string) => (table === "town" ? townChain : memberChain),
  }),
}));

import { CreateMeetingDialog } from "../CreateMeetingDialog";

const queryClient = setupAppQueryClient();

/** Set by the `meeting.insert` handler, so a test can assert on the exact input sent. */
const received: { insert?: unknown } = {};

const stub = installTRPCFetchStub({
  "agendaTemplate.list": () => [],
  "meeting.insert": (input) => {
    received.insert = input;
    return { id: "new-meeting" };
  },
});

async function create() {
  const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "b1" }).queryKey;
  const legacyKey = queryKeys.meetings.byBoard("b1");
  queryClient.setQueryData(byBoardKey, []);
  queryClient.setQueryData(legacyKey, []);
  expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <CreateMeetingDialog
      boardId="b1"
      boardName="Select Board"
      townId="town-1"
      open
      onOpenChange={() => {}}
    />,
    { queryClient, route: "/boards/b1/meetings" },
  );

  // The form's own defaults already satisfy the schema — a blur is enough to
  // run the resolver and flip `isValid`, matching `AddBoardDialog.test.tsx`'s
  // identical shape.
  const titleInput = await screen.findByPlaceholderText("Meeting title");
  await user.click(titleInput);
  await user.tab();

  const createButton = await screen.findByRole("button", { name: /create meeting/i });
  await waitFor(() => expect(createButton).not.toBeDisabled());
  await user.click(createButton);
  await waitFor(() => expect(stub.countFor("meeting.insert")).toBe(1));

  return { byBoardKey, legacyKey };
}

describe("CreateMeetingDialog", () => {
  it("submits the new meeting through trpc.meeting.insert", async () => {
    await create();
    expect(received.insert).toMatchObject({ boardId: "b1" });
  });

  it("invalidates trpc.meeting.pathFilter() — the key boards.$boardId.meetings.tsx and meetings.tsx read under", async () => {
    const { byBoardKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("invalidates the legacy meetings.byBoard key — EditBoardDialog's meeting-count check still reads it", async () => {
    const { legacyKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });
});
