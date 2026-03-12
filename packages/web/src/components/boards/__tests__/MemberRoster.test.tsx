import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Mock TanStack Query ──────────────────────────────────────────────

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...(actual as object),
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

// ─── Mock Supabase ────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    }),
  },
}));

// ─── Mock child dialogs ──────────────────────────────────────────────

vi.mock("@/components/members/AddMemberDialog", () => ({
  AddMemberDialog: () => null,
}));
vi.mock("@/components/members/MemberArchiveDialog", () => ({
  MemberArchiveDialog: () => null,
}));
vi.mock("@/components/members/MemberTransitionDialog", () => ({
  MemberTransitionDialog: () => null,
}));
vi.mock("@/components/members/EditGovTitleDialog", () => ({
  EditGovTitleDialog: () => null,
}));

// ─── Mock sonner ─────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { MemberRoster } from "../MemberRoster";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeMockData(
  members: Array<{
    id?: string;
    person_id?: string;
    name?: string;
    email?: string;
    status?: string;
    is_default_rec_sec?: boolean;
    seat_title?: string | null;
    term_start?: string | null;
    term_end?: string | null;
    board_id?: string;
  }>,
  userAccounts?: Array<Record<string, unknown>>,
) {
  const defaultUAs =
    userAccounts ??
    members.map((m) => ({
      id: `ua-${m.person_id ?? m.id ?? "p1"}`,
      person_id: m.person_id ?? m.id ?? "p1",
      town_id: "town-1",
      role: "board_member",
      gov_title: null,
    }));

  // board_member rows with embedded person object
  const bmRows = members.map((m) => ({
    id: m.id ?? "bm1",
    person_id: m.person_id ?? m.id ?? "p1",
    board_id: m.board_id ?? "board-1",
    seat_title: m.seat_title ?? null,
    term_start: m.term_start ?? null,
    term_end: m.term_end ?? null,
    status: m.status ?? "active",
    is_default_rec_sec: m.is_default_rec_sec ?? false,
    person: {
      id: m.person_id ?? m.id ?? "p1",
      name: m.name ?? "Test Person",
      email: m.email ?? "test@test.com",
      town_id: "town-1",
    },
  }));

  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0] as string;
    if (key === "members") {
      return { data: bmRows, isLoading: false, isFetching: false, error: undefined };
    }
    if (key === "userAccounts") {
      return { data: defaultUAs, isLoading: false, isFetching: false, error: undefined };
    }
    return { data: [], isLoading: false, isFetching: false, error: undefined };
  });
}

const defaultProps = {
  boardId: "board-1",
  boardName: "Select Board",
  electionMethod: "at_large",
  townId: "town-1",
  isArchived: false,
};

// ─── Tests ───────────────────────────────────────────────────────────

describe("MemberRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: [], isLoading: false, isFetching: false, error: undefined });
  });

  it("renders member names from mock data", () => {
    makeMockData([
      { id: "bm1", person_id: "p1", name: "Alice Johnson" },
      { id: "bm2", person_id: "p2", name: "Bob Smith" },
    ]);

    render(<MemberRoster {...defaultProps} />);

    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
  });

  it("shows Add Member button when board is not archived", () => {
    makeMockData([]);
    render(<MemberRoster {...defaultProps} isArchived={false} />);
    // Empty state renders two Add Member buttons (header + CTA)
    const addButtons = screen.getAllByText("Add Member");
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("hides Add Member button when board is archived", () => {
    makeMockData([]);
    render(<MemberRoster {...defaultProps} isArchived={true} />);
    expect(screen.queryByText("Add Member")).not.toBeInTheDocument();
  });

  it("shows gov_title in parentheses next to name", () => {
    makeMockData(
      [{ id: "bm1", person_id: "p1", name: "Jane Doe" }],
      [
        {
          id: "ua-p1",
          person_id: "p1",
          town_id: "town-1",
          role: "staff",
          gov_title: "Town Clerk",
        },
      ],
    );

    render(<MemberRoster {...defaultProps} />);

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("(Town Clerk)")).toBeInTheDocument();
  });

  it("shows empty state message when no members", () => {
    makeMockData([]);
    render(<MemberRoster {...defaultProps} boardName="Planning Board" />);
    expect(
      screen.getByText(
        "No members added yet. Add your Planning Board members to get started.",
      ),
    ).toBeInTheDocument();
  });

  it("displays active count correctly", () => {
    makeMockData([
      { id: "bm1", person_id: "p1", name: "Alice", status: "active" },
      { id: "bm2", person_id: "p2", name: "Bob", status: "active" },
    ]);

    render(<MemberRoster {...defaultProps} />);

    expect(screen.getByText("2 active members")).toBeInTheDocument();
  });

  it("hides archived members by default", () => {
    makeMockData([
      { id: "bm1", person_id: "p1", name: "Alice Active", status: "active" },
      { id: "bm2", person_id: "p2", name: "Bob Archived", status: "archived" },
    ]);

    render(<MemberRoster {...defaultProps} />);

    expect(screen.getByText("Alice Active")).toBeInTheDocument();
    expect(screen.queryByText("Bob Archived")).not.toBeInTheDocument();
  });
});
