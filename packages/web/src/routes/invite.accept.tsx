/**
 * Invitation Acceptance Page — /invite/accept?token=xxx
 *
 * Public page (no auth required). Validates the invitation token,
 * shows the invitation details, and lets the user set their password
 * to activate their account.
 */

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// ─── Types ────────────────────────────────────────────────────────

interface InvitationDetails {
  valid: boolean;
  reason?: string;
  invitation_id?: string;
  person_name?: string | null;
  person_email?: string | null;
  town_name?: string | null;
  role?: string;
  expires_at?: string;
}

const ROLE_LABELS: Record<string, string> = {
  board_member: "Board Member",
  staff: "Staff",
  admin: "Administrator",
};

// ─── Form schema ──────────────────────────────────────────────────

const AcceptSchema = z
  .object({
    display_name: z.string().min(2, "Name must be at least 2 characters"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

type AcceptFormData = z.infer<typeof AcceptSchema>;

// ─── Component ────────────────────────────────────────────────────

export default function InviteAcceptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<AcceptFormData>({
    resolver: zodResolver(AcceptSchema),
    defaultValues: {
      display_name: "",
      password: "",
      confirm_password: "",
    },
  });

  // Validate token on load
  useEffect(() => {
    if (!token) {
      setInvitation({ valid: false, reason: "no_token" });
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/invitations/validate?token=${encodeURIComponent(token)}`,
        );
        if (!res.ok) {
          setInvitation({ valid: false, reason: "not_found" });
          return;
        }
        const data = (await res.json()) as InvitationDetails;
        setInvitation(data);
        // Pre-fill display name
        if (data.valid && data.person_name) {
          setValue("display_name", data.person_name);
        }
      } catch {
        setInvitation({ valid: false, reason: "error" });
      } finally {
        setLoading(false);
      }
    })();
  }, [token, setValue]);

  const onSubmit = async (formData: AcceptFormData) => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/invitations/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: formData.password,
          display_name: formData.display_name,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message ?? `Account setup failed (${res.status})`);
      }

      const result = (await res.json()) as { email: string };

      // Sign in automatically
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.email,
        password: formData.password,
      });

      if (signInError) {
        toast.success("Account created! Please sign in.");
        void navigate("/login");
        return;
      }

      toast.success("Welcome! Your account is ready.");
      void navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set up account");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Invalid states ───────────────────────────────────────────────

  if (!invitation?.valid) {
    const message =
      invitation?.reason === "already_accepted"
        ? "This invitation has already been accepted. Please sign in."
        : invitation?.reason === "expired"
          ? "This invitation has expired. Please ask your administrator to resend it."
          : "This invitation link is invalid or has been used.";

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm text-center">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <h1 className="mb-2 text-xl font-bold">Invalid Invitation</h1>
          <p className="mb-6 text-sm text-muted-foreground">{message}</p>
          {invitation?.reason === "already_accepted" && (
            <Button onClick={() => void navigate("/login")} className="w-full">
              Sign In
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Accept form ──────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <span className="text-xl font-bold">TM</span>
          </div>
          <h1 className="text-2xl font-bold">
            Welcome to {invitation.town_name ?? "Town Meeting Manager"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            You've been invited as a{" "}
            <strong>{ROLE_LABELS[invitation.role ?? "board_member"] ?? invitation.role}</strong>.
            Set up your account to get started.
          </p>
        </div>

        {/* Invitation details */}
        <div className="mb-6 rounded-lg border bg-muted/30 p-4 text-sm">
          <div className="grid grid-cols-2 gap-1 text-muted-foreground">
            {invitation.person_name && (
              <>
                <span>Name:</span>
                <span className="text-foreground">{invitation.person_name}</span>
              </>
            )}
            {invitation.person_email && (
              <>
                <span>Email:</span>
                <span className="text-foreground">{invitation.person_email}</span>
              </>
            )}
            {invitation.role && (
              <>
                <span>Role:</span>
                <span className="text-foreground">
                  {ROLE_LABELS[invitation.role] ?? invitation.role}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="display_name">Your name</Label>
              <Input
                id="display_name"
                {...register("display_name")}
                placeholder="Jane Smith"
                autoComplete="name"
              />
              {errors.display_name && (
                <p className="text-xs text-destructive">{errors.display_name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                {...register("password")}
                placeholder="Create a secure password"
                autoComplete="new-password"
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Minimum 8 characters, with at least one uppercase letter and one number.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm_password">Confirm password</Label>
              <Input
                id="confirm_password"
                type="password"
                {...register("confirm_password")}
                placeholder="Repeat your password"
                autoComplete="new-password"
              />
              {errors.confirm_password && (
                <p className="text-xs text-destructive">{errors.confirm_password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting up account...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Activate Account
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => void navigate("/login")}
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
