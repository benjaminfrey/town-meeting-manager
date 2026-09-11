/**
 * AddPersonDialog — real transport, real QueryClient, real options proxy.
 *
 * Phase E, wave 1, Task 3. The first version of this file
 * `vi.mock("@tanstack/react-query", ...)` wholesale, so `useMutation` always
 * returned the SAME fake `{ mutate: mockMutate }` object regardless of which
 * call site asked for it — `insertPerson`, `insertStaffAccount`,
 * `createDirectory`, `createStaff` all resolved to one spy, and clicking
 * "Directory only" never ran `createDirectory`'s real `mutationFn` at all.
 * The suite passed the same way with the mutation bodies deleted; see
 * conventions item 8 for why that is exactly the hole this rewrite closes.
 *
 * `@/lib/trpc` is NOT mocked — see `boards.$boardId.test.tsx` for the
 * pattern this copies. Only `globalThis.fetch` is replaced, by
 * `installTRPCFetchStub`. `invitation` moved onto `trpc.invitation.insert` in
 * Phase E wave 4, Task 0 — stubbed below like `person.insert`/
 * `person.insertStaffAccount`. `@/lib/supabase` is still mocked, narrowly:
 * only the live email-uniqueness check reads through it now.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

// ─── Mock the form to be valid with fixed values ──────────────────────

vi.mock("@/hooks/useWizardForm", () => ({
  useWizardForm: () => ({
    values: { name: "Jane Doe", email: "jane@example.com" },
    errors: {},
    isValid: true,
    setValue: vi.fn(),
    setValues: vi.fn(),
    handleBlur: vi.fn(),
    validate: vi.fn(),
  }),
}));

// ─── Mock Supabase (only the email-uniqueness check still uses it) ─────

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }), // emailExists → false
      };
      return chain;
    },
  }),
}));

// StaffAccountFlow → a button that fires onComplete
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

import { toast } from "sonner";
import { AddPersonDialog } from "../AddPersonDialog";

const queryClient = setupAppQueryClient();

/**
 * Mutable so a test can make a given call FORBIDDEN without a fresh stub.
 * Phase E wave 4 fix round (LOW-3): before this, neither `person.insert`
 * (directory-only path, `AddPersonDialog.tsx:105`'s `onError`) nor
 * `person.insertStaffAccount`/`invitation.insert` (staff path, `:153`'s
 * `onError`) could ever answer FORBIDDEN — the pre-migration code raw-inserted
 * with no check at all. Both are real tRPC procedures with real admin gates
 * now, so both refusals are reachable, and neither had a test.
 */
const server = { personInsertRejects: false, staffAccountRejects: false };

const stub = installTRPCFetchStub({
  "person.insert": (input) => {
    if (server.personInsertRejects) trpcTestError("FORBIDDEN");
    return { id: "new-person", name: input.name, email: input.email };
  },
  "person.insertStaffAccount": (input) => {
    if (server.staffAccountRejects) trpcTestError("FORBIDDEN");
    return {
      id: "new-account",
      person_id: input.personId,
      gov_title: input.govTitle ?? null,
    };
  },
  "invitation.insert": () => ({ id: "new-invitation" }),
});

const props = { townId: "town-1", open: true, onOpenChange: vi.fn() };

function renderDialog() {
  return renderWithProviders(<AddPersonDialog {...props} />, { queryClient });
}

describe("AddPersonDialog", () => {
  it("step 1 collects name + email", () => {
    renderDialog();
    expect(screen.getByText("Add person")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeInTheDocument();
  });

  it("Continue reveals the Directory-only / Staff-account choice", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByText("Continue"));
    expect(screen.getByText("Directory only")).toBeInTheDocument();
    expect(screen.getByText("Staff account")).toBeInTheDocument();
  });

  it("creates a directory-only person through trpc.person.insert", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByText("Continue"));
    await user.click(screen.getByText("Directory only"));

    await waitFor(() => expect(stub.countFor("person.insert")).toBe(1));
    expect(stub.calls[0]?.inputs["0"]).toMatchObject({
      name: "Jane Doe",
      email: "jane@example.com",
    });
  });

  it("invalidates trpc.person.pathFilter() after creating a directory-only person", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await user.click(screen.getByText("Continue"));
    await user.click(screen.getByText("Directory only"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("creates a staff person via StaffAccountFlow, through insert then insertStaffAccount", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByText("Continue"));
    await user.click(screen.getByText("Staff account"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(stub.countFor("person.insertStaffAccount")).toBe(1));
    expect(stub.calls.some((c) => c.paths.includes("person.insert"))).toBe(true);
    await waitFor(() => expect(stub.countFor("invitation.insert")).toBe(1));
    const invitationCall = stub.calls.find((c) => c.paths.includes("invitation.insert"));
    expect(invitationCall?.inputs["0"]).toMatchObject({
      personId: "new-person",
      userAccountId: "new-account",
    });
  });

  it("invalidates trpc.person.pathFilter() after creating a staff account", async () => {
    const key = trpc.person.list.queryOptions().queryKey;
    queryClient.setQueryData(key, []);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();
    await user.click(screen.getByText("Continue"));
    await user.click(screen.getByText("Staff account"));
    await user.click(screen.getByText("finish-staff"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  /**
   * Regression pin for LOW-3 (whole-branch review, wave 4): `person.insert`
   * was newly reachable through a real admin gate with no test asserting
   * `AddPersonDialog.tsx:105`'s `onError` toast fires. Deleting that
   * `onError` handler (or its `toast.error` call) turns this test red alone.
   */
  it("shows a refusal toast when person.insert answers FORBIDDEN (directory-only path)", async () => {
    server.personInsertRejects = true;
    try {
      const { user } = renderDialog();
      await user.click(screen.getByText("Continue"));
      await user.click(screen.getByText("Directory only"));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Couldn't add the person — please try again."),
      );
    } finally {
      server.personInsertRejects = false;
    }
  });

  /**
   * Regression pin for LOW-3, the staff-path twin: `person.insertStaffAccount`
   * (and `invitation.insert` alongside it) fall under `AddPersonDialog.tsx:153`'s
   * `onError`, also newly reachable and also untested before this. Deleting
   * that `onError` handler (or its `toast.error` call) turns this test red
   * alone.
   */
  it("shows a refusal toast when person.insertStaffAccount answers FORBIDDEN (staff path)", async () => {
    server.staffAccountRejects = true;
    try {
      const { user } = renderDialog();
      await user.click(screen.getByText("Continue"));
      await user.click(screen.getByText("Staff account"));
      await user.click(screen.getByText("finish-staff"));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "Couldn't create the staff account — please try again.",
        ),
      );
    } finally {
      server.staffAccountRejects = false;
    }
  });
});
