import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { fireEvent } from "@testing-library/react";
import { ExecutiveSessionDialog } from "./ExecutiveSessionDialog";
import { ExitExecutiveSessionDialog } from "./ExitExecutiveSessionDialog";

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

// ─── ExecutiveSessionDialog ──────────────────────────────────────────

describe("ExecutiveSessionDialog", () => {
  let onOpenChange: (open: boolean) => void;
  let onProceed: (citation: string, citationLetter: string, prefillMotionText: string) => void;

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
  let onOpenChange: (open: boolean) => void;
  let onReturnWithActions: () => void;
  let onReturnNoActions: () => void;
  const execSessionId = "exec-session-123";

  beforeEach(() => {
    vi.clearAllMocks();
    onOpenChange = vi.fn();
    onReturnWithActions = vi.fn();
    onReturnNoActions = vi.fn();
    // Restore chainable mock after clearAllMocks
    mockFrom.mockReturnValue(mockChain);
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'order', 'limit', 'single', 'throwOnError', 'or', 'filter', 'maybeSingle']) {
      if (typeof mockChain[m] === 'function' && 'mockReturnValue' in (mockChain[m] as object)) {
        (mockChain[m] as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
      }
    }
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
      expect(mockFrom).toHaveBeenCalledWith("executive_session");
      expect(mockChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ exited_at: expect.any(String) }),
      );
      expect(mockChain.eq).toHaveBeenCalledWith("id", execSessionId);
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
