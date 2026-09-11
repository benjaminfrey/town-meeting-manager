import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent, within } from "@testing-library/react";
import { AdjournmentControls } from "./AdjournmentControls";
import { AdjournWithoutObjectionDialog } from "./AdjournWithoutObjectionDialog";

// ─── AdjournmentControls ────────────────────────────────────────────

describe("AdjournmentControls", () => {
  const defaultProps = {
    presidingOfficerName: "Jane Doe",
    onAdjournMotion: vi.fn(),
    onAdjournWithoutObjection: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Adjourn Meeting dropdown button", () => {
    renderWithProviders(<AdjournmentControls {...defaultProps} />);
    expect(screen.getByRole("button", { name: /adjourn meeting/i })).toBeInTheDocument();
  });

  it("shows dropdown options when clicked", async () => {
    const { user } = renderWithProviders(<AdjournmentControls {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /adjourn meeting/i }));

    await waitFor(() => {
      expect(screen.getByText(/motion to adjourn/i)).toBeInTheDocument();
      expect(screen.getByText(/adjourn without objection/i)).toBeInTheDocument();
    });
  });

  it("calls onAdjournMotion when Motion to Adjourn is clicked", async () => {
    const { user } = renderWithProviders(<AdjournmentControls {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /adjourn meeting/i }));

    await waitFor(async () => {
      const menuItem = screen.getByText(/motion to adjourn/i);
      await user.click(menuItem);
    });

    expect(defaultProps.onAdjournMotion).toHaveBeenCalledOnce();
  });

  it("opens without-objection dialog when that option is clicked", async () => {
    const { user } = renderWithProviders(<AdjournmentControls {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /adjourn meeting/i }));

    await waitFor(async () => {
      const menuItem = screen.getByText(/adjourn without objection/i);
      await user.click(menuItem);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /adjourn without objection/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/adjourns the meeting without objection/i)).toBeInTheDocument();
    });
  });
});

// ─── AdjournWithoutObjectionDialog ──────────────────────────────────

describe("AdjournWithoutObjectionDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    presidingOfficerName: "John Smith",
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog with presiding officer name", () => {
    renderWithProviders(<AdjournWithoutObjectionDialog {...defaultProps} />);
    expect(screen.getByText(/John Smith/)).toBeInTheDocument();
    expect(screen.getByText(/adjourns the meeting without objection/i)).toBeInTheDocument();
  });

  it("shows confirmation and cancel buttons", () => {
    renderWithProviders(<AdjournWithoutObjectionDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: /confirm adjournment/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("calls onConfirm when confirmed", () => {
    renderWithProviders(<AdjournWithoutObjectionDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm adjournment/i }));
    expect(defaultProps.onConfirm).toHaveBeenCalledOnce();
  });

  it("closes dialog on cancel", () => {
    renderWithProviders(<AdjournWithoutObjectionDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  /**
   * Phase E, wave 5, Task 5 — the placement half of the adjournment refusal.
   *
   * `meeting.adjourn` can answer FORBIDDEN now (the raw write it replaces had
   * no authorization check of any kind), and a refused destructive write leaves
   * this dialog OPEN while Radix marks everything outside it `aria-hidden`. So
   * the message has to be rendered in here, and it has to carry `role="alert"`
   * — which is what the test asserts, not the string.
   *
   * `routes/meetings.$meetingId.live.test.tsx` asserts the other half: that the
   * route hands the message down rather than rendering it on the page.
   */
  it("renders a refusal INSIDE the dialog, where the rest of the page is aria-hidden", () => {
    renderWithProviders(
      <AdjournWithoutObjectionDialog
        {...defaultProps}
        error="You don't have permission to adjourn this meeting."
      />,
    );

    const dialog = screen.getByRole("dialog");
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent(/permission to adjourn this meeting/i);
  });

  it("disables the confirm button from the caller's pending state, not a local flag", () => {
    // The local `confirming` flag this dialog used to set was never cleared —
    // correct only while adjourning could not fail. A refused adjournment left
    // a permanently disabled button with nothing to explain it.
    const { rerender } = renderWithProviders(
      <AdjournWithoutObjectionDialog {...defaultProps} isPending />,
    );
    expect(screen.getByRole("button", { name: /adjourning/i })).toBeDisabled();

    rerender(
      <AdjournWithoutObjectionDialog {...defaultProps} isPending={false} error="Refused." />,
    );
    expect(screen.getByRole("button", { name: /confirm adjournment/i })).toBeEnabled();
  });
});
