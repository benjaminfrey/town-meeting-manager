/**
 * Auth context mock for unit and component tests.
 *
 * Provides MockAuthProvider (matching the real AuthProvider interface)
 * and user factory functions for common test personas.
 */

import React, { createContext, useContext, type ReactNode } from "react";
import { vi } from "vitest";
import type { CurrentUser } from "@/hooks/useCurrentUser";
import type { UserRole, PermissionsMatrix } from "@town-meeting/shared";
import { buildPermissionsFromTemplate, DEFAULT_PERMISSION_TEMPLATES } from "@town-meeting/shared";

// ─── Mock user factories ────────────────────────────────────────────

const DEFAULT_MOCK_USER: CurrentUser = {
  // `id` is `user_account.id` as of Stage 1, Task C2 — it used to be the auth
  // provider's user id, which four call sites were already treating as a
  // `user_account` id. `authUserId` is the identity, kept separate.
  id: "user-1",
  authUserId: "auth-user-1",
  personId: "person-1",
  email: "admin@test.com",
  emailVerified: true,
  townId: "town-1",
  role: "admin" as UserRole,
  govTitle: null,
  permissions: null, // admin bypasses all permission checks
};

/**
 * Create a mock CurrentUser with optional overrides.
 */
export function createMockUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return { ...DEFAULT_MOCK_USER, ...overrides };
}

/**
 * Create an admin user with full access.
 */
export function createAdminUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return createMockUser({ role: "admin" as UserRole, ...overrides });
}

/**
 * Create a staff user, optionally with permissions from a named template.
 * Template names: "Town Clerk", "Deputy Clerk", "Board-Specific Staff",
 * "General Staff", "Recording Secretary Only"
 */
export function createStaffUser(
  templateName?: string,
  overrides: Partial<CurrentUser> = {},
): CurrentUser {
  let permissions: PermissionsMatrix | null = null;

  if (templateName) {
    const template = DEFAULT_PERMISSION_TEMPLATES.find((t) => t.name === templateName);
    if (template) {
      permissions = {
        global: buildPermissionsFromTemplate(template),
        board_overrides: [],
      };
    }
  }

  return createMockUser({
    role: "staff" as UserRole,
    permissions,
    ...overrides,
  });
}

/**
 * Create a board_member user.
 */
export function createBoardMemberUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return createMockUser({
    role: "board_member" as UserRole,
    ...overrides,
  });
}

// ─── Mock AuthProvider ──────────────────────────────────────────────

/**
 * Mirrors the real `AuthContextValue`.
 *
 * Stage 1, Task C2: `session` is gone — the Better Auth session is an
 * HTTP-only cookie, so there is no token object for a component to hold, and a
 * mock that still offered one would let a test pass against an interface the
 * application no longer has. `currentUser` is here instead, because identity
 * now lives on this context rather than being decoded from a token.
 */
interface MockAuthContextValue {
  user: { id: string; email: string; emailVerified: boolean; name?: string } | null;
  currentUser: CurrentUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshCurrentUser: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  resetPassword: ReturnType<typeof vi.fn>;
}

const AuthContext = createContext<MockAuthContextValue | null>(null);

interface MockAuthProviderProps {
  mockUser?: CurrentUser | null;
  isAuthenticated?: boolean;
  isLoading?: boolean;
  children?: ReactNode;
}

/**
 * Mock AuthProvider that provides a configurable auth context.
 *
 * By default, provides an authenticated admin user. Pass mockUser={null}
 * to simulate an unauthenticated state.
 */
export function MockAuthProvider({
  mockUser,
  isAuthenticated,
  isLoading = false,
  children,
}: MockAuthProviderProps) {
  const user = mockUser === undefined ? DEFAULT_MOCK_USER : mockUser;
  const authenticated = isAuthenticated ?? user !== null;

  const value: MockAuthContextValue = {
    user: user ? { id: user.authUserId, email: user.email, emailVerified: true } : null,
    currentUser: authenticated ? user : null,
    isLoading,
    isAuthenticated: authenticated,
    refreshCurrentUser: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null, confirmEmail: true }),
    signOut: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue({ error: null }),
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

/**
 * Mock useAuth hook — matches the real useAuth() interface.
 * Use this in vi.mock("@/providers/AuthProvider") setups.
 */
export function useMockAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useMockAuth must be used within MockAuthProvider");
  }
  return ctx;
}
