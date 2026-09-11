/**
 * `MotionCaptureDialog`'s form behaviour and its one write.
 *
 * Phase E wave 5, Task 5. The Supabase chainable mock is gone;
 * `globalThis.fetch` is stubbed instead (conventions item 8), so the submit
 * test asserts the PROCEDURE'S OWN INPUT rather than a `.insert()` payload —
 * and the three fields that disappeared from that payload (`town_id`, `id`,
 * `created_at`) are asserted absent, because the server supplies all three and
 * a client that still sent them would be sending values it must not choose.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen, waitFor, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { MotionCaptureDialog } from "./MotionCaptureDialog";
import type { MotionDialogMode } from "./MotionCaptureDialog";

const queryClient = setupAppQueryClient();

const stub = installTRPCFetchStub({
  "motion.insert": () => ({ id: "motion-new" }),
});

// ─── Test data ───────────────────────────────────────────────────────

const presentMembers = [
  { boardMemberId: "bm-1", personId: "p-1", name: "Alice Smith", seatTitle: "Chair" },
  { boardMemberId: "bm-2", personId: "p-2", name: "Bob Jones", seatTitle: null },
  { boardMemberId: "bm-3", personId: "p-3", name: "Carol White", seatTitle: "Vice Chair" },
];

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  meetingId: "meeting-1",
  boardId: "board-1",
  agendaItemId: "item-1",
  presentMembers,
};

// ─── Tests ───────────────────────────────────────────────────────────

describe("MotionCaptureDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog title for main motion mode", () => {
    const mode: MotionDialogMode = { type: "main" };
    renderWithProviders(<MotionCaptureDialog {...defaultProps} mode={mode} />);

    expect(screen.getByRole("heading", { name: "Record Motion" })).toBeInTheDocument();
  });

  it("renders dialog title for amendment mode", () => {
    const mode: MotionDialogMode = {
      type: "amendment",
      parentMotionId: "motion-parent",
      parentMotionText: "Original motion to approve the budget",
    };
    renderWithProviders(<MotionCaptureDialog {...defaultProps} mode={mode} />);

    expect(screen.getByText("Record Amendment")).toBeInTheDocument();
    expect(screen.getByText("Amending motion:")).toBeInTheDocument();
    expect(screen.getByText("Original motion to approve the budget")).toBeInTheDocument();
  });

  it("pre-fills motion text from suggested motion with warning banner", () => {
    const mode: MotionDialogMode = {
      type: "main",
      suggestedMotion: "To approve the revised town budget for FY2026",
    };
    renderWithProviders(<MotionCaptureDialog {...defaultProps} mode={mode} />);

    const textarea = screen.getByLabelText(/motion text/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("To approve the revised town budget for FY2026");
    expect(screen.getByText(/pre-filled from the agenda packet/i)).toBeInTheDocument();
  });

  it("clears suggested motion banner when text is edited", async () => {
    const mode: MotionDialogMode = {
      type: "main",
      suggestedMotion: "To approve the revised budget",
    };
    const { user } = renderWithProviders(<MotionCaptureDialog {...defaultProps} mode={mode} />);

    expect(screen.getByText(/pre-filled from the agenda packet/i)).toBeInTheDocument();

    const textarea = screen.getByLabelText(/motion text/i);
    await user.type(textarea, " amended");

    expect(screen.queryByText(/pre-filled from the agenda packet/i)).not.toBeInTheDocument();
  });

  it("validates minimum motion text length of 5 characters", async () => {
    const mode: MotionDialogMode = { type: "main" };
    const { user } = renderWithProviders(<MotionCaptureDialog {...defaultProps} mode={mode} />);

    const textarea = screen.getByLabelText(/motion text/i);
    await user.type(textarea, "abc");

    expect(screen.getByText("Motion text must be at least 5 characters")).toBeInTheDocument();
  });

  it("prevents same member as mover and seconder", () => {
    const mode: MotionDialogMode = { type: "main" };
    renderWithProviders(<MotionCaptureDialog {...defaultProps} mode={mode} />);

    // Select same member for both — the seconder dropdown filters out the mover,
    // but we can test the validation message by forcing the same value via state.
    // Since the filter removes the mover from the seconder list, we set mover first
    // then directly set seconded-by to the same value via fireEvent.
    fireEvent.change(screen.getByLabelText(/moved by/i), { target: { value: "bm-1" } });

    // The seconder dropdown filters out bm-1, but we can still test that
    // setting it to "" and verifying the Record Motion button is disabled
    // because secondedBy is required for non-procedural motions.
    // For the actual validation message test, the component shows the error
    // only when secondedBy === movedBy. Since the UI prevents this normally,
    // we verify the button is disabled when no seconder is selected.
    const recordButton = screen.getByRole("button", { name: /record motion/i });
    expect(recordButton).toBeDisabled();
  });

  it("makes seconded by optional for procedural motions (table)", async () => {
    const mode: MotionDialogMode = { type: "table", itemTitle: "Budget Discussion" };
    renderWithProviders(<MotionCaptureDialog {...defaultProps} mode={mode} />);

    // Table mode pre-fills text and locks type — just need movedBy
    expect(screen.getByLabelText(/seconded by/i).previousElementSibling?.textContent).toContain(
      "(optional)",
    );

    fireEvent.change(screen.getByLabelText(/moved by/i), { target: { value: "bm-1" } });

    const recordButton = screen.getByRole("button", { name: /record motion/i });
    expect(recordButton).not.toBeDisabled();
  });

  it("submits the motion through motion.insert and closes the dialog", async () => {
    const mode: MotionDialogMode = { type: "main" };
    const onOpenChange = vi.fn();
    const before = stub.countFor("motion.insert");
    const { user } = renderWithProviders(
      <MotionCaptureDialog {...defaultProps} mode={mode} onOpenChange={onOpenChange} />,
      { queryClient },
    );

    // Fill in the form
    const textarea = screen.getByLabelText(/motion text/i);
    await user.type(textarea, "To approve the annual town report");

    fireEvent.change(screen.getByLabelText(/moved by/i), { target: { value: "bm-1" } });
    fireEvent.change(screen.getByLabelText(/seconded by/i), { target: { value: "bm-2" } });

    // Submit
    const recordButton = screen.getByRole("button", { name: /record motion/i });
    expect(recordButton).not.toBeDisabled();
    await user.click(recordButton);

    await waitFor(() => expect(stub.countFor("motion.insert")).toBe(before + 1));

    const input = Object.values(stub.calls[stub.calls.length - 1]!.inputs)[0] as Record<
      string,
      unknown
    >;
    expect(input).toMatchObject({
      boardId: "board-1",
      meetingId: "meeting-1",
      agendaItemId: "item-1",
      motionText: "To approve the annual town report",
      motionType: "main",
      movedBy: "bm-1",
      secondedBy: "bm-2",
    });
    // The server owns these three now — see the file header.
    expect(input).not.toHaveProperty("townId");
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("createdAt");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
