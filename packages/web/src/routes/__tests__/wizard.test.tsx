import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: vi.fn(() => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
    user: { id: "user-1", email: "admin@test.com" },
    session: { access_token: "mock-jwt" },
  })),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: vi.fn(() => ({
    id: "user-1",
    personId: null,
    email: "admin@test.com",
    townId: null,
    role: "admin",
    govTitle: null,
    permissions: {},
  })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "admin@test.com" } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "town-1" }, error: null }),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

// Mock useWizard — the stages read state from it
vi.mock("@/providers/WizardProvider", () => ({
  useWizard: vi.fn(() => ({
    state: {
      stage1: {
        townName: "",
        state: "ME",
        municipalityType: "town",
        populationRange: "under_1000",
        contactName: "",
        contactRole: "",
      },
      stage2: {
        boardName: "",
        memberCount: 3,
        electionMethod: "at_large",
        seatTitles: [],
        officerElectionMethod: "vote_of_board",
        districtBased: false,
        staggeredTerms: false,
      },
      stage3: {
        presidingOfficer: "chair_of_board",
        minutesRecorder: "town_clerk",
        staffRolesPresent: [],
      },
      stage4: {
        boards: [],
      },
      stage5: {
        meetingFormality: "informal",
        minutesStyle: "summary",
      },
      currentStage: 1,
      completedStages: new Set(),
    },
    updateStage: vi.fn(),
    goToStage: vi.fn(),
    goNext: vi.fn(),
    goBack: vi.fn(),
    markStageComplete: vi.fn(),
    getWizardData: vi.fn(),
    resetWizard: vi.fn(),
  })),
  WizardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Import stage components directly for isolated testing
import { WizardStage1 } from "@/components/wizard/stages/WizardStage1";
import { WizardStage2 } from "@/components/wizard/stages/WizardStage2";
import { WizardStage4 } from "@/components/wizard/stages/WizardStage4";

// ─── Stage 1 Tests ──────────────────────────────────────────────────

describe("WizardStage1 — Your Town", () => {
  const defaultProps = {
    onValidityChange: vi.fn(),
    onRegister: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all required fields", () => {
    render(<WizardStage1 {...defaultProps} />);

    expect(screen.getByText("Your Town")).toBeInTheDocument();
    expect(screen.getByLabelText(/town name/i)).toBeInTheDocument();
    expect(screen.getByText(/state/i)).toBeInTheDocument();
    expect(screen.getByText(/municipality type/i)).toBeInTheDocument();
    expect(screen.getByText(/population range/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary contact name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary contact role/i)).toBeInTheDocument();
  });

  it("registers validate handler on mount", () => {
    render(<WizardStage1 {...defaultProps} />);

    expect(defaultProps.onRegister).toHaveBeenCalled();
    const handlers = defaultProps.onRegister.mock.calls[0]![0];
    expect(handlers).toHaveProperty("validate");
  });

  it("validate returns null with empty required fields", () => {
    render(<WizardStage1 {...defaultProps} />);

    const handlers = defaultProps.onRegister.mock.calls[0]![0];
    const result = handlers.validate();
    expect(result).toBeNull();
  });

  it("validate returns data when all fields are valid", async () => {
    const user = userEvent.setup();
    render(<WizardStage1 {...defaultProps} />);

    await user.type(screen.getByLabelText(/town name/i), "Newcastle");
    await user.type(screen.getByLabelText(/primary contact name/i), "Jane Smith");
    await user.type(screen.getByLabelText(/primary contact role/i), "Town Clerk");

    // Get the latest handlers from the most recent onRegister call
    const calls = defaultProps.onRegister.mock.calls;
    const handlers = calls[calls.length - 1]![0];
    const result = handlers.validate();

    expect(result).not.toBeNull();
    expect(result?.townName).toBe("Newcastle");
    expect(result?.state).toBe("ME");
    expect(result?.municipalityType).toBe("town");
  });
});

// ─── Stage 2 Tests ──────────────────────────────────────────────────

describe("WizardStage2 — Your Governing Board", () => {
  const defaultProps = {
    onValidityChange: vi.fn(),
    onRegister: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders board name and member count fields", () => {
    render(<WizardStage2 {...defaultProps} />);

    expect(screen.getByText("Your Governing Board")).toBeInTheDocument();
    expect(screen.getByLabelText(/board name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/number of members/i)).toBeInTheDocument();
  });

  it("defaults to at-large election method", () => {
    render(<WizardStage2 {...defaultProps} />);

    const atLargeRadio = screen.getByLabelText(/at-large/i);
    expect(atLargeRadio).toBeChecked();
  });

  it("shows seat title fields when role-titled is selected", async () => {
    const user = userEvent.setup();
    render(<WizardStage2 {...defaultProps} />);

    // Fill board name first (needed for auto-generated titles)
    await user.type(screen.getByLabelText(/board name/i), "Select Board");

    // Click role-titled radio
    const roleTitledRadio = screen.getByLabelText(/role-titled/i);
    await user.click(roleTitledRadio);

    // Should show seat title inputs for default 3 members
    await waitFor(() => {
      expect(screen.getByText(/seat 1/i)).toBeInTheDocument();
    });
  });

  it("shows zero-member warning when member count is 0", async () => {
    const user = userEvent.setup();
    render(<WizardStage2 {...defaultProps} />);

    const memberInput = screen.getByLabelText(/number of members/i);
    await user.clear(memberInput);
    await user.type(memberInput, "0");

    await waitFor(() => {
      expect(screen.getByText(/at least 3 members/i)).toBeInTheDocument();
    });
  });
});

// ─── Stage 4 Tests ──────────────────────────────────────────────────

describe("WizardStage4 — Your Boards & Committees", () => {
  const defaultProps = {
    onValidityChange: vi.fn(),
    onRegister: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders standard Maine boards list", () => {
    render(<WizardStage4 {...defaultProps} />);

    expect(screen.getByText("Your Boards & Committees")).toBeInTheDocument();
    expect(screen.getByText(/planning board/i)).toBeInTheDocument();
    expect(screen.getByText(/zoning board/i)).toBeInTheDocument();
    expect(screen.getByText(/budget committee/i)).toBeInTheDocument();
    // "Conservation Commission" matches multiple (incl. "Shellfish Conservation Commission")
    expect(screen.getAllByText(/conservation commission/i).length).toBeGreaterThanOrEqual(1);
  });

  it("stage is valid with no boards checked", () => {
    render(<WizardStage4 {...defaultProps} />);

    const handlers = defaultProps.onRegister.mock.calls[0]![0];
    const result = handlers.validate();
    expect(result).not.toBeNull();
  });

  it("checking a board expands its configuration", async () => {
    const user = userEvent.setup();
    render(<WizardStage4 {...defaultProps} />);

    // Find and check the Planning Board checkbox
    const planningCheckbox = screen.getByRole("checkbox", { name: /planning board/i });
    await user.click(planningCheckbox);

    // Sub-configuration should appear (member count, elected/appointed)
    await waitFor(() => {
      expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    });
  });
});
