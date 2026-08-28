/**
 * Authentication provider — Better Auth, cookie sessions.
 *
 * ─── Stage 1, Task C2: what changed and why the shape changed with it ─────
 *
 * This file used to subscribe to `supabase.auth.onAuthStateChange` and fan five
 * event types out into state. That existed because Supabase kept the session in
 * `localStorage` and refreshed it on a timer, so the page needed telling when
 * the token underneath it moved. A cookie session has no such lifecycle in the
 * page: the browser attaches it, the server validates it, and there is nothing
 * for JavaScript to hold. `INITIAL_SESSION`, `TOKEN_REFRESHED` and
 * `PASSWORD_RECOVERY` are therefore gone rather than translated — they have no
 * counterpart, and inventing one would be a listener that never fires.
 *
 * `SIGNED_OUT`'s one genuine job survives, though: telling a user their session
 * expired rather than silently bouncing them to the login page. That is now
 * derived — a session that was present and then is not, without `signOut`
 * having been called.
 *
 * ─── Two things are being resolved, and the second one matters ────────────
 *
 *   1. **Is there a session?** `useSession()` from the Better Auth client.
 *   2. **Who is this, and which town?** `GET /api/me`.
 *
 * Only (1) used to exist in this file, because (2) came free in the JWT's
 * custom claims. It does not any more, and the difference is load-bearing:
 * `ProtectedRoute` sends a user with no `townId` to `/setup`, so if
 * `isLoading` went false while (2) was still in flight, every signed-in user
 * would be redirected into the onboarding wizard for a moment on every cold
 * load — and any of them who clicked fast enough would be trying to create a
 * second town. So `isLoading` covers BOTH, and `isAuthenticated` means (1),
 * which is what the login screens ask about.
 */

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { fetchCurrentUser, type CurrentUser } from "@/lib/current-user";
import { ApiError } from "@/lib/api-client";
import { queryKeys } from "@/lib/queryKeys";

// ─── Types ────────────────────────────────────────────────────────────

/** The authenticated identity, as Better Auth reports it. */
export interface AuthIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

interface AuthContextValue {
  user: AuthIdentity | null;
  /** True until BOTH the session and the identity behind it have resolved. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Town, role and permissions — `null` until resolved, or if signed out. */
  currentUser: CurrentUser | null;
  /**
   * Why the identity could not be read, if it could not.
   *
   * Load-bearing, not diagnostic. `currentUser === null` has two completely
   * different meanings — "signed in, no town yet, go to the wizard" and
   * "asking the server failed" — and `ProtectedRoute` acts on the first by
   * navigating. Without this it acts on the second the same way, so a
   * transient 500 or a dropped connection sends a fully onboarded
   * administrator into the onboarding wizard. See `ProtectedRoute.tsx`.
   */
  currentUserError: Error | null;
  /** Re-read `GET /api/me`. Call after anything that changes the town link. */
  refreshCurrentUser: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; confirmEmail: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
}

// ─── Context ──────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

// ─── Error mapping ────────────────────────────────────────────────────

/**
 * Turn a Better Auth failure into something a town clerk can act on.
 *
 * Matched on the stable `code`, with the message as a fallback. The Supabase
 * version matched on English substrings of the message, which breaks the first
 * time a message is reworded — and the two that matter here, wrong password
 * and unverified address, lead to completely different next actions.
 */
function describeAuthError(error: { code?: string; message?: string } | null): string {
  if (!error) return "Something went wrong. Please try again.";
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "INVALID_EMAIL_OR_PASSWORD" || /invalid email or password/i.test(message)) {
    return "Invalid email or password";
  }
  if (code === "EMAIL_NOT_VERIFIED" || /not verified/i.test(message)) {
    return "Please check your email and confirm your address before signing in.";
  }
  if (code === "USER_ALREADY_EXISTS" || /already exists|already registered/i.test(message)) {
    return "An account with this email already exists";
  }
  if (/fetch|network|failed to fetch/i.test(message)) {
    return "Unable to connect. Please check your internet connection.";
  }
  return message || "Something went wrong. Please try again.";
}

