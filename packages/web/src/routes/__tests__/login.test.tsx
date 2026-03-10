import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, userEvent } from "@/test/render";

// ─── Mocks ──────────────────────────────────────────────────────────

const mockSignIn = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: vi.fn(() => ({
    signIn: mockSignIn,
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    isAuthenticated: false,
    isLoading: false,
    user: null,
    session: null,
  })),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: vi.fn(() => null),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
      }),
    },
  },
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  };
});

import LoginPage from "../login";
import { useAuth } from "@/providers/AuthProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ─── Tests ──────────────────────────────────────────────────────────

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ error: null });
  });

  it("renders email and password fields with sign in button", () => {
    renderWithProviders(<LoginPage />, { route: "/login" });

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows validation error for empty email", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
  });

  it("shows validation error for invalid email", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "notvalid");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    // Zod should reject "notvalid" as invalid email and prevent submission
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("shows validation error for short password", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "test@test.com");
    await user.type(screen.getByLabelText(/password/i), "short");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("calls signIn with correct credentials on valid submit", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "admin@test.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(mockSignIn).toHaveBeenCalledWith("admin@test.com", "password123");
  });

  it("displays error message when signIn fails", async () => {
    mockSignIn.mockResolvedValue({ error: "Invalid email or password" });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "admin@test.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });

  it("redirects to /dashboard when already authenticated with town", () => {
    vi.mocked(useAuth).mockReturnValue({
      signIn: mockSignIn,
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      isAuthenticated: true,
      isLoading: false,
      user: { id: "user-1" } as any,
      session: { access_token: "token" } as any,
    });
    vi.mocked(useCurrentUser).mockReturnValue({
      id: "user-1",
      personId: "person-1",
      email: "admin@test.com",
      townId: "town-1",
      role: "admin" as any,
      govTitle: null,
      permissions: {},
    });

    renderWithProviders(<LoginPage />, { route: "/login" });

    const nav = screen.getByTestId("navigate");
    expect(nav).toHaveAttribute("data-to", "/dashboard");
  });
});
