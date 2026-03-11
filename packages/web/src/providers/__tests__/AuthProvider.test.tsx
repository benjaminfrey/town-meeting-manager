// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

// ─── Mock Supabase ──────────────────────────────────────────────────

type AuthCallback = (event: string, session: any) => void;
let authCallback: AuthCallback | null = null;

const {
  mockUnsubscribe,
  mockSignInWithPassword,
  mockSignOut,
  mockResetPasswordForEmail,
} = vi.hoisted(() => ({
  mockUnsubscribe: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockSignOut: vi.fn(),
  mockResetPasswordForEmail: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb: AuthCallback) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      }),
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      resetPasswordForEmail: mockResetPasswordForEmail,
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { AuthProvider, useAuth } from "../AuthProvider";

// ─── Test consumer component ────────────────────────────────────────

function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user-id">{auth.user?.id ?? "none"}</span>
      <button onClick={() => void auth.signIn("test@test.com", "pass123")}>
        sign-in
      </button>
      <button onClick={() => void auth.signOut()}>sign-out</button>
    </div>
  );
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCallback = null;
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("starts in loading state", () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId("loading").textContent).toBe("true");
  });

  it("sets authenticated after INITIAL_SESSION with session", async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    act(() => {
      authCallback?.("INITIAL_SESSION", {
        user: { id: "user-1", email: "test@test.com" },
        access_token: "jwt-token",
      });
    });

    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
    expect(screen.getByTestId("user-id").textContent).toBe("user-1");
  });

  it("clears state after SIGNED_OUT", async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    // First sign in
    act(() => {
      authCallback?.("INITIAL_SESSION", {
        user: { id: "user-1" },
        access_token: "jwt",
      });
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("true");

    // Then sign out
    act(() => {
      authCallback?.("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("false");
    expect(screen.getByTestId("user-id").textContent).toBe("none");
  });

  it("signIn delegates to supabase.auth.signInWithPassword", async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    // Trigger initial session
    act(() => {
      authCallback?.("INITIAL_SESSION", null);
    });

    await act(async () => {
      screen.getByText("sign-in").click();
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "test@test.com",
      password: "pass123",
    });
  });

  it("signIn maps 'Invalid login credentials' to friendly message", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    let signInResult: any;

    function TestConsumer() {
      const auth = useAuth();
      return (
        <button
          onClick={async () => {
            signInResult = await auth.signIn("a@b.com", "wrong");
          }}
        >
          try
        </button>
      );
    }

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    act(() => {
      authCallback?.("INITIAL_SESSION", null);
    });

    await act(async () => {
      screen.getByText("try").click();
    });

    expect(signInResult.error).toBe("Invalid email or password");
  });

  it("signOut delegates to supabase.auth.signOut", async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    act(() => {
      authCallback?.("INITIAL_SESSION", {
        user: { id: "u-1" },
        access_token: "jwt",
      });
    });

    await act(async () => {
      screen.getByText("sign-out").click();
    });

    expect(mockSignOut).toHaveBeenCalled();
  });
});
