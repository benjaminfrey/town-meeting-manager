import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { AdjournmentControls } from "./AdjournmentControls";
import { AdjournWithoutObjectionDialog } from "./AdjournWithoutObjectionDialog";

const { mockDb } = vi.hoisted(() => {
  return {
    mockDb: {
      execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
      getAll: vi.fn().mockResolvedValue([]),
      getOptional: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(undefined),
      watch: vi.fn(),
      writeTransaction: vi.fn().mockImplementation(async (callback: any) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
          getAll: vi.fn().mockResolvedValue([]),
          getOptional: vi.fn().mockResolvedValue(null),
          get: vi.fn().mockResolvedValue(undefined),
        };
        await callback(mockTx);
      }),
      connected: true,
      currentStatus: { connected: true, hasSynced: true, dataFlowStatus: { uploading: false, downloading: false } },
    },
  };
});

vi.mock("@powersync/react", () => ({
  useQuery: vi.fn().mockReturnValue({ data: [], isLoading: false, isFetching: false, error: undefined }),
  usePowerSync: vi.fn().mockReturnValue(mockDb),
  PowerSyncContext: { Provider: ({ children }: any) => children },
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
