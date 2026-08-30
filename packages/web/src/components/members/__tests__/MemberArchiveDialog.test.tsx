/**
 * MemberArchiveDialog — cache invalidation only (conventions item 8's "pin
 * the writers, not just the readers"). See `AddMemberDialog.test.tsx`'s own
 * header for the shape of the hole this closes.
 *
 * `trpc.person.pathFilter()` only fires on the branch that actually archives
 * the `user_account` (the "archive account" switch, on, with no other active
 * memberships) — archiving only the board seat does not touch `person`/
 * `user_account`, which is all `person.list` selects. Both branches are
 * covered below so the conditional itself is exercised, not just the happy
 * path.
 *
 * `trpc.boardMember.pathFilter()` (Phase E, wave 2, Task 3) fires
 * UNCONDITIONALLY — `MemberRoster.tsx`'s roster read now lives under that
 * key, and even the "board seat only" branch changes what it returns (the
 * seat's own `status`). Verified by mutation: deleting that
 * `invalidateQueries(trpc.boardMember.pathFilter())` line from
 * `MemberArchiveDialog.tsx` turns the new test below red.
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

import { MemberArchiveDialog } from "../MemberArchiveDialog";

const queryClient = setupAppQueryClient();

const member = {
  id: "bm1",
  person_id: "p1",
  name: "Jamie Clerk",
  user_account_id: "ua1",
  role: "board_member",
  gov_title: null,
};

function renderDialog(onOpenChange: () => void) {
  return renderWithProviders(
    <MemberArchiveDialog
      member={member}
      boardId="b1"
      townId="town-1"
      open
      onOpenChange={onOpenChange}
    />,
    { queryClient },
  );
}

describe("MemberArchiveDialog cache invalidation", () => {
  it("does NOT invalidate trpc.person.pathFilter() when only the board seat is archived", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    const onOpenChange = vi.fn();

    const { user } = renderDialog(onOpenChange);
    // "Also archive user account" switch defaults to off.
    await user.click(screen.getByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  });

  it("invalidates trpc.person.pathFilter() when the user account is also archived", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
    const onOpenChange = vi.fn();

    const { user } = renderDialog(onOpenChange);
    await user.click(screen.getByRole("switch", { name: /also archive user account/i }));
    await user.click(screen.getByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.boardMember.pathFilter() — the key MemberRoster reads under — even when only the seat is archived", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
    const onOpenChange = vi.fn();

    const { user } = renderDialog(onOpenChange);
    // "Also archive user account" switch stays off — the seat-only branch.
    await user.click(screen.getByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
