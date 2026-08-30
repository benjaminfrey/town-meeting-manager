/**
 * AddMemberDialog — real options proxy, stubbed transport.
 *
 * Phase E, wave 2, Task 3 — the dialog itself was migrated off Supabase onto
 * `boardMember.searchCandidates`/`.personEmailExists`/`.addBoardMember`/
 * `.addStaffMember` and `person.insert`; see `AddMemberDialog.tsx`'s own
 * header. This test file's previous version mocked `@/hooks/useSupabase`
 * generically — the write no longer goes through Supabase at all, so it is
 * rewritten on `installTRPCFetchStub` (conventions item 8) instead.
 *
 * Authorization is not re-proven here — conventions item 6 — see
 * `board-member.test.ts`'s own `addBoardMember`/`addStaffMember` suites for
 * that (including the FK-bypasses-RLS cross-tenant checks).
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useWizardForm", () => ({
  useWizardForm: () => ({
    values: { name: "Jane Doe", email: "jane@example.com" },
    errors: {},
    isValid: true,
    setValue: vi.fn(),
    setValues: vi.fn(),
    handleBlur: vi.fn(),
    validate: () => ({ name: "Jane Doe", email: "jane@example.com" }),
  }),
}));

// StaffAccountFlow → a button that fires onComplete, same shape as
// AddPersonDialog.test.tsx.
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddMemberDialog } from "../AddMemberDialog";

const queryClient = setupAppQueryClient();

const stub = installTRPCFetchStub({
  "boardMember.searchCandidates": () => [],
  "boardMember.personEmailExists": () => false,
  "person.insert": (input) => ({ id: "new-person-1", name: input.name, email: input.email }),
  "boardMember.addBoardMember": () => ({ name: "Jane Doe", invitationId: "inv-1" }),
  "boardMember.addStaffMember": () => ({ name: "Jane Doe", invitationId: "inv-2" }),
});

const props = {
  boardId: "b1",
  boardName: "Select Board",
  electionMethod: "at_large",
  townId: "town-1",
  open: true,
  onOpenChange: vi.fn(),
};

function renderDialog() {
  return renderWithProviders(<AddMemberDialog {...props} />, { queryClient });
}

/** Search (any 2+ chars — the stub returns no matches), then create a new person. */
async function createNewPerson(user: ReturnType<typeof renderDialog>["user"]) {
  await user.type(screen.getByPlaceholderText("Type at least 2 characters..."), "xx");
  await user.click(await screen.findByText("Create New Person"));
  await user.click(screen.getByText("Continue"));
}

describe("AddMemberDialog", () => {
  it("creates the person through person.insert, then seats them via boardMember.addBoardMember", async () => {
    const { user } = renderDialog();
    await createNewPerson(user);
    // `selectedRole` defaults to "board_member" for a newly created person.
    await user.click(screen.getByRole("button", { name: /add board member/i }));

    await waitFor(() => expect(stub.countFor("boardMember.addBoardMember")).toBe(1));
    expect(stub.calls.some((c) => c.paths.includes("person.insert"))).toBe(true);
    const addCall = stub.calls.find((c) => c.paths.includes("boardMember.addBoardMember"));
    const index = addCall!.paths.indexOf("boardMember.addBoardMember");
    expect(addCall!.inputs[String(index)]).toMatchObject({
      personId: "new-person-1",
      boardId: "b1",
    });
  });

  it("creates the person through person.insert, then seats them via boardMember.addStaffMember", async () => {
    const { user } = renderDialog();
    await createNewPerson(user);
    await user.click(screen.getByText("Staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(stub.countFor("boardMember.addStaffMember")).toBe(1));
    const addCall = stub.calls.find((c) => c.paths.includes("boardMember.addStaffMember"));
    const index = addCall!.paths.indexOf("boardMember.addStaffMember");
    expect(addCall!.inputs[String(index)]).toMatchObject({ personId: "new-person-1" });
  });

  it("invalidates trpc.person.pathFilter() and trpc.boardMember.pathFilter() after adding a board member", async () => {
    const personKey = trpc.person.list.queryOptions().queryKey;
    const rosterKey = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(personKey, []);
    queryClient.setQueryData(rosterKey, []);
    expect(queryClient.getQueryState(personKey)?.isInvalidated).toBeFalsy();
    expect(queryClient.getQueryState(rosterKey)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await createNewPerson(user);
    await user.click(screen.getByRole("button", { name: /add board member/i }));

    await waitFor(() => expect(queryClient.getQueryState(personKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(rosterKey)?.isInvalidated).toBe(true);
  });

  it("invalidates trpc.person.pathFilter() and trpc.boardMember.pathFilter() after adding a staff member", async () => {
    const personKey = trpc.person.list.queryOptions().queryKey;
    const rosterKey = trpc.boardMember.roster.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(personKey, []);
    queryClient.setQueryData(rosterKey, []);
    expect(queryClient.getQueryState(personKey)?.isInvalidated).toBeFalsy();
    expect(queryClient.getQueryState(rosterKey)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await createNewPerson(user);
    await user.click(screen.getByText("Staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(queryClient.getQueryState(personKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(rosterKey)?.isInvalidated).toBe(true);
  });
});
