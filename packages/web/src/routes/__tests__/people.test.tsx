import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Mock TanStack Query ──────────────────────────────────────────────
const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...(actual as object),
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
    useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
    useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

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

import PeoplePage from "../people";

function mockData({
  persons = [] as Array<Record<string, unknown>>,
  accounts = [] as Array<Record<string, unknown>>,
  memberships = [] as Array<Record<string, unknown>>,
}) {
  mockUseQuery.mockImplementation(
    ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const key = queryKey[0] as string;
      if (key === "persons") return { data: persons, isLoading: false };
      if (key === "userAccounts") return { data: accounts, isLoading: false };
      if (key === "members") return { data: memberships, isLoading: false };
      return { data: [], isLoading: false };
    },
  );
}

describe("PeoplePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePermission.mockReturnValue({ allowed: true });
    mockUseQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it("lists board members, staff, and account-less people with the right role", () => {
    mockData({
      persons: [
        { id: "p1", name: "Alice Board", email: "alice@t.gov" },
        { id: "p2", name: "Carol Clerk", email: "carol@t.gov" },
        { id: "p3", name: "Dan Directory", email: "dan@t.gov" },
      ],
      accounts: [{ person_id: "p2", role: "staff", gov_title: "Town Clerk" }],
      memberships: [
        { person_id: "p1", board: { id: "b1", name: "Select Board" } },
      ],
    });

    render(<PeoplePage />);

    // Board member (no account, has a seat)
    expect(screen.getByText("Alice Board")).toBeInTheDocument();
    expect(screen.getByText("Select Board")).toBeInTheDocument();
    expect(screen.getByText("Board member")).toBeInTheDocument();
    // Staff (account, no board) — previously omitted entirely
    expect(screen.getByText("Carol Clerk")).toBeInTheDocument();
    expect(screen.getByText("Staff")).toBeInTheDocument();
    // Directory-only (no account, no board) — the new capability
    expect(screen.getByText("Dan Directory")).toBeInTheDocument();
    expect(screen.getByText("No role yet")).toBeInTheDocument();
  });

  it("shows Add person for admins (T2)", () => {
    mockData({ persons: [{ id: "p1", name: "Alice", email: "a@t.gov" }] });
    render(<PeoplePage />);
    expect(screen.getAllByText("Add person").length).toBeGreaterThanOrEqual(1);
  });

  it("hides Add person without T2 permission", () => {
    mockUsePermission.mockReturnValue({ allowed: false });
    mockData({ persons: [{ id: "p1", name: "Alice", email: "a@t.gov" }] });
    render(<PeoplePage />);
    expect(screen.queryByText("Add person")).not.toBeInTheDocument();
  });
});
