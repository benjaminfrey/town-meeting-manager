/**
 * AddMemberDialog — cache invalidation only (conventions item 8's "pin the
 * writers, not just the readers").
 *
 * Phase E, wave 1, Task 3, fix round. This dialog still writes person/
 * user_account/board_member/invitation directly through Supabase — it is
 * NOT migrated to tRPC by this task. What IS new is that both of its writers
 * (`saveBoardMember`, `saveStaff`) now also invalidate
 * `trpc.person.pathFilter()`, because `people.tsx` reads through `person.list`
 * now and this dialog can create or change the very rows that procedure
 * selects. A reviewer found this addition had shipped with no pin — deleting
 * all four `trpc.person.pathFilter()` calls added across
 * `AddMemberDialog`/`MemberArchiveDialog`/`MemberTransitionDialog` left the
 * whole web suite (295 tests) green. This file, plus the sibling files for
 * the other two dialogs, close that hole.
 *
 * Supabase itself is mocked generically (every `.from(table)` resolves the
 * same empty-but-valid shape) because this file tests invalidation, not the
 * multi-table write sequence — that sequence is unchanged by this task and
 * predates it.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
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

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        is: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: () => chain,
        update: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
        catch: (reject: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).catch(reject),
      };
      return chain;
    },
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

/** Search (any 2+ chars — the mock returns no matches), then create a new person. */
async function createNewPerson(user: ReturnType<typeof renderDialog>["user"]) {
  await user.type(screen.getByPlaceholderText("Type at least 2 characters..."), "xx");
  await user.click(await screen.findByText("Create New Person"));
  await user.click(screen.getByText("Continue"));
}

describe("AddMemberDialog cache invalidation", () => {
  it("invalidates trpc.person.pathFilter() after adding a board member", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await createNewPerson(user);
    // `selectedRole` defaults to "board_member" for a newly created person.
    await user.click(screen.getByRole("button", { name: /add board member/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.person.pathFilter() after adding a staff member", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await createNewPerson(user);
    await user.click(screen.getByText("Staff"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
