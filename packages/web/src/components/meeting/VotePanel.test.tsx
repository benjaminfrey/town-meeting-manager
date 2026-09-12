/**
 * `VotePanel`'s rendering and tally, plus the one write it performs.
 *
 * Phase E wave 5, Task 5. The Supabase chainable mock this file used to carry
 * is gone: `globalThis.fetch` is stubbed instead (conventions item 8), so the
 * write assertion is about the PROCEDURE the panel calls and the payload it
 * sends, not about which chain methods a mock happened to see. The tally tests
 * are unchanged — `calculateVoteResult` still runs here for the live preview,
 * and it is the SERVER that recomputes the outcome from the roll.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor, setupAppQueryClient } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { VotePanel } from "./VotePanel";

// ─── Supabase chainable mock ──────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

const server = { refuses: false };

const stub = installTRPCFetchStub({
  "voteRecord.recordForMotion": ({ motionId, votes }) => {
    if (server.refuses) trpcTestError("FORBIDDEN");
    return {
      motionId,
      status: "passed",
      recorded: votes.length,
      executiveSession: null,
      minutesApproved: null,
      adjourned: false,
    };
  },
});

// ─── Mock data ─────────────────────────────────────────────────────

const allMembers = [
  { boardMemberId: "bm-1", personId: "p-1", name: "Alice Smith", seatTitle: "Chair" },
  { boardMemberId: "bm-2", personId: "p-2", name: "Bob Jones", seatTitle: null },
  { boardMemberId: "bm-3", personId: "p-3", name: "Carol White", seatTitle: "Vice Chair" },
  { boardMemberId: "bm-4", personId: "p-4", name: "Dave Brown", seatTitle: null },
  { boardMemberId: "bm-5", personId: "p-5", name: "Eve Green", seatTitle: null },
];

const attendanceRow = (id: string, boardMemberId: string, personId: string, status: string) => ({
  id,
  board_member_id: boardMemberId,
  person_id: personId,
  status,
  arrived_at: null,
  departed_at: null,
  is_recording_secretary: false,
});

const attendancePresent = [
  attendanceRow("att-1", "bm-1", "p-1", "present"),
  attendanceRow("att-2", "bm-2", "p-2", "present"),
  attendanceRow("att-3", "bm-3", "p-3", "present"),
  attendanceRow("att-4", "bm-4", "p-4", "absent"),
  attendanceRow("att-5", "bm-5", "p-5", "present"),
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
  boardId: "board-1",
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
    server.refuses = false;
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
      {
        id: "v-1",
        motion_id: "motion-1",
        board_member_id: "bm-3",
        vote: "recusal",
        recusal_reason: "Conflict of interest",
        created_at: "2026-03-10T19:00:00Z",
      },
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

  it("records the whole roll in ONE call, including the absent seat", async () => {
    const before = stub.countFor("voteRecord.recordForMotion");
    renderWithProviders(<VotePanel {...defaultProps} />, { queryClient });

    // Vote all eligible members
    clickVoteButton("Yea", 0); // Alice
    clickVoteButton("Yea", 1); // Bob
    clickVoteButton("Nay", 2); // Carol
    clickVoteButton("Yea", 3); // Eve

    // Click Record Vote
    const recordButton = screen.getByRole("button", { name: "Record Vote" });
    fireEvent.click(recordButton);

    await waitFor(() => expect(stub.countFor("voteRecord.recordForMotion")).toBe(before + 1));

    // One request, not `1 + N + 1`. And the roll names every seat — Dave is
    // absent and is recorded as such, exactly as the sequential inserts did.
    const call = stub.calls[stub.calls.length - 1]!;
    const input = Object.values(call.inputs)[0] as {
      votes: { boardMemberId: string; vote: string }[];
    };
    expect(input.votes).toHaveLength(5);
    expect(input.votes).toContainEqual({
      boardMemberId: "bm-4",
      vote: "absent",
      recusalReason: null,
    });
    // Nothing about the OUTCOME is sent; the server derives it.
    expect(call.inputs).not.toHaveProperty("status");
  });

  it("shows a refusal when recording the vote is FORBIDDEN", async () => {
    server.refuses = true;
    renderWithProviders(<VotePanel {...defaultProps} />, { queryClient });

    voteAllEligible("Yea", 4);
    fireEvent.click(screen.getByRole("button", { name: "Record Vote" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to record the votes on this motion/i);
  });

  it("calls onComplete after successful vote recording", async () => {
    const onComplete = vi.fn();
    renderWithProviders(<VotePanel {...defaultProps} onComplete={onComplete} />, { queryClient });

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
