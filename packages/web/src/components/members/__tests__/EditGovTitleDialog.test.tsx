/**
 * EditGovTitleDialog — real transport, real QueryClient, real options proxy.
 *
 * Phase E, wave 1, Task 3. New file — this dialog had no test before.
 * `@/lib/trpc` unmocked; only `globalThis.fetch` replaced via
 * `installTRPCFetchStub`. Verified by mutation: deleting the
 * `trpc.person.pathFilter()` line from `EditGovTitleDialog.tsx`'s
 * `onSuccess` turns the third test below red.
 *
 * Authorization (the FORBIDDEN-for-self-column case the brief calls out) is
 * NOT re-proven here — conventions item 6, "authorization stays in the
 * API's real-Postgres suite" — see `person.test.ts`'s
 * `person.updateGovTitle` describe block for that. This file covers
 * rendering and cache invalidation only.
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";
import { EditGovTitleDialog } from "../EditGovTitleDialog";

const queryClient = setupAppQueryClient();

const stub = installTRPCFetchStub({
  "person.updateGovTitle": (input) => ({
    user_account_id: input.userAccountId,
    gov_title: input.govTitle,
  }),
});

const member = {
  name: "Jamie Clerk",
  user_account_id: "ua-1",
  gov_title: "Deputy Clerk",
  person_id: "p-1",
};

function renderDialog() {
  return renderWithProviders(
    <EditGovTitleDialog member={member} boardId="b1" open onOpenChange={() => {}} />,
    { queryClient },
  );
}

describe("EditGovTitleDialog", () => {
  it("submits the edited title through trpc.person.updateGovTitle", async () => {
    const { user } = renderDialog();
    const input = screen.getByDisplayValue("Deputy Clerk");
    await user.clear(input);
    await user.type(input, "Town Clerk");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(stub.countFor("person.updateGovTitle")).toBe(1));
    expect(stub.calls[0]?.inputs["0"]).toMatchObject({
      userAccountId: "ua-1",
      govTitle: "Town Clerk",
    });
  });

  it("invalidates the legacy members-by-board key", async () => {
    const key = queryKeys.members.byBoard("b1");
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.person.pathFilter() — the key people.tsx reads under", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.boardMember.pathFilter() — the key MemberRoster reads under", async () => {
    const key = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
