/**
 * Login page — /login route
 *
 * Uses plain React state + Zod for validation, shadcn/ui for styling.
 * Authenticates via Supabase Auth. On success, redirects to /dashboard
 * or /setup depending on whether the user has a town_id claim in their JWT.
 */

import { type FormEvent, useState } from "react";
import { Link, useNavigate, Navigate } from "react-router";
import { z } from "zod";
import { Loader2, Landmark } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

// ─── Validation schema ────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
});

type FieldErrors = Partial<Record<keyof z.infer<typeof loginSchema>, string>>;

// ─── Component ────────────────────────────────────────────────────────

export default function LoginPage() {
  const { signIn, isAuthenticated, isLoading: authLoading } = useAuth();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If already authenticated, redirect based on whether user has a town
  if (!authLoading && isAuthenticated) {
    const destination = currentUser?.townId ? "/dashboard" : "/setup";
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Validate with Zod
    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    const { error } = await signIn(result.data.email, result.data.password);

    if (error) {
      setFormError(error);
      setIsSubmitting(false);
      return;
    }

    // Success — determine redirect destination based on JWT claims.
    // Read the fresh session to check for town_id before the auth
    // state change propagates through React.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    let hasTown = false;
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]!));
        hasTown = !!(
          payload.town_id ??
          payload.app_metadata?.town_id ??
          payload.user_metadata?.town_id
        );
      } catch {
        // If JWT decode fails, default to setup
      }
    }
    navigate(hasTown ? "/dashboard" : "/setup", { replace: true });
  };

  return (
    <Card className="border-0 shadow-lg sm:border">
      <CardHeader className="space-y-3 text-center">
        {/* Logo placeholder */}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Landmark className="h-6 w-6 text-primary" />
        </div>
        <div>
          <CardTitle className="text-xl">Sign in to your account</CardTitle>
          <CardDescription className="mt-1">
            Enter your credentials to access the meeting manager
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Form-level error */}
          {formError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          {/* Email field */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@yourtown.gov"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
            />
            {fieldErrors.email && (
              <p className="text-sm text-destructive">{fieldErrors.email}</p>
            )}
          </div>

          {/* Password field */}
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
            />
            {fieldErrors.password && (
              <p className="text-sm text-destructive">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {/* Submit button */}
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <Link
          to="/forgot-password"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
        >
          Forgot your password?
        </Link>
      </CardFooter>
    </Card>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
