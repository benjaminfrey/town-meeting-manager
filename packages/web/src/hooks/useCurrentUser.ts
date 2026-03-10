/**
 * Hook to extract the current user's identity and permissions from the JWT.
 *
 * Decodes custom claims from the Supabase JWT access token:
 * - town_id, role, person_id, permissions, gov_title
 *
 * These claims are set by the custom_access_token_hook() in Supabase
 * (configured in session 01.08) which reads from the user_account table.
 *
 * Returns null if no authenticated session exists.
 */

import { useMemo } from "react";
import { useAuth } from "@/providers/AuthProvider";
import type { UserRole } from "@town-meeting/shared";

// ─── Types ────────────────────────────────────────────────────────────

export interface CurrentUser {
  /** Supabase auth user ID (UUID) */
  id: string;
  /** PERSON entity ID from the user_account table (UUID) */
  personId: string | null;
  /** User's email address */
  email: string;
  /** Town ID — null if no town set up yet (first-time admin) */
  townId: string | null;
  /** App role: sys_admin, admin, staff, board_member */
  role: UserRole;
  /** Display title like "Town Clerk" — from user_account.gov_title */
  govTitle: string | null;
  /** JSONB permissions from user_account */
  permissions: Record<string, boolean>;
}

// ─── JWT payload decoder ──────────────────────────────────────────────

interface JwtPayload {
  sub?: string;
  email?: string;
  town_id?: string;
  role?: string;
  person_id?: string;
  gov_title?: string;
  permissions?: Record<string, boolean>;
  user_metadata?: {
    town_id?: string;
    role?: string;
    person_id?: string;
    gov_title?: string;
    permissions?: Record<string, boolean>;
  };
  app_metadata?: {
    town_id?: string;
    role?: string;
    person_id?: string;
    gov_title?: string;
    permissions?: Record<string, boolean>;
  };
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    // Base64url decode
    const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────

export function useCurrentUser(): CurrentUser | null {
  const { user, session, isAuthenticated } = useAuth();

  return useMemo(() => {
    if (!isAuthenticated || !user || !session) {
      return null;
    }

    // Decode the JWT to extract custom claims
    const payload = decodeJwtPayload(session.access_token);

    // Custom claims may be at the top level (from custom_access_token_hook)
    // or nested in app_metadata/user_metadata depending on Supabase config
    const townId =
      payload?.town_id ??
      payload?.app_metadata?.town_id ??
      payload?.user_metadata?.town_id ??
      null;

    const role =
      (payload?.role as UserRole) ??
      (payload?.app_metadata?.role as UserRole) ??
      (payload?.user_metadata?.role as UserRole) ??
      "admin"; // Default to admin for first-time setup users

    const personId =
      payload?.person_id ??
      payload?.app_metadata?.person_id ??
      payload?.user_metadata?.person_id ??
      null;

    const govTitle =
      payload?.gov_title ??
      payload?.app_metadata?.gov_title ??
      payload?.user_metadata?.gov_title ??
      null;

    const permissions =
      payload?.permissions ??
      payload?.app_metadata?.permissions ??
      payload?.user_metadata?.permissions ??
      {};

    return {
      id: user.id,
      personId,
      email: user.email ?? "",
      townId,
      role,
      govTitle,
      permissions: typeof permissions === "object" ? permissions : {},
    };
  }, [user, session, isAuthenticated]);
}
