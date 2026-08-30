/**
 * `RoleConflictDialog` — `person.archiveUserAccount` on tRPC.
 *
 * Phase E, wave 2, Task 4. Real options proxy, real `QueryClient` singleton,
 * only `globalThis.fetch` replaced — conventions item 8. This component had
 * no test file at all before this task (the master plan's "measured scope"
 * table counted it at 1 site / 1 write, and it carried no `QueryClient`
 * reference to invalidate anything with).
 *
 * `onError` (review round): this dialog had none before. `archiveUserAccount`
 * does not throw CONFLICT today (see its own doc comment), so the refusal
 * pinned below is `NOT_FOUND` — a real code the procedure DOES answer, for a
 * stale `userAccountId` — and gets the FALLBACK message, not a server one,
 * since `errorMessage`'s gate is CONFLICT-only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { RoleConflictDialog } from "../RoleConflictDialog";

const queryClient = setupAppQueryClient();

const server = { fails: false };

const stub = installTRPCFetchStub({
  "person.archiveUserAccount": (input) => {
    if (server.fails) trpcTestError("NOT_FOUND");
    return { user_account_id: input.userAccountId };
  },
});

beforeEach(() => {
  server.fails = false;
});

function renderDialog(onResolved: () => void, onOpenChange: (open: boolean) => void) {
  return renderWithProviders(
    <RoleConflictDialog
      personName="Jamie Clerk"
      conflict={{ conflict: true, existingRole: "staff", targetRole: "board_member" }}
      userAccountId="ua1"
      open
      onOpenChange={onOpenChange}
      onResolved={onResolved}
    />,
    { queryClient },
  );
}

describe("RoleConflictDialog", () => {
  it("sends the userAccountId to person.archiveUserAccount and calls onResolved", async () => {
    const onResolved = vi.fn();
    const { user } = renderDialog(onResolved, () => {});

    await user.click(screen.getByRole("button", { name: /archive staff account & continue/i }));

    await waitFor(() => expect(stub.countFor("person.archiveUserAccount")).toBe(1));
    const input = stub.calls.find((c) => c.paths.includes("person.archiveUserAccount"))?.inputs[
      "0"
    ] as Record<string, unknown>;
    expect(input).toEqual({ userAccountId: "ua1" });
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
  });

  it("invalidates trpc.person.pathFilter() — person.list's join drops an archived account's role", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn(), vi.fn());
    await user.click(screen.getByRole("button", { name: /archive staff account & continue/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.boardMember.pathFilter() — roster selects user_account_archived_at unconditionally", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog(vi.fn(), vi.fn());
    await user.click(screen.getByRole("button", { name: /archive staff account & continue/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("closes the dialog on success", async () => {
    const onOpenChange = vi.fn();
    const { user } = renderDialog(vi.fn(), onOpenChange);

    await user.click(screen.getByRole("button", { name: /archive staff account & continue/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("toasts an error, does not call onResolved, and leaves the dialog open when the archive is refused", async () => {
    server.fails = true;
    const onResolved = vi.fn();
    const onOpenChange = vi.fn();
    const { user } = renderDialog(onResolved, onOpenChange);

    await user.click(screen.getByRole("button", { name: /archive staff account & continue/i }));

    await waitFor(() => expect(stub.countFor("person.archiveUserAccount")).toBe(1));
    expect(toast.error).toHaveBeenCalledWith("Couldn't archive this account — please try again.");
    expect(onResolved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
