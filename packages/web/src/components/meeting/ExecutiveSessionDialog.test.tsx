import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { ExecutiveSessionDialog } from "./ExecutiveSessionDialog";
import { ExitExecutiveSessionDialog } from "./ExitExecutiveSessionDialog";

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

// ─── ExecutiveSessionDialog ──────────────────────────────────────────

describe("ExecutiveSessionDialog", () => {
  let onOpenChange: ReturnType<typeof vi.fn>;
  let onProceed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onOpenChange = vi.fn();
    onProceed = vi.fn();
  });

  function renderDialog() {
    return renderWithProviders(
      <ExecutiveSessionDialog
        open={true}
        onOpenChange={onOpenChange}
        onProceed={onProceed}
      />,
    );
  }

  it("renders with citation select and disabled proceed button", () => {
    renderDialog();

    expect(screen.getByLabelText(/Legal Citation/)).toBeInTheDocument();
    const proceedBtn = screen.getByRole("button", { name: /Proceed to Motion/ });
    expect(proceedBtn).toBeDisabled();
  });

  it("shows all 8 Maine statutory citations A through H", () => {
    renderDialog();

    const select = screen.getByLabelText(/Legal Citation/) as HTMLSelectElement;
    // 8 citation options + 1 placeholder
    expect(select.options).toHaveLength(9);
  });

  it("displays full citation text when category selected", () => {
    renderDialog();

    const select = screen.getByLabelText(/Legal Citation/);
    fireEvent.change(select, { target: { value: "E" } });

    expect(screen.getByText(/1 M\.R\.S\.A\. §405\(6\)\(E\):/)).toBeInTheDocument();
    expect(
      screen.getByText(/Consultations with a municipal attorney concerning pending or contemplated litigation/),
    ).toBeInTheDocument();
  });

  it("generates correct motion text for selected category", () => {
    renderDialog();

    const select = screen.getByLabelText(/Legal Citation/);
    fireEvent.change(select, { target: { value: "A" } });

    expect(
      screen.getByText(
        /to enter Executive Session pursuant to 1 M\.R\.S\.A\. Section 405\(6\)\(A\) — Personnel matters/,
      ),
    ).toBeInTheDocument();
  });

  it("calls onProceed with correct arguments and closes dialog", () => {
    renderDialog();

    const select = screen.getByLabelText(/Legal Citation/);
    fireEvent.change(select, { target: { value: "A" } });

    const proceedBtn = screen.getByRole("button", { name: /Proceed to Motion/ });
    expect(proceedBtn).not.toBeDisabled();
    fireEvent.click(proceedBtn);

    expect(onProceed).toHaveBeenCalledWith(
      "1 MRSA 405(6)(A)",
      "A",
      "to enter Executive Session pursuant to 1 M.R.S.A. Section 405(6)(A) — Personnel matters",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ─── ExitExecutiveSessionDialog ──────────────────────────────────────

describe("ExitExecutiveSessionDialog", () => {
  let onOpenChange: ReturnType<typeof vi.fn>;
  let onReturnWithActions: ReturnType<typeof vi.fn>;
  let onReturnNoActions: ReturnType<typeof vi.fn>;
  const execSessionId = "exec-session-123";

  beforeEach(() => {
    vi.clearAllMocks();
    onOpenChange = vi.fn();
    onReturnWithActions = vi.fn();
    onReturnNoActions = vi.fn();
  });

  function renderDialog() {
    return renderWithProviders(
      <ExitExecutiveSessionDialog
        open={true}
        onOpenChange={onOpenChange}
        execSessionId={execSessionId}
        onReturnWithActions={onReturnWithActions}
        onReturnNoActions={onReturnNoActions}
      />,
    );
  }

  it("shows confirmation step initially", () => {
    renderDialog();

    expect(screen.getByText("Return to Public Session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm Return/ })).toBeInTheDocument();
  });

  it("updates executive session and shows post-action prompt", async () => {
    renderDialog();

    const confirmBtn = screen.getByRole("button", { name: /Confirm Return/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE executive_sessions SET exited_at = ? WHERE id = ?",
        expect.arrayContaining([expect.any(String), execSessionId]),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Post-Session Actions")).toBeInTheDocument();
    });
  });

  it("calls onReturnNoActions when 'No Actions Taken' clicked", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Confirm Return/ }));

    await waitFor(() => {
      expect(screen.getByText("Post-Session Actions")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /No Actions Taken/ }));

    expect(onReturnNoActions).toHaveBeenCalled();
  });

  it("calls onReturnWithActions when 'Yes — Record Actions' clicked", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Confirm Return/ }));

    await waitFor(() => {
      expect(screen.getByText("Post-Session Actions")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Yes — Record Actions/ }));

    expect(onReturnWithActions).toHaveBeenCalled();
  });
});
