import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { VotePanel } from "./VotePanel";

// ─── Supabase chainable mock ──────────────────────────────────────────────────

const { mockChain, mockFrom } = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  chain['then'] = (resolve: any, reject?: any) =>
    Promise.resolve({ data: null, error: null }).then(resolve, reject);
  chain['catch'] = (reject: any) =>
    Promise.resolve({ data: null, error: null }).catch(reject as any);
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'gte', 'lte', 'order', 'limit',
    'single', 'maybeSingle', 'throwOnError', 'or', 'filter',
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  const mockFrom = vi.fn().mockReturnValue(chain);
  return { mockChain: chain as Record<string, ReturnType<typeof vi.fn>>, mockFrom };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

// ─── Mock data ─────────────────────────────────────────────────────

const allMembers = [
  { boardMemberId: "bm-1", personId: "p-1", name: "Alice Smith", seatTitle: "Chair" },
  { boardMemberId: "bm-2", personId: "p-2", name: "Bob Jones", seatTitle: null },
  { boardMemberId: "bm-3", personId: "p-3", name: "Carol White", seatTitle: "Vice Chair" },
  { boardMemberId: "bm-4", personId: "p-4", name: "Dave Brown", seatTitle: null },
  { boardMemberId: "bm-5", personId: "p-5", name: "Eve Green", seatTitle: null },
];

const attendancePresent = [
  { id: "att-1", board_member_id: "bm-1", person_id: "p-1", status: "present" },
  { id: "att-2", board_member_id: "bm-2", person_id: "p-2", status: "present" },
  { id: "att-3", board_member_id: "bm-3", person_id: "p-3", status: "present" },
  { id: "att-4", board_member_id: "bm-4", person_id: "p-4", status: "absent" },
  { id: "att-5", board_member_id: "bm-5", person_id: "p-5", status: "present" },
];

const memberNameMap = new Map([
  ["bm-1", "Alice Smith"],
  ["bm-2", "Bob Jones"],
  ["bm-3", "Carol White"],
  ["bm-4", "Dave Brown"],
  ["bm-5", "Eve Green"],
]);

const defaultProps = {
  motionId: "motion-1",
  meetingId: "meeting-1",
  townId: "town-1",
  allMembers,
  attendanceRecords: attendancePresent,
  existingVotes: [] as any[],
  boardQuorumConfig: { quorumType: "simple_majority", quorumValue: null, memberCount: 5 },
  memberNameMap,
  onComplete: vi.fn(),
};

// ─── Helpers ───────────────────────────────────────────────────────

/** Click a vote button (Yea/Nay/Abstain) for a specific eligible member by index (alphabetical order, absent excluded). */
function clickVoteButton(label: "Yea" | "Nay" | "Abstain", eligibleIndex: number) {
  const buttons = screen.getAllByRole("button", { name: label });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  fireEvent.click(buttons[eligibleIndex]!);
}

