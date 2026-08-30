/**
 * `MemberArchiveDialog` — `boardMember.otherActiveCount` and
 * `boardMember.archiveMembership` on tRPC.
 *
 * Phase E, wave 2, Task 4. Real options proxy, real `QueryClient` singleton,
 * only `globalThis.fetch` replaced — conventions item 8, "mock the transport,
 * not the proxy". The prior version of this file mocked `@/hooks/useSupabase`
 * wholesale and could only pin the invalidation calls (the component's writes
 * were still raw Supabase); this version exercises the real writes too.
 *
 * `trpc.person.pathFilter()` only fires on the branch that actually archives
 * the `user_account` (the "archive account" switch, on, with no other active
 * memberships) — archiving only the board seat does not touch `person`/
 * `user_account`, which is all `person.list` selects. Both branches are
 * covered below so the conditional itself is exercised, not just the happy
 * path.
 *
 * `trpc.boardMember.pathFilter()` fires UNCONDITIONALLY — `MemberRoster.tsx`'s
 * roster read lives under that key, and even the "board seat only" branch
 * changes that read's own `status` column for this row. Verified by mutation:
 * deleting that `invalidateQueries(trpc.boardMember.pathFilter())` line from
 * `MemberArchiveDialog.tsx` turns the relevant test below red.
 *
 * `onSuccess` reads the server's own `{ archivedAccount }` answer, not the
 * client's request — "invalidates trpc.person.pathFilter() only when the
 * SERVER actually archived the account" below is what pins that: the stub
 * answers `archivedAccount: false` even though the client asked for `true`,
 * and the test asserts NO invalidation. Verified by mutation: reverting the
 * component to branch on the client's `willArchiveAccount` guess instead
 * turns this test red.
 *
 * `onError` (review round): a designed `CONFLICT` must reach a toast, not be
 * swallowed. `archiveMembership` does not throw one today, so this file uses
 * `NOT_FOUND` (a real code the procedure DOES answer, for a stale
 * `boardMemberId`) to exercise the branch — the fallback message, not a
 * server-supplied one, since `errorMessage`'s gate is CONFLICT-only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
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

/** Mutable so a test can change what the server reports between renders. */
const server = {
  otherActiveCount: 0,
  archivedAccountOverride: null as boolean | null,
  fails: false,
};

const stub = installTRPCFetchStub({
  "boardMember.otherActiveCount": () => server.otherActiveCount,
  "boardMember.archiveMembership": (input) => {
    if (server.fails) trpcTestError("NOT_FOUND");
    return {
      archivedAccount:
        server.archivedAccountOverride ?? (!!input.archiveAccount && server.otherActiveCount === 0),
    };
  },
});

beforeEach(() => {
  server.archivedAccountOverride = null;
  server.fails = false;
});

function renderDialog(onOpenChange: () => void) {
  return renderWithProviders(
    <MemberArchiveDialog member={member} boardId="b1" open onOpenChange={onOpenChange} />,
    { queryClient },
  );
}

describe("MemberArchiveDialog", () => {
  it("shows the 'also archive account' toggle when there are no other active memberships", async () => {
    server.otherActiveCount = 0;
    renderDialog(() => {});
    expect(
      await screen.findByRole("switch", { name: /also archive user account/i }),
    ).toBeInTheDocument();
  });

  it("hides the toggle, and shows the 'will remain active' note, when other active memberships exist", async () => {
    server.otherActiveCount = 2;
    renderDialog(() => {});
    await screen.findByText(/2 other active board memberships/i);
    expect(
      screen.queryByRole("switch", { name: /also archive user account/i }),
    ).not.toBeInTheDocument();
  });

  it("archives only the seat when the toggle is off, sending archiveAccount: false", async () => {
    server.otherActiveCount = 0;
    const onOpenChange = () => {};
    const { user } = renderDialog(onOpenChange);

    await user.click(await screen.findByRole("button", { name: /archive member/i }));
    await waitFor(() => expect(stub.countFor("boardMember.archiveMembership")).toBe(1));

    const input = stub.calls.find((c) => c.paths.includes("boardMember.archiveMembership"))?.inputs[
      "0"
    ] as Record<string, unknown>;
    expect(input).toMatchObject({ boardMemberId: "bm1", archiveAccount: false });
  });

  it("sends archiveAccount: true when the toggle is switched on", async () => {
    server.otherActiveCount = 0;
    const { user } = renderDialog(() => {});

    await user.click(await screen.findByRole("switch", { name: /also archive user account/i }));
    await user.click(screen.getByRole("button", { name: /archive member/i }));
    await waitFor(() => expect(stub.countFor("boardMember.archiveMembership")).toBe(1));

    const input = stub.calls.find((c) => c.paths.includes("boardMember.archiveMembership"))?.inputs[
      "0"
    ] as Record<string, unknown>;
    expect(input).toMatchObject({ boardMemberId: "bm1", archiveAccount: true });
  });

  it("does NOT invalidate trpc.person.pathFilter() when only the board seat is archived", async () => {
    server.otherActiveCount = 0;
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    const onOpenChange = vi.fn();
    const { user } = renderDialog(onOpenChange);

    await user.click(await screen.findByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  });

  it("invalidates trpc.person.pathFilter() when the user account is also archived", async () => {
    server.otherActiveCount = 0;
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
    const { user } = renderDialog(() => {});

    await user.click(await screen.findByRole("switch", { name: /also archive user account/i }));
    await user.click(screen.getByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.boardMember.pathFilter() — the key MemberRoster reads under — even when only the seat is archived", async () => {
    server.otherActiveCount = 0;
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
    const { user } = renderDialog(() => {});

    await user.click(await screen.findByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("does NOT invalidate trpc.person.pathFilter() when the server declines to archive the account, even though the client asked", async () => {
    server.otherActiveCount = 0;
    server.archivedAccountOverride = false; // the server's real answer, disagreeing with the request
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    const { user } = renderDialog(() => {});

    await user.click(await screen.findByRole("switch", { name: /also archive user account/i }));
    await user.click(screen.getByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(stub.countFor("boardMember.archiveMembership")).toBe(1));
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  });

  it("toasts an error and leaves the dialog open when archiveMembership is refused", async () => {
    server.otherActiveCount = 0;
    server.fails = true;
    const onOpenChange = vi.fn();
    const { user } = renderDialog(onOpenChange);

    await user.click(await screen.findByRole("button", { name: /archive member/i }));

    await waitFor(() => expect(stub.countFor("boardMember.archiveMembership")).toBe(1));
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't archive this membership — please try again.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
