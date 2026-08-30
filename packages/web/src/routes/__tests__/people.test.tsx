/**
 * People directory — person + user_account on tRPC.
 *
 * Phase E, wave 1, Task 3. This file used to `vi.mock("@tanstack/react-query",
 * ...)` wholesale, keying a fake `useQuery` off `queryKey[0]`. That mock could
 * not express `person.list`'s real shape or query key, so it could not catch
 * a writer whose `invalidateQueries(trpc.person.pathFilter())` call went
 * missing — see conventions item 8. This file's own last test is that pin for
 * `person.list` itself; `AddPersonDialog.test.tsx`/`EditPersonDialog.test.tsx`/
 * `EditGovTitleDialog.test.tsx` are the writer-side pins for the writes this
 * task converted. `AddMemberDialog`/`MemberArchiveDialog`/
 * `MemberTransitionDialog` also gained a `trpc.person.pathFilter()` call in
 * this same commit (conventions item 7), but have no test file of their own
 * yet, so that addition is unverified by mutation — see the task report.
 *
 * `@/lib/trpc` is NOT mocked. The real client and options proxy run; only
 * `globalThis.fetch` is replaced by `installTRPCFetchStub`. Board memberships
 * still read through `@/lib/supabase` (see `people.tsx`'s own
 * `TODO(phase-e-wave-2)` marker), so that module is mocked too, just enough
 * to resolve.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

// ─── Mock identity + permission ───────────────────────────────────────

const { mockUsePermission } = vi.hoisted(() => ({ mockUsePermission: vi.fn() }));
vi.mock("@/hooks/usePermission", () => ({
  usePermission: (...a: unknown[]) => mockUsePermission(...a),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

// ─── Mock the dialogs (isolate the page) ──────────────────────────────

vi.mock("@/components/members/AddPersonDialog", () => ({
  AddPersonDialog: () => null,
}));
vi.mock("@/components/members/EditPersonDialog", () => ({
  EditPersonDialog: () => null,
}));

// ─── Mock Supabase (only the board-membership read still uses it) ─────

/** Mutable so a test can change what the board-membership "read" returns. */
const server = {
  memberships: [] as Array<{ person_id: string; board: { id: string; name: string } | null }>,
};

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  chain["throwOnError"] = () => Promise.resolve({ data: server.memberships, error: null });
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { supabase: { from: vi.fn().mockReturnValue(chain) } };
});

import PeoplePage from "../people";

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what `person.list` returns. */
const peopleServer = {
  people: [] as RouterOutputs["person"]["list"],
  rejects: false,
};

const stub = installTRPCFetchStub({
  "person.list": () => {
    if (peopleServer.rejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return peopleServer.people;
  },
});

function renderPage() {
  return renderWithProviders(<PeoplePage />, { route: "/people", queryClient });
}

describe("PeoplePage", () => {
  beforeEach(() => {
    mockUsePermission.mockReturnValue({ allowed: true });
    peopleServer.people = [];
    peopleServer.rejects = false;
    server.memberships = [];
  });

  it("lists board members, staff, and account-less people with the right role", async () => {
    peopleServer.people = [
      {
        id: "p1",
        name: "Alice Board",
        email: "alice@t.gov",
        role: null,
        gov_title: null,
      },
      {
        id: "p2",
        name: "Carol Clerk",
        email: "carol@t.gov",
        role: "staff",
        gov_title: "Town Clerk",
      },
      {
        id: "p3",
        name: "Dan Directory",
        email: "dan@t.gov",
        role: null,
        gov_title: null,
      },
    ];
    server.memberships = [{ person_id: "p1", board: { id: "b1", name: "Select Board" } }];

    renderPage();

    // Board member (no account, has a seat)
    expect(await screen.findByText("Alice Board")).toBeInTheDocument();
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
    expect(await screen.findByText("Board member")).toBeInTheDocument();
    // Staff (account, no board) — previously omitted entirely
    expect(await screen.findByText("Carol Clerk")).toBeInTheDocument();
    expect(await screen.findByText("Staff")).toBeInTheDocument();
    // Directory-only (no account, no board) — the new capability
    expect(await screen.findByText("Dan Directory")).toBeInTheDocument();
    expect(await screen.findByText("No role yet")).toBeInTheDocument();
  });

  it("shows Add person for admins (T2)", async () => {
    peopleServer.people = [
      {
        id: "p1",
        name: "Alice",
        email: "a@t.gov",
        role: null,
        gov_title: null,
      },
    ];
    renderPage();
    expect((await screen.findAllByText("Add person")).length).toBeGreaterThanOrEqual(1);
  });

  it("hides Add person without T2 permission", async () => {
    mockUsePermission.mockReturnValue({ allowed: false });
    peopleServer.people = [
      {
        id: "p1",
        name: "Alice",
        email: "a@t.gov",
        role: null,
        gov_title: null,
      },
    ];
    renderPage();
    await screen.findByText("Alice");
    expect(screen.queryByText("Add person")).not.toBeInTheDocument();
  });

  it("shows an error state when person.list rejects, not an empty page", async () => {
    // The failure mode this whole phase exists to end is a screen that
    // renders nothing and says nothing. An error must be visible.
    peopleServer.rejects = true;
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("Something went wrong loading people.")).toBeInTheDocument();
  });

  it("refetches when a writer invalidates trpc.person.pathFilter()", async () => {
    peopleServer.people = [
      {
        id: "p1",
        name: "Alice",
        email: "a@t.gov",
        role: null,
        gov_title: null,
      },
    ];
    renderPage();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    const before = stub.countFor("person.list");

    peopleServer.people = [
      {
        id: "p1",
        name: "Alicia Renamed",
        email: "a@t.gov",
        role: null,
        gov_title: null,
      },
    ];
    await queryClient.invalidateQueries(trpc.person.pathFilter());

    await waitFor(() => expect(stub.countFor("person.list")).toBeGreaterThan(before));
    expect(await screen.findByText("Alicia Renamed")).toBeInTheDocument();
  });
});
