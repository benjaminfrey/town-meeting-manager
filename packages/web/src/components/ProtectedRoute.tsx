/**
 * Route guard that ensures users are authenticated before accessing
 * protected routes.
 *
 * - If auth is loading → shows a full-page spinner
 * - If not authenticated → redirects to /login
 * - If authenticated → renders children
 *
 * Used as a wrapper in layout components (e.g., RootLayout) to
 * protect all child routes.
 */

import { Navigate } from "react-router";
import { useAuth } from "@/providers/AuthProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const currentUser = useCurrentUser();

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

  // Authenticated but no town — redirect to onboarding wizard
  if (!currentUser?.townId) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}
