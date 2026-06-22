import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── Mock TanStack Query (capture a single mutate spy) ────────────────
const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...(actual as object),
    useQuery: vi.fn().mockReturnValue({ data: [] }), // emailExists check → false
    useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
    useMutation: vi.fn().mockReturnValue({ mutate: mockMutate, isPending: false }),
  };
});

// ─── Mock the form to be valid with fixed values ──────────────────────
vi.mock("@/hooks/useWizardForm", () => ({
  useWizardForm: () => ({
    values: { name: "Jane Doe", email: "jane@example.com" },
    errors: {},
    isValid: true,
    setValue: vi.fn(),
    setValues: vi.fn(),
    handleBlur: vi.fn(),
    validate: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({ from: vi.fn(), auth: { getSession: vi.fn() } }),
}));

// StaffAccountFlow → a button that fires onComplete
vi.mock("../StaffAccountFlow", () => ({
  StaffAccountFlow: ({ onComplete }: { onComplete: (r: unknown) => void }) => (
    <button onClick={() => onComplete({ permissions: {}, gov_title: "" })}>
      finish-staff
    </button>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddPersonDialog } from "../AddPersonDialog";

const props = { townId: "town-1", open: true, onOpenChange: vi.fn() };

describe("AddPersonDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("step 1 collects name + email", () => {
    render(<AddPersonDialog {...props} />);
    expect(screen.getByText("Add person")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeInTheDocument();
  });

  it("Continue reveals the Directory-only / Staff-account choice", () => {
    render(<AddPersonDialog {...props} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("Directory only")).toBeInTheDocument();
    expect(screen.getByText("Staff account")).toBeInTheDocument();
  });

  it("creates a directory-only person", () => {
    render(<AddPersonDialog {...props} />);
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("Directory only"));
    expect(mockMutate).toHaveBeenCalled();
  });

  it("creates a staff person via StaffAccountFlow", () => {
    render(<AddPersonDialog {...props} />);
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("Staff account"));
    fireEvent.click(screen.getByText("finish-staff"));
    expect(mockMutate).toHaveBeenCalled();
  });
});