// ─── Provider ─────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const { data: session, isPending: isSessionPending } = authClient.useSession();

  const authUserId = session?.user?.id ?? null;
  const isAuthenticated = authUserId !== null;

  const {
    data: currentUser,
    error: currentUserError,
    isPending: isIdentityPending,
    refetch: refetchCurrentUser,
  } = useQuery({
    queryKey: [...queryKeys.currentUser, authUserId],
    queryFn: fetchCurrentUser,
    enabled: isAuthenticated,
    // A 401 means the cookie went away between the session check and this
    // call. Retrying cannot help and would delay the sign-out the app is
    // about to notice anyway.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    staleTime: 60_000,
  });

  // ─── Expiry notice ───────────────────────────────────────────────
  //
  // The one thing `onAuthStateChange`'s SIGNED_OUT branch did that mattered:
  // distinguish "the user asked to leave" from "the session died underneath
  // them". A silent redirect to /login for the second case reads as the app
  // losing their work.
  const wasAuthenticated = useRef(false);
  const signingOutDeliberately = useRef(false);

  useEffect(() => {
    if (isSessionPending) return;
    if (isAuthenticated) {
      wasAuthenticated.current = true;
      return;
    }
    if (wasAuthenticated.current && !signingOutDeliberately.current) {
      toast.info("Your session has expired. Please sign in again.");
    }
    wasAuthenticated.current = false;
    // Cleared HERE, when the transition it describes has actually been
    // observed — not in `signOut`'s `finally`. `authClient.signOut()` resolves
    // before `useSession()` reports the session gone, so clearing it there
    // meant the flag was already false by the time this effect ran, and every
    // deliberate sign-out told the user their session had expired. Found by
    // the test, not by reading.
    signingOutDeliberately.current = false;
  }, [isAuthenticated, isSessionPending]);

  const refreshCurrentUser = useCallback(async () => {
    await refetchCurrentUser();
  }, [refetchCurrentUser]);

  // ─── Sign in ─────────────────────────────────────────────────────

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) return { error: describeAuthError(error) };
      return { error: null };
    },
    [],
  );

  // ─── Sign up ─────────────────────────────────────────────────────

  const signUp = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<{ error: string | null; confirmEmail: boolean }> => {
      // `name` is required by Better Auth's sign-up schema. The account holder
      // names themselves properly in the onboarding wizard, which writes
      // `person.name`; this is a placeholder for the auth record only.
      const { error } = await authClient.signUp.email({ email, password, name: email });
      if (error) return { error: describeAuthError(error), confirmEmail: false };

      // ALWAYS true, and not a guess about server configuration.
      // `requireEmailVerification` is on and non-negotiable (it is what closes
      // GHSA-fmh4-wcc4-5jm3), so sign-up never returns a session and the user
      // must confirm their address. The Supabase version inferred this from
      // `data.user.identities.length === 0`, an undocumented shape that
      // silently meant "signed in already" whenever auto-confirm was on — the
      // dev/prod divergence this replaces.
      return { error: null, confirmEmail: true };
    },
    [],
  );

  // ─── Sign out ────────────────────────────────────────────────────

  const signOut = useCallback(async (): Promise<void> => {
    signingOutDeliberately.current = true;
    try {
      await authClient.signOut();
    } finally {
      // Everything cached was read inside a tenant context that no longer
      // applies. Leaving it would show the previous user's town to the next
      // person to sign in on this device.
      queryClient.clear();
    }
  }, [queryClient]);

  // ─── Reset password ──────────────────────────────────────────────

  const resetPassword = useCallback(async (email: string): Promise<{ error: string | null }> => {
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { error: describeAuthError(error) };
    return { error: null };
  }, []);

  // ─── Context value ───────────────────────────────────────────────

  const value: AuthContextValue = {
    user: session?.user
      ? {
          id: session.user.id,
          email: session.user.email,
          emailVerified: session.user.emailVerified === true,
          name: session.user.name ?? undefined,
        }
      : null,
    // See the header: a signed-in user whose identity has not arrived yet must
    // not be treated as having no town, or `ProtectedRoute` sends them to the
    // onboarding wizard.
    isLoading: isSessionPending || (isAuthenticated && isIdentityPending),
    isAuthenticated,
    currentUser: isAuthenticated ? (currentUser ?? null) : null,
    currentUserError: isAuthenticated ? ((currentUserError as Error | null) ?? null) : null,
    refreshCurrentUser,
    signIn,
    signUp,
    signOut,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
