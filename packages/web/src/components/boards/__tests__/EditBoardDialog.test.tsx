/**
 * `EditBoardDialog` — `trpc.board.update` on tRPC, and its cache invalidation.
 *
 * Wave 2, Task 2 converted this dialog's write from a raw Supabase update
 * (which sent a nonexistent `updated_at` column — see the component's own
 * doc comment) to `trpc.board.update`. Real options proxy, real
 * `QueryClient` singleton, only `globalThis.fetch` replaced.
 *
 * A writer's cache invalidation is a pinnable behaviour, not a code comment —
 * this file's invalidation test is unit 0's original finding (Phase E, unit
 * 0 final-fix pass: `EditBoardDialog` was one of three writers with a
 * `trpc.board.pathFilter()` call and no test pinning it) carried forward
 * onto the tRPC write. Deleting the `pathFilter()` line from
 * `EditBoardDialog.tsx` still turns this red.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

// `EditBoardDialog` still reads `meeting` count off `@/hooks/useSupabase`
// directly (whether the board has meetings, to disable the name field) —
// not this task's file list. Mocked just enough to resolve.
vi.mock("@/hooks/useSupabase", () => {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: { count: number; error: null }) => void) =>
      resolve({ count: 0, error: null }),
  };
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { useSupabase: () => ({ from: vi.fn().mockReturnValue(chain) }) };
});

import { EditBoardDialog } from "../EditBoardDialog";

const queryClient = setupAppQueryClient();

const board: RouterOutputs["board"]["detail"] = {
  id: "b1",
  name: "Select Board",
  board_type: "other",
  elected_or_appointed: "elected",
  member_count: 5,
  election_method: "at_large",
  officer_election_method: "vote_of_board",
  is_governing_board: true,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: "simple_majority",
  quorum_value: null,
  motion_display_format: "inline_narrative",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  notice_template_blocks: null,
  minutes_consent_agenda: false,
  minutes_requires_second: true,
  r4_board_member_default: true,
  audio_retention_policy_override: null,
  auto_publish_on_approval_override: null,
};

const stub = installTRPCFetchStub({
  "board.update": (input) => ({ id: input.boardId, name: input.name }),
});

async function save() {
  const detailKey = trpc.board.detail.queryOptions({ boardId: board.id }).queryKey;
  queryClient.setQueryData(detailKey, board);
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <EditBoardDialog townId="town-1" town={undefined} board={board} open onOpenChange={() => {}} />,
    { queryClient },
  );

  // Every initial value already satisfies the schema; a blur on the
  // unchanged name field is enough to trigger react-hook-form's
  // whole-schema resolver validation and flip `isValid`, which is what
  // enables the Save Changes button.
  await user.click(screen.getByDisplayValue("Select Board"));
  await user.tab();

  const saveButton = await screen.findByRole("button", { name: /save changes/i });
  await waitFor(() => expect(saveButton).not.toBeDisabled());
  await user.click(saveButton);
  await waitFor(() => expect(stub.countFor("board.update")).toBe(1));

  return { detailKey };
}

describe("EditBoardDialog", () => {
  it("submits the edit through trpc.board.update, with no updated_at field", async () => {
    // The `not.toHaveProperty` assertion below is a weak runtime signal, not
    // the real protection — `board.update`'s Zod schema has no `updated_at`
    // field, so `tsc` already refuses any call site that tries to send one
    // (verified: reintroducing it in `EditBoardDialog.tsx`'s `mutateAsync`
    // call is a compile error, not a test failure). Kept anyway as a cheap,
    // literal check on what the stub actually received.
    await save();
    const input = stub.calls[0]?.inputs["0"] as Record<string, unknown>;
    expect(input).toMatchObject({ boardId: "b1", name: "Select Board" });
    expect(input).not.toHaveProperty("updated_at");
  });

  it("invalidates the tRPC key the board detail screen reads under", async () => {
    const { detailKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});
