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

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

function genericChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    order: () => chain,
    insert: () => chain,
    update: () => chain,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).catch(reject),
  };
  return chain;
}

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({ from: () => genericChain() }),
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
});
