/**
 * `AddBoardDialog` — `trpc.board.insert` on tRPC, and its cache invalidation.
 *
 * Wave 2, Task 2 converted this dialog's write from a raw Supabase insert to
 * `trpc.board.insert` — see that component's own doc comment. Real options
 * proxy, real `QueryClient` singleton, only `globalThis.fetch` replaced (see
 * `boards.$boardId.test.tsx` for why that distinction matters). This
 * supersedes the previous version of this file, which mocked
 * `@/hooks/useSupabase` directly; the underlying finding it pinned —
 * `AddBoardDialog` was the one board writer missing `trpc.board.pathFilter()`
 * — is unchanged and still covered below.
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { AddBoardDialog } from "../AddBoardDialog";

const queryClient = setupAppQueryClient();

const boardListRow: RouterOutputs["board"]["list"][number] = {
  id: "b1",
  name: "Existing Board",
  notice_template_blocks: null,
  member_count: 3,
  elected_or_appointed: "elected",
  archived_at: null,
  is_governing_board: false,
  active_member_count: 2,
};

const stub = installTRPCFetchStub({
  "board.insert": (input) => ({ id: "new-board", name: input.name }),
});

async function create() {
  const listKey = trpc.board.list.queryOptions().queryKey;
  queryClient.setQueryData(listKey, [boardListRow]);
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <AddBoardDialog townId="town-1" town={undefined} open onOpenChange={() => {}} />,
    { queryClient },
  );

  const nameInput = await screen.findByPlaceholderText("e.g. Planning Board");
  await user.type(nameInput, "Zoning Board");
  await user.tab();

  const createButton = await screen.findByRole("button", { name: /create board/i });
  await waitFor(() => expect(createButton).not.toBeDisabled());
  await user.click(createButton);
  await waitFor(() => expect(stub.countFor("board.insert")).toBe(1));

  return { listKey };
}

describe("AddBoardDialog", () => {
  it("submits the new board through trpc.board.insert", async () => {
    await create();
    expect(stub.calls[0]?.inputs["0"]).toMatchObject({ name: "Zoning Board" });
  });

  it("invalidates trpc.board.pathFilter() — the key ProgressChecklist's totalSeats/template counts and /boards read under", async () => {
    const { listKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });
});
