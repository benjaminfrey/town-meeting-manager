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
 * `installTRPCFetchStub`. `invitation` still writes through `@/lib/supabase`
 * (see `AddPersonDialog.tsx`'s own `TODO(phase-e-wave-2)` marker), so that
 * module is mocked too, just enough to resolve.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
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

// ─── Mock Supabase (only the email-uniqueness check and `invitation` insert
//     still use it — see this file's header) ───────────────────────────

const { insertedTables } = vi.hoisted(() => ({ insertedTables: [] as string[] }));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }), // emailExists → false
        insert: () => {
          insertedTables.push(table);
          return Promise.resolve({ error: null });
        },
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

import { AddPersonDialog } from "../AddPersonDialog";

const queryClient = setupAppQueryClient();

const stub = installTRPCFetchStub({
  "person.insert": (input) => ({ id: "new-person", name: input.name, email: input.email }),
  "person.insertStaffAccount": (input) => ({
    id: "new-account",
    person_id: input.personId,
    gov_title: input.govTitle ?? null,
  }),
});

const props = { townId: "town-1", open: true, onOpenChange: vi.fn() };

function renderDialog() {
  return renderWithProviders(<AddPersonDialog {...props} />, { queryClient });
}

describe("AddPersonDialog", () => {
  beforeEach(() => {
    insertedTables.length = 0;
  });

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
    // The invitation write is still Supabase (see this file's header).
    await waitFor(() => expect(insertedTables).toContain("invitation"));
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
});