/** Vote all eligible members with a specific vote. */
function voteAllEligible(label: "Yea" | "Nay" | "Abstain", count: number) {
  for (let i = 0; i < count; i++) {
    clickVoteButton(label, i);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("VotePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore chainable mock after clear
    mockFrom.mockReturnValue(mockChain);
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'order', 'limit', 'single', 'throwOnError', 'or', 'filter', 'upsert', 'in', 'maybeSingle']) {
      if (typeof mockChain[m]?.mockReturnValue === 'function') {
        mockChain[m].mockReturnValue(mockChain);
      }
    }
  });

  it("renders all members with correct attendance status", () => {
    renderWithProviders(<VotePanel {...defaultProps} />);

    // All member names should be visible
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText("Carol White")).toBeInTheDocument();
    expect(screen.getByText("Dave Brown")).toBeInTheDocument();
    expect(screen.getByText("Eve Green")).toBeInTheDocument();

    // Absent member shows "Absent" badge
    expect(screen.getByText("Absent")).toBeInTheDocument();

    // Present members have vote buttons — 4 present members x 3 buttons each = 12
    const yeaButtons = screen.getAllByRole("button", { name: "Yea" });
    expect(yeaButtons).toHaveLength(4);

    const nayButtons = screen.getAllByRole("button", { name: "Nay" });
    expect(nayButtons).toHaveLength(4);

    const abstainButtons = screen.getAllByRole("button", { name: "Abstain" });
    expect(abstainButtons).toHaveLength(4);
  });

  it("shows recused badge for recused members", () => {
    const existingVotes = [
      { id: "v-1", motion_id: "motion-1", board_member_id: "bm-3", vote: "recusal", recusal_reason: "Conflict of interest" },
    ];

    renderWithProviders(<VotePanel {...defaultProps} existingVotes={existingVotes} />);

    // Carol White should show "Recused" badge
    expect(screen.getByText("Recused")).toBeInTheDocument();

    // Only 3 eligible members now (Alice, Bob, Eve) — 3 Yea buttons
    const yeaButtons = screen.getAllByRole("button", { name: "Yea" });
    expect(yeaButtons).toHaveLength(3);
  });

  it("tracks vote count as members vote", () => {
    renderWithProviders(<VotePanel {...defaultProps} />);

    // Initially "0 of 4 voted"
    expect(screen.getByText("0 of 4 voted")).toBeInTheDocument();

    // Click Yea for first eligible member (Alice, index 0)
    clickVoteButton("Yea", 0);

    expect(screen.getByText("1 of 4 voted")).toBeInTheDocument();
  });

  it("enables Record Vote only when all eligible members have voted", () => {
    renderWithProviders(<VotePanel {...defaultProps} />);

    const recordButton = screen.getByRole("button", { name: "Record Vote" });

    // Initially disabled
    expect(recordButton).toBeDisabled();

    // Vote for 3 of 4 eligible members
    clickVoteButton("Yea", 0); // Alice
    clickVoteButton("Nay", 1); // Bob
    clickVoteButton("Yea", 2); // Carol

    // Still disabled — Eve hasn't voted
    expect(recordButton).toBeDisabled();

    // Vote for last eligible member
    clickVoteButton("Abstain", 3); // Eve

    // Now enabled
    expect(recordButton).toBeEnabled();
  });

  it("displays running tally", () => {
    renderWithProviders(<VotePanel {...defaultProps} />);

    // Initial tally should show zeros
    expect(screen.getByText("Yea: 0")).toBeInTheDocument();
    expect(screen.getByText("Nay: 0")).toBeInTheDocument();
    expect(screen.getByText("Abstain: 0")).toBeInTheDocument();

    // Cast some votes
    clickVoteButton("Yea", 0); // Alice
    clickVoteButton("Nay", 1); // Bob
    clickVoteButton("Yea", 2); // Carol

    expect(screen.getByText("Yea: 2")).toBeInTheDocument();
    expect(screen.getByText("Nay: 1")).toBeInTheDocument();
    expect(screen.getByText("Abstain: 0")).toBeInTheDocument();
  });

  it("shows result preview when all members have voted", () => {
    renderWithProviders(<VotePanel {...defaultProps} />);

    // No result preview initially
    expect(screen.queryByText(/Passed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed/)).not.toBeInTheDocument();

    // Vote all eligible: 3 Yea, 1 Nay
    clickVoteButton("Yea", 0); // Alice
    clickVoteButton("Yea", 1); // Bob
    clickVoteButton("Yea", 2); // Carol
    clickVoteButton("Nay", 3); // Eve

    // Result preview should show "Passed 3-1"
    expect(screen.getByText("Passed 3-1")).toBeInTheDocument();
  });

  it("records votes via Supabase sequential inserts", async () => {
    renderWithProviders(<VotePanel {...defaultProps} />);

    // Vote all eligible members
    clickVoteButton("Yea", 0); // Alice
    clickVoteButton("Yea", 1); // Bob
    clickVoteButton("Nay", 2); // Carol
    clickVoteButton("Yea", 3); // Eve

    // Click Record Vote
    const recordButton = screen.getByRole("button", { name: "Record Vote" });
    fireEvent.click(recordButton);

    await waitFor(() => {
      // delete old vote records, then insert new ones
      expect(mockFrom).toHaveBeenCalledWith("vote_record");
      expect(mockChain.delete).toHaveBeenCalled();
      expect(mockChain.insert).toHaveBeenCalled();
    });
  });

  it("calls onComplete after successful vote recording", async () => {
    const onComplete = vi.fn();
    renderWithProviders(<VotePanel {...defaultProps} onComplete={onComplete} />);

    // Vote all eligible members
    clickVoteButton("Yea", 0); // Alice
    clickVoteButton("Nay", 1); // Bob
    clickVoteButton("Yea", 2); // Carol
    clickVoteButton("Yea", 3); // Eve

    // Click Record Vote
    const recordButton = screen.getByRole("button", { name: "Record Vote" });
    fireEvent.click(recordButton);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it("handles unanimous vote correctly", () => {
    renderWithProviders(<VotePanel {...defaultProps} />);

    // All eligible members vote Yea
    voteAllEligible("Yea", 4);

    // Should show "Passed unanimously"
    expect(screen.getByText("Passed unanimously")).toBeInTheDocument();
  });
});
