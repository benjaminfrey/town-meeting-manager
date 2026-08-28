/**
 * Reset Password page — /reset-password route
 *
 * ─── Why this page did not exist before, and why it does now ─────────────
 *
 * `forgot-password.tsx` has always sent the user a reset link pointing at
 * `${window.location.origin}/reset-password`. There has never been a route at
 * that path. The link 404'd, and nothing said so — under Supabase the same
 * `redirectTo` was passed and the same page was missing, so "reset a password"
 * has never worked end to end in this application.
 *
 * Phase C's exit criteria list it explicitly, and Task C2 added
 * `sendResetPassword` to the auth instance (without it Better Auth answers
 * `RESET_PASSWORD_DISABLED` and never mints a token at all). This is the last
 * missing piece: the page the token lands on.
 *
 * ─── The flow, precisely ──────────────────────────────────────────────────
 *
 *   1. `/forgot-password` posts to `/api/auth/request-password-reset` with
 *      `redirectTo` = this page. Better Auth validates that against
 *      `trustedOrigins`, so it can only ever point back at this app.
 *   2. The email contains `/api/auth/reset-password/:token?callbackURL=…`.
 *   3. That endpoint checks the token exists and has not expired, then
 *      redirects here as `/reset-password?token=…`. An invalid or expired
 *      token redirects here as `?error=INVALID_TOKEN` instead — which is why
 *      this page reads `error` as well, rather than presenting a form that
 *      can only fail on submit.
 *   4. This page posts the new password and the token to
 *      `/api/auth/reset-password`.
 *
 * The token is deliberately NOT a session. Better Auth's
 * `autoSignInAfterVerification: false` reasoning applies here too — a link
 * that may sit in a mailbox, a proxy log or a forwarded thread must not also
 * be a way in. So a successful reset sends the user to /login to sign in with
 * the password they just chose.
 */

import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
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

const resetSchema = z
  .object({
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

type FieldErrors = Partial<Record<"password" | "confirmPassword", string>>;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");
  const linkError = searchParams.get("error");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // A dead link is answered before the form is shown, not after the user has
  // typed a password twice.
  if (!token || linkError) {
    return (
      <Card className="border-0 shadow-lg sm:border">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <KeyRound className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <CardTitle className="text-xl">This reset link is no longer valid</CardTitle>
            <CardDescription className="mt-1">
              Reset links expire after a short time and can only be used once. Request a new one and
              it will arrive in a moment.
            </CardDescription>
          </div>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link
            to="/forgot-password"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Request a new reset link
          </Link>
        </CardFooter>
      </Card>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const result = resetSchema.safeParse({ password, confirmPassword });
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    const { error } = await authClient.resetPassword({
      newPassword: result.data.password,
      token,
    });

    if (error) {
      setFormError(
        error.code === "INVALID_TOKEN"
          ? "This reset link has expired or has already been used. Request a new one."
          : (error.message ?? "Could not reset your password. Please try again."),
      );
      setIsSubmitting(false);
      return;
    }

    // No session is created — see this file's header.
    toast.success("Your password has been reset. Sign in with your new password.");
    void navigate("/login", { replace: true });
  };

  return (
    <Card className="border-0 shadow-lg sm:border">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <div>
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription className="mt-1">
            You will sign in with this password from now on.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
            />
            {fieldErrors.password && (
              <p className="text-sm text-destructive">{fieldErrors.password}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!fieldErrors.confirmPassword}
            />
            {fieldErrors.confirmPassword && (
              <p className="text-sm text-destructive">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Set new password"
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
