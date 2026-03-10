/**
 * Signup page — /signup route
 *
 * Creates a new Supabase Auth account. In dev mode (auto-confirm enabled),
 * the user is signed in immediately and redirected to /setup to create
 * their town. In prod mode, shows a "check your email" confirmation screen.
 */

import { type FormEvent, useState } from "react";
import { Link, useNavigate, Navigate } from "react-router";
import { z } from "zod";
import { ArrowLeft, Landmark, Loader2, MailCheck } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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

const signupSchema = z
  .object({
    email: z
      .string()
      .min(1, "Email is required")
      .email("Please enter a valid email"),
    password: z
      .string()
      .min(1, "Password is required")
      .min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FieldErrors = Partial<
  Record<keyof z.infer<typeof signupSchema>, string>
>;

// ─── Component ────────────────────────────────────────────────────────

export default function SignupPage() {
  const { signUp, isAuthenticated, isLoading: authLoading } = useAuth();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // If already authenticated, redirect
  if (!authLoading && isAuthenticated) {
    const destination = currentUser?.townId ? "/dashboard" : "/setup";
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Validate with Zod
    const result = signupSchema.safeParse({
      email,
      password,
      confirmPassword,
    });
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

    const { error, confirmEmail } = await signUp(
      result.data.email,
      result.data.password,
    );

    if (error) {
      setFormError(error);
      setIsSubmitting(false);
      return;
    }

    if (confirmEmail) {
      // Prod mode — email confirmation required
      setShowConfirmation(true);
    } else {
      // Dev mode — auto-confirmed, user is now signed in
      navigate("/setup", { replace: true });
    }
  };

  // ─── Email confirmation screen ──────────────────────────────────────

  if (showConfirmation) {
    return (
      <Card className="border-0 shadow-lg sm:border">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <MailCheck className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <CardTitle className="text-xl">Check your email</CardTitle>
            <CardDescription className="mt-1">
              We've sent a confirmation link to your email address. Please
              click the link to activate your account.
            </CardDescription>
          </div>
        </CardHeader>

        <CardFooter className="justify-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  // ─── Signup form ────────────────────────────────────────────────────

  return (
    <Card className="border-0 shadow-lg sm:border">
      <CardHeader className="space-y-3 text-center">
        {/* Logo */}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Landmark className="h-6 w-6 text-primary" />
        </div>
        <div>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription className="mt-1">
            Start managing your town's meetings
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
              autoComplete="new-password"
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

          {/* Confirm password field */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!fieldErrors.confirmPassword}
            />
            {fieldErrors.confirmPassword && (
              <p className="text-sm text-destructive">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          {/* Submit button */}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
