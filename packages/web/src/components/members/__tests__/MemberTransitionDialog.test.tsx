/**
 * `MemberTransitionDialog` — `boardMember.otherActiveCount`,
 * `board.listActive`, `boardMember.archiveMembership`,
 * `boardMember.addToBoard` and `boardMember.convertToStaff` on tRPC.
 *
 * Phase E, wave 2, Task 4. Real options proxy, real `QueryClient` singleton,
 * only `globalThis.fetch` replaced — conventions item 8. The prior version of
 * this file mocked `@/hooks/useSupabase` wholesale and could only pin the
 * invalidation calls (this component's own writes were still raw Supabase);
 * this version exercises the real writes too, including `moveMembership`
 * (`addToBoard`) — the mutation a prior fix report named as previously
 * unexercised by this file (deleting its `pathFilter()` call left the whole
 * web suite green).
 *
 * `member.user_account_id` is `null` in the fixture below so
 * `handleTransitionSelect`'s mutual-exclusivity check does not route through
 * `RoleConflictDialog` — that check only fires when the person already HAS
 * an account, which is exactly the branch `convertToStaff` treats
 * differently (update-in-place vs. insert) but is not what this file tests.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

// Radix `Select` (the "move to different board" target picker) calls
// `hasPointerCapture`/`releasePointerCapture`/`scrollIntoView` on open and
// on selecting an option — none implemented in jsdom. File-scoped stubs
// (jsdom gives each test FILE its own `window`), not global setup: no other
// file in this suite drives a Radix `Select` yet.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("../StaffAccountFlow", () => ({
  StaffAccountFlow: ({ onComplete }: { onComplete: (r: unknown) => void }) => (
    <button
      onClick={() =>
        onComplete({ permissions: { global: {}, board_overrides: [] }, gov_title: "" })
      }
    >
      finish-staff
    </button>
  ),
}));

import { MemberTransitionDialog } from "../MemberTransitionDialog";

const queryClient = setupAppQueryClient();

const member = {
  id: "bm1",
  person_id: "p1",
  name: "Jamie Clerk",
  role: "board_member",
  user_account_id: null,
};

/** The "move to different board" picker's only row — `board-2` != `boardId` ("b1"). */
const otherBoard = {
  id: "board-2",
  name: "Planning Board",
  member_count: 5,
  is_governing_board: false,
  election_method: "at_large" as const,
  officer_election_method: null,
};

const server = { otherActiveCount: 0 };

const stub = installTRPCFetchStub({
  "boardMember.otherActiveCount": () => server.otherActiveCount,
  // Includes `boardId` itself — `MemberTransitionDialog` filters it out
  // client-side, mirroring `StaffAccountFlow.tsx`'s established pattern for
  // this same procedure (see its own doc comment).
  "board.listActive": () => [
    { ...otherBoard },
    {
      id: "b1",
      name: "Select Board",
      member_count: 3,
      is_governing_board: true,
      election_method: "at_large",
      officer_election_method: "vote_of_board",
    },
  ],
  "boardMember.archiveMembership": () => ({ archivedAccount: false }),
  "boardMember.addToBoard": (input) => ({ boardId: input.boardId }),
  "boardMember.convertToStaff": (input) => ({ personId: input.personId }),
});

function renderDialog(onOpenChange: () => void) {
  return renderWithProviders(
    <MemberTransitionDialog
      member={member}
      boardId="b1"
      boardName="Select Board"
      townId="town-1"
      open
      onOpenChange={onOpenChange}
    />,
    { queryClient },
  );
}

describe("MemberTransitionDialog", () => {
  it("filters the current board out of the 'move to different board' picker", async () => {
    const { user } = renderDialog(() => {});
    await user.click(await screen.findByText("Add to different board"));
    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByRole("option", { name: "Planning Board" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Select Board" })).not.toBeInTheDocument();
  });

  it("sends personId/boardId to boardMember.addToBoard, not the client-generated insert the old code built", async () => {
    const { user } = renderDialog(() => {});
    await user.click(await screen.findByText("Add to different board"));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Planning Board" }));
    await user.click(screen.getByRole("button", { name: /add to board/i }));

    await waitFor(() => expect(stub.countFor("boardMember.addToBoard")).toBe(1));
    const input = stub.calls.find((c) => c.paths.includes("boardMember.addToBoard"))?.inputs[
      "0"
    ] as Record<string, unknown>;
    expect(input).toEqual({ personId: "p1", boardId: "board-2" });
  });

  it("does NOT invalidate trpc.person.pathFilter() when only archiving the membership", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    const onOpenChange = vi.fn();

    const { user } = renderDialog(onOpenChange);
    await user.click(await screen.findByText("Archive board membership"));
    await user.click(screen.getByRole("button", { name: /archive membership/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  });

  it("sends boardMemberId to boardMember.archiveMembership", async () => {
    const { user } = renderDialog(() => {});
    await user.click(await screen.findByText("Archive board membership"));
    await user.click(screen.getByRole("button", { name: /archive membership/i }));

    await waitFor(() => expect(stub.countFor("boardMember.archiveMembership")).toBe(1));
    const input = stub.calls.find((c) => c.paths.includes("boardMember.archiveMembership"))?.inputs[
      "0"
    ] as Record<string, unknown>;
    expect(input).toMatchObject({ boardMemberId: "bm1" });
  });

  it("invalidates trpc.person.pathFilter() when converting to staff", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    await user.click(await screen.findByText("Convert to staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("sends personId/govTitle/permissions to boardMember.convertToStaff", async () => {
    const { user } = renderDialog(vi.fn());
    await user.click(await screen.findByText("Convert to staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(stub.countFor("boardMember.convertToStaff")).toBe(1));
    const input = stub.calls.find((c) => c.paths.includes("boardMember.convertToStaff"))?.inputs[
      "0"
    ] as Record<string, unknown>;
    expect(input).toEqual({
      personId: "p1",
      govTitle: null,
      permissions: { global: {}, board_overrides: [] },
    });
  });

  it("invalidates trpc.boardMember.pathFilter() — the key MemberRoster reads under — even when only archiving the membership", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    await user.click(await screen.findByText("Archive board membership"));
    await user.click(screen.getByRole("button", { name: /archive membership/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.boardMember.pathFilter() when converting to staff", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    await user.click(await screen.findByText("Convert to staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  /**
   * `moveMembership` (`addToBoard`) — the mutation a prior fix report named
   * as previously unexercised by this file (deleting its `pathFilter()` call
   * left the whole web suite green). Adds a NEW seat on the target board, so
   * `boardMember.roster` for BOTH the current board and the target board go
   * stale.
   */
  it("invalidates trpc.boardMember.pathFilter() when moving to a different board", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    await user.click(await screen.findByText("Add to different board"));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Planning Board" }));
    await user.click(screen.getByRole("button", { name: /add to board/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
