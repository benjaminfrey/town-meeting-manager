import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { AdjournmentControls } from "./AdjournmentControls";
import { AdjournWithoutObjectionDialog } from "./AdjournWithoutObjectionDialog";

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
      expect(screen.getByRole("heading", { name: /adjourn without objection/i })).toBeInTheDocument();
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
});
