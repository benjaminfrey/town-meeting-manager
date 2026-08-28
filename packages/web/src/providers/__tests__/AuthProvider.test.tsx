// @vitest-environment jsdom
/**
 * AuthProvider — Better Auth, cookie sessions (Stage 1, Task C2).
 *
 * ─── What these tests are for, and what changed ───────────────────────────
 *
 * The previous version drove `supabase.auth.onAuthStateChange` by hand: it
 * captured the callback, fired `INITIAL_SESSION` / `SIGNED_OUT` at it, and
 * asserted the state machine that resulted. None of that survives, because
 * none of it exists — a cookie session has no event stream in the page.
 *
 * What replaces it is the question those tests were really asking, which
 * matters more now than it did then:
 *
 *   **When is it safe for the rest of the app to act on `isLoading === false`?**
 *
 * Two things are resolved on sign-in now, not one: the session, and then
 * `GET /api/me` for the town, role and permissions. `ProtectedRoute` sends a
 * user with no `townId` to `/setup`, so if `isLoading` went false between
 * those two, every signed-in user would be bounced into the onboarding wizard
 * on every cold load — and a fast click would try to create a second town. The
 * third test below is that property, and it is the reason this file exists.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockUseSession, mockSignInEmail, mockSignUpEmail, mockSignOut, mockRequestPasswordReset } =
  vi.hoisted(() => ({
    mockUseSession: vi.fn(),
    mockSignInEmail: vi.fn(),
    mockSignUpEmail: vi.fn(),
    mockSignOut: vi.fn(),
    mockRequestPasswordReset: vi.fn(),
  }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: mockUseSession,
    signIn: { email: mockSignInEmail },
    signUp: { email: mockSignUpEmail },
    signOut: mockSignOut,
    requestPasswordReset: mockRequestPasswordReset,
  },
}));

const { mockFetchCurrentUser } = vi.hoisted(() => ({ mockFetchCurrentUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ fetchCurrentUser: mockFetchCurrentUser }));

const { mockToastInfo } = vi.hoisted(() => ({ mockToastInfo: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { info: mockToastInfo, error: vi.fn(), success: vi.fn() },
}));

import { AuthProvider, useAuth } from "../AuthProvider";

// ─── Harness ────────────────────────────────────────────────────────

function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user-id">{auth.user?.id ?? "none"}</span>
      <span data-testid="town-id">{auth.currentUser?.townId ?? "none"}</span>
      <button onClick={() => void auth.signIn("test@test.com", "pass123")}>sign-in</button>
      <button onClick={() => void auth.signOut()}>sign-out</button>
    </div>
  );
}

function renderProvider(ui: React.ReactElement = <AuthConsumer />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}

const SESSION = {
  user: { id: "auth-user-1", email: "test@test.com", emailVerified: true, name: "Clerk" },
};

const IDENTITY = {
  id: "user-account-1",
  authUserId: "auth-user-1",
  personId: "person-1",
  email: "test@test.com",
  emailVerified: true,
  townId: "town-1",
  role: "admin" as const,
  govTitle: null,
  permissions: null,
};

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({ data: null, isPending: true });
    mockSignInEmail.mockResolvedValue({ error: null });
    mockSignUpEmail.mockResolvedValue({ error: null });
    mockSignOut.mockResolvedValue({});
    mockRequestPasswordReset.mockResolvedValue({ error: null });
    mockFetchCurrentUser.mockResolvedValue(IDENTITY);
  });

  it("starts in loading state while the session is being resolved", () => {
    renderProvider();
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("authenticated").textContent).toBe("false");
  });

  it("reports the identity once both the session and GET /api/me have resolved", async () => {
    mockUseSession.mockReturnValue({ data: SESSION, isPending: false });
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
    expect(screen.getByTestId("user-id").textContent).toBe("auth-user-1");
    expect(screen.getByTestId("town-id").textContent).toBe("town-1");
  });

  it("STAYS loading while the town is still in flight, even though the session is ready", async () => {
    // The property the whole provider is shaped around. `ProtectedRoute` reads
    // `isLoading` and then `townId`; if this went false early, a fully
    // onboarded user would be redirected to the onboarding wizard on every
    // cold load — and any of them quick enough would start building a second
    // town.
    let resolveIdentity!: (value: typeof IDENTITY) => void;
    mockFetchCurrentUser.mockReturnValue(
      new Promise<typeof IDENTITY>((resolve) => {
        resolveIdentity = resolve;
      }),
    );
    mockUseSession.mockReturnValue({ data: SESSION, isPending: false });

    renderProvider();

    // Session resolved, identity not.
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("town-id").textContent).toBe("none");

    await act(async () => {
      resolveIdentity(IDENTITY);
    });

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("town-id").textContent).toBe("town-1");
  });

  it("does not ask who the user is when there is no session", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("town-id").textContent).toBe("none");
  });

  it("signIn delegates to the Better Auth client", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    renderProvider();

    await act(async () => {
      screen.getByText("sign-in").click();
    });

    expect(mockSignInEmail).toHaveBeenCalledWith({
      email: "test@test.com",
      password: "pass123",
    });
  });

  it("maps Better Auth's error CODE, not its English wording", async () => {
    // The Supabase version matched substrings of the message, which breaks the
    // first time a message is reworded — and these two lead to completely
    // different next actions for the user.
    mockSignInEmail.mockResolvedValue({ error: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    mockUseSession.mockReturnValue({ data: null, isPending: false });

    let result: { error: string | null } | undefined;
    function TestConsumer() {
      const auth = useAuth();
      return (
        <button
          onClick={async () => {
            result = await auth.signIn("a@b.com", "wrong");
          }}
        >
          try
        </button>
      );
    }

    renderProvider(<TestConsumer />);
    await act(async () => {
      screen.getByText("try").click();
    });
    expect(result?.error).toBe("Invalid email or password");

    mockSignInEmail.mockResolvedValue({ error: { code: "EMAIL_NOT_VERIFIED" } });
    await act(async () => {
      screen.getByText("try").click();
    });
    expect(result?.error).toMatch(/confirm your address/i);
  });

  it("always reports that sign-up needs email confirmation", async () => {
    // `requireEmailVerification` is on and non-negotiable, so sign-up never
    // returns a session. The Supabase version inferred this from
    // `data.user.identities.length === 0`, which quietly meant "already signed
    // in" wherever auto-confirm was enabled — a dev/prod divergence.
    mockUseSession.mockReturnValue({ data: null, isPending: false });

    let result: { error: string | null; confirmEmail: boolean } | undefined;
    function TestConsumer() {
      const auth = useAuth();
      return (
        <button
          onClick={async () => {
            result = await auth.signUp("a@b.com", "password123");
          }}
        >
          try
        </button>
      );
    }

    renderProvider(<TestConsumer />);
    await act(async () => {
      screen.getByText("try").click();
    });

    expect(result).toEqual({ error: null, confirmEmail: true });
  });

  it("signOut delegates to the Better Auth client and does NOT claim the session expired", async () => {
    mockUseSession.mockReturnValue({ data: SESSION, isPending: false });
    const { rerender } = renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    await act(async () => {
      screen.getByText("sign-out").click();
    });
    expect(mockSignOut).toHaveBeenCalled();

    // A deliberate sign-out must not produce "your session has expired".
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  it("resetPassword asks the API for a reset link", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    function TestConsumer() {
      const auth = useAuth();
      return <button onClick={() => void auth.resetPassword("a@b.com")}>reset</button>;
    }

    renderProvider(<TestConsumer />);
    await act(async () => {
      screen.getByText("reset").click();
    });

    expect(mockRequestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com" }),
    );
  });
});
