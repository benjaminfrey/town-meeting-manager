/**
 * MemberTransitionDialog — cache invalidation only (conventions item 8's
 * "pin the writers, not just the readers"). See `AddMemberDialog.test.tsx`'s
 * own header for the shape of the hole this closes.
 *
 * Only `convertToStaff` invalidates `trpc.person.pathFilter()` — it is the
 * only one of the three mutations here that writes `user_account`.
 * `archiveMembership`/`moveMembership` touch `board_member` only, which
 * `person.list` does not select (see `person.ts`'s own doc comment), so no
 * invalidation is owed there.
 *
 * All three mutations DO invalidate `trpc.boardMember.pathFilter()` (Phase E,
 * wave 2, Task 3) — `MemberRoster.tsx`'s roster read moved onto
 * `boardMember.roster`, and every one of these three writes changes a row
 * that read selects.
 *
 * `member.user_account_id` is `null` in the fixture below so
 * `handleTransitionSelect`'s mutual-exclusivity check does not route through
 * `RoleConflictDialog` — that check only fires when the person already HAS
 * an account, which is exactly the branch `convertToStaff` treats
 * differently (create vs. update) but is not what this file is testing.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
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

/**
 * `otherBoards` (the "move to different board" picker, `boardRows` above)
 * reads `.from("board")` — this row is what lets that radio option render at
 * all, which `moveMembership`'s own pin test needs. Every other `.from(...)`
 * call in this file's mocked Supabase resolves to `{ data: [], error: null,
 * count: 0 }`, matching the original generic mock.
 */
const boardRow = { id: "board-2", name: "Planning Board", election_method: "at_large" };

function genericChain(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    order: () => chain,
    insert: () => chain,
    update: () => chain,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(
        table === "board"
          ? { data: [boardRow], error: null, count: 1 }
          : { data: [], error: null, count: 0 },
      ).then(resolve),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).catch(reject),
  };
  return chain;
}

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({ from: (table: string) => genericChain(table) }),
}));

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

describe("MemberTransitionDialog cache invalidation", () => {
  it("does NOT invalidate trpc.person.pathFilter() when only archiving the membership", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    const onOpenChange = vi.fn();

    const { user } = renderDialog(onOpenChange);
    await user.click(screen.getByText("Archive board membership"));
    await user.click(screen.getByRole("button", { name: /archive membership/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  });

  it("invalidates trpc.person.pathFilter() when converting to staff", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    await user.click(screen.getByText("Convert to staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.boardMember.pathFilter() — the key MemberRoster reads under — even when only archiving the membership", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    await user.click(screen.getByText("Archive board membership"));
    await user.click(screen.getByRole("button", { name: /archive membership/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.boardMember.pathFilter() when converting to staff", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    await user.click(screen.getByText("Convert to staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  /**
   * `moveMembership` — the third of this dialog's three mutations, and the
   * one previously left entirely unexercised by this file (see the fix
   * report: deleting its `trpc.boardMember.pathFilter()` call left the whole
   * web suite green). Adds a NEW seat on `boardRow`, so `boardMember.roster`
   * for BOTH the current board and the target board go stale.
   */
  it("invalidates trpc.boardMember.pathFilter() when moving to a different board", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn());
    // `otherBoards` is async (its own `useQuery`) — the radio option only
    // exists once that resolves.
    await user.click(await screen.findByText("Add to different board"));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Planning Board" }));
    await user.click(screen.getByRole("button", { name: /add to board/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
