/**
 * Authentication provider managing the entire auth lifecycle.
 *
 * Responsibilities:
 * - Restores session from localStorage on mount (INITIAL_SESSION)
 * - Subscribes to Supabase onAuthStateChange for all auth events
 * - Provides auth state (user, session, isLoading, isAuthenticated) to the app
 * - Exposes signIn, signOut, and resetPassword methods via context
 * - Coordinates with PowerSyncProvider for sync connect/disconnect
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string
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

// ─── Provider ─────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Track if initial session has been loaded to avoid race conditions
  const initializedRef = useRef(false);

  useEffect(() => {
    // Subscribe to auth state changes FIRST, then get the session.
    // Supabase recommends this order to avoid missing events.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      switch (event) {
        case "INITIAL_SESSION":
          // Fired on mount with the restored session (or null if none)
          setState({
            user: session?.user ?? null,
            session: session ?? null,
            isLoading: false,
            isAuthenticated: !!session,
          });
          initializedRef.current = true;
          break;

        case "SIGNED_IN":
          setState({
            user: session?.user ?? null,
            session: session ?? null,
            isLoading: false,
            isAuthenticated: true,
          });
          break;

        case "SIGNED_OUT":
          setState({
            user: null,
            session: null,
            isLoading: false,
            isAuthenticated: false,
          });

          // If this was an unexpected sign-out (e.g., refresh token expired),
          // show a notification to the user
          if (initializedRef.current) {
            toast.info("Your session has expired. Please sign in again.");
          }
          break;

        case "TOKEN_REFRESHED":
          // Update the session reference — PowerSync handles this internally
          // via fetchCredentials() which calls getSession()
          setState((prev) => ({
            ...prev,
            session: session ?? null,
            user: session?.user ?? prev.user,
          }));
          break;

        case "PASSWORD_RECOVERY":
          // TODO: Handle password recovery redirect in a future session
          break;
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // ─── Sign in ─────────────────────────────────────────────────────

  const signIn = useCallback(
    async (
      email: string,
      password: string
    ): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Map Supabase error messages to user-friendly strings
        if (error.message.includes("Invalid login credentials")) {
          return { error: "Invalid email or password" };
        }
        if (error.message.includes("Email not confirmed")) {
          return {
            error: "Please check your email to confirm your account",
          };
        }
        if (
          error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("Failed to fetch")
        ) {
          return {
            error:
              "Unable to connect. Please check your internet connection.",
          };
        }
        return { error: error.message };
      }

      // Success — the onAuthStateChange handler will update state
      return { error: null };
    },
    []
  );

  // ─── Sign up ─────────────────────────────────────────────────────

  const signUp = useCallback(
    async (
      email: string,
      password: string
    ): Promise<{ error: string | null; confirmEmail: boolean }> => {
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        if (error.message.includes("User already registered")) {
          return {
            error: "An account with this email already exists",
            confirmEmail: false,
          };
        }
        if (
          error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("Failed to fetch")
        ) {
          return {
            error:
              "Unable to connect. Please check your internet connection.",
            confirmEmail: false,
          };
        }
        return { error: error.message, confirmEmail: false };
      }

      // Supabase returns the user but with no identities when email
      // confirmation is required (user exists but unconfirmed).
      const needsConfirmation =
        data.user?.identities?.length === 0 || !data.user?.confirmed_at;

      return { error: null, confirmEmail: needsConfirmation };
    },
    []
  );

  // ─── Sign out ────────────────────────────────────────────────────

  const signOut = useCallback(async (): Promise<void> => {
    // Note: PowerSync disconnect is handled by the PowerSyncProvider
    // listening to auth state changes — it will call disconnectAndClear()
    // when it detects SIGNED_OUT
    await supabase.auth.signOut();
  }, []);

  // ─── Reset password ──────────────────────────────────────────────

  const resetPassword = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        if (
          error.message.includes("fetch") ||
          error.message.includes("network")
        ) {
          return {
            error:
              "Unable to connect. Please check your internet connection.",
          };
        }
        return { error: error.message };
      }

      return { error: null };
    },
    []
  );

  // ─── Context value ───────────────────────────────────────────────

  const value: AuthContextValue = {
    ...state,
    signIn,
    signUp,
    signOut,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
