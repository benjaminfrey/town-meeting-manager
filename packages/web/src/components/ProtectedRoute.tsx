/**
 * Route guard that ensures users are authenticated before accessing
 * protected routes.
 *
 * - auth is loading            → full-page spinner
 * - not authenticated          → redirect to /login
 * - identity could not be read → RETRY, not a redirect. See below.
 * - authenticated, no town     → redirect to /setup (onboarding)
 * - otherwise                  → render children
 *
 * ─── Why the third case exists (Task C2, review round 1) ─────────────────
 *
 * This used to read `!currentUser?.townId` and navigate to `/setup`. Since
 * C2, `currentUser` comes from `GET /api/me` rather than from JWT claims the
 * page already held — and `null` now has two completely different meanings:
 *
 *   1. signed in, genuinely no town yet → the wizard is exactly right;
 *   2. the request FAILED → the wizard is exactly wrong.
 *
 * After the retry budget in `AuthProvider`, any 5xx or dropped connection
 * leaves `currentUser === null` with `isLoading === false`, and a fully
 * onboarded administrator would be navigated into the onboarding wizard by a
 * transient network blip. They would then be refused with 409 at the end of
 * it, having been walked through setting up a town they already have.
 *
 * So the two cases are told apart by `currentUserError` and only one of them
 * navigates. Getting this wrong is not cosmetic: a redirect discards whatever
 * the user was doing, and the failure it is reacting to is usually over by the
 * time they read the screen.
 */

import { Navigate } from "react-router";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, currentUser, currentUserError, refreshCurrentUser } =
    useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Signed in, but we could not find out who they are. NOT the wizard.
  if (currentUserError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold">We could not load your account</h1>
          <p className="text-sm text-muted-foreground">
            You are signed in, but the application could not reach the server to find out which town
            you belong to. This is usually temporary.
          </p>
          <Button onClick={() => void refreshCurrentUser()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Authenticated, no town — redirect to the onboarding wizard.
  if (!currentUser?.townId) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}
