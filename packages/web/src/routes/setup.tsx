/**
 * Setup page — /setup route
 *
 * The onboarding wizard for first-time town administrators.
 * Only accessible to authenticated users whose JWT has town_id = null.
 * Users with an existing town are redirected to /dashboard.
 *
 * The wizard is a 5-stage, all-or-nothing flow — no database writes
 * until the final "Complete Setup" action. State lives in client
 * memory (WizardProvider) and is lost if the user navigates away.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md
 */

import { useCallback, useRef, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/providers/AuthProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { WizardProvider, useWizard } from "@/providers/WizardProvider";
import { WizardLayout } from "@/components/wizard/WizardLayout";
import { WizardNavBlocker } from "@/components/wizard/WizardNavBlocker";
import { WizardStage1 } from "@/components/wizard/stages/WizardStage1";
import { WizardStage2 } from "@/components/wizard/stages/WizardStage2";
import { WizardStage3 } from "@/components/wizard/stages/WizardStage3";
import { WizardStage4 } from "@/components/wizard/stages/WizardStage4";
import { WizardStage5 } from "@/components/wizard/stages/WizardStage5";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

// ─── Stage renderer ──────────────────────────────────────────────────

function WizardContent() {
  const { state, updateStage, markStageComplete, goNext } = useWizard();
  const { currentStage } = state;

  // Track form validity from the current stage
  const [isStageValid, setIsStageValid] = useState(false);

  // Ref to the current stage's validate function
  const stageHandlersRef = useRef<{ validate: () => unknown } | null>(null);

  const handleValidityChange = useCallback((isValid: boolean) => {
    setIsStageValid(isValid);
  }, []);

  const handleRegister = useCallback(
    (handlers: { validate: () => unknown }) => {
      stageHandlersRef.current = handlers;
    },
    []
  );

  const handleNext = useCallback(() => {
    if (!stageHandlersRef.current) return;

    const data = stageHandlersRef.current.validate();
    if (!data) return; // Validation failed — errors are shown in the form

    // Save data to wizard provider
    updateStage(currentStage as 1 | 2 | 3 | 4 | 5, data as Record<string, unknown>);
    markStageComplete(currentStage);
    goNext();
  }, [currentStage, updateStage, markStageComplete, goNext]);

  const handleComplete = useCallback(() => {
    // Stage 5 completion — will submit to backend in a future session
    handleNext();
  }, [handleNext]);

  // Render current stage
  const stageProps = {
    onValidityChange: handleValidityChange,
    onRegister: handleRegister,
  };

  let stageComponent: React.ReactNode;
  switch (currentStage) {
    case 1:
      stageComponent = <WizardStage1 {...stageProps} />;
      break;
    case 2:
      stageComponent = <WizardStage2 {...stageProps} />;
      break;
    case 3:
      stageComponent = <WizardStage3 {...stageProps} />;
      break;
    case 4:
      stageComponent = <WizardStage4 {...stageProps} />;
      break;
    case 5:
      stageComponent = <WizardStage5 {...stageProps} />;
      break;
    default:
      stageComponent = null;
  }

  return (
    <>
      <WizardNavBlocker />
      <WizardLayout
        isStageValid={isStageValid}
        onNext={handleNext}
        onComplete={handleComplete}
      >
        {stageComponent}
      </WizardLayout>
    </>
  );
}

// ─── Route component ─────────────────────────────────────────────────

export default function Setup() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const currentUser = useCurrentUser();

  // Still loading auth — show nothing (ProtectedRoute handles spinner)
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated — redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // User already has a town — redirect to dashboard
  if (currentUser?.townId) {
    return <Navigate to="/dashboard" replace />;
  }

  // First-time admin with no town — show the wizard
  return (
    <WizardProvider>
      <WizardContent />
    </WizardProvider>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
