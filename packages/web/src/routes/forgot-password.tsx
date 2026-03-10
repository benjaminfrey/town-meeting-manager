/**
 * Forgot Password page — /forgot-password route
 *
 * Sends a password reset link via Supabase Auth. Always shows the
 * generic success message regardless of whether the email exists
 * (security best practice — don't leak registered emails).
 */

import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { z } from "zod";
import { ArrowLeft, Landmark, Loader2, MailCheck } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
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

const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email"),
});

// ─── Component ────────────────────────────────────────────────────────

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setEmailError(null);

    // Validate with Zod
    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      setEmailError(result.error.issues[0]?.message ?? "Invalid email");
      return;
    }

    setIsSubmitting(true);

    const { error } = await resetPassword(result.data.email);

    if (error) {
      setFormError(error);
      setIsSubmitting(false);
      return;
    }

    // Always show success regardless of whether the email exists
    setSubmitted(true);
  };

  // Success state
  if (submitted) {
    return (
      <Card className="border-0 shadow-lg sm:border">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <MailCheck className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <CardTitle className="text-xl">Check your email</CardTitle>
            <CardDescription className="mt-1">
              If an account exists with that email, we've sent a password
              reset link.
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

  return (
    <Card className="border-0 shadow-lg sm:border">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Landmark className="h-6 w-6 text-primary" />
        </div>
        <div>
          <CardTitle className="text-xl">Reset your password</CardTitle>
          <CardDescription className="mt-1">
            Enter your email and we'll send you a reset link
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
              aria-invalid={!!emailError}
            />
            {emailError && (
              <p className="text-sm text-destructive">{emailError}</p>
            )}
          </div>

          {/* Submit button */}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      </CardContent>

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

export { RouteErrorBoundary as ErrorBoundary };
