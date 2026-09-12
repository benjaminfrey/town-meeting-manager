/**
 * EditPersonDialog — real transport, real QueryClient, real options proxy.
 *
 * Phase E, wave 1, Task 3. New file — this dialog had no test before. Same
 * shape as `TownSettingsEditor.test.tsx`/`ArchiveBoardDialog.test.tsx`:
 * `@/lib/trpc` unmocked, only `globalThis.fetch` replaced via
 * `installTRPCFetchStub`. Verified by mutation: deleting either
 * `queryClient.invalidateQueries(...)` line from `EditPersonDialog.tsx`'s
 * `onSuccess` turns the matching test below red.
 *
 * Wave 6, Task 5: the narrow `@/hooks/useSupabase` mock for the
 * email-uniqueness check is gone — that read is `trpc.person.emailExists`, and
 * it is the reason that procedure grew an `excludePersonId` argument.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc, type RouterInputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EditPersonDialog } from "../EditPersonDialog";

const queryClient = setupAppQueryClient();

// CONFLICT is not one of `TestErrorCode`'s codes (see `test/trpc.ts`'s own
// list), so the dialog's CONFLICT-specific message branch is not exercised
// here. Covered instead at the API layer, where the real constraint fires —
// `person.test.ts`'s "answers CONFLICT when renaming..." case.
const server = { emailTaken: false };
const received: { emailExists?: RouterInputs["person"]["emailExists"] } = {};

const stub = installTRPCFetchStub({
  "person.emailExists": (input) => {
    received.emailExists = input;
    return server.emailTaken;
  },
  "person.update": (input) => ({ id: input.personId, name: input.name, email: input.email }),
});

const person = { id: "p1", name: "Original Name", email: "original@example.test" };

function renderDialog() {
  return renderWithProviders(
    <EditPersonDialog person={person} townId="town-1" open onOpenChange={() => {}} />,
    { queryClient },
  );
}

describe("EditPersonDialog", () => {
  beforeEach(() => {
    server.emailTaken = false;
    received.emailExists = undefined;
  });

  it("submits the edited name and email through trpc.person.update", async () => {
    const { user } = renderDialog();
    const nameInput = screen.getByDisplayValue("Original Name");
    await user.clear(nameInput);
    await user.type(nameInput, "New Name");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(stub.countFor("person.update")).toBe(1));
    expect(stub.calls[0]?.inputs["0"]).toMatchObject({ personId: "p1", name: "New Name" });
  });

  it("invalidates the legacy persons-by-town key and trpc.person.pathFilter()", async () => {
    const legacyKey = queryKeys.persons.byTown("town-1");
    const trpcKey = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(legacyKey, []);
    queryClient.setQueryData(trpcKey, []);
    expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();
    expect(queryClient.getQueryState(trpcKey)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
    await waitFor(() => expect(queryClient.getQueryState(trpcKey)?.isInvalidated).toBe(true));
  });

  it("excludes the person's own id when checking a changed email", async () => {
    // Wave 6, Task 5 — the file's last raw Supabase call, unmarked. The
    // `.neq("id", person.id)` it replaces is now `excludePersonId`, without
    // which editing anything else about a person would report their OWN email
    // as taken the moment the check ran.
    const { user } = renderDialog();
    const emailInput = screen.getByDisplayValue("original@example.test");
    await user.clear(emailInput);
    await user.type(emailInput, "new@example.test");

    await waitFor(() => expect(stub.countFor("person.emailExists")).toBeGreaterThan(0));
    expect(received.emailExists).toEqual({
      email: "new@example.test",
      excludePersonId: "p1",
    });
  });

  it("blocks the save when another person already uses the email", async () => {
    server.emailTaken = true;
    const { user } = renderDialog();
    const emailInput = screen.getByDisplayValue("original@example.test");
    await user.clear(emailInput);
    await user.type(emailInput, "taken@example.test");

    expect(await screen.findByText(/another person already uses this email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});
