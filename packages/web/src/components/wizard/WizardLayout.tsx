/**
 * WizardLayout — the shell for the onboarding wizard.
 *
 * Renders the progress indicator (5 steps), the current stage content,
 * and the Back / Next / Complete navigation bar.
 *
 * The layout is a full-page centered container (max-w-2xl) with the
 * app header, similar to AuthLayout but wider for the wizard forms.
 */

import { type ReactNode } from "react";
import { Check } from "lucide-react";
import { APP_NAME } from "@town-meeting/shared";
import { Button } from "@/components/ui/button";
import { useWizard } from "@/providers/WizardProvider";

// ─── Stage labels ────────────────────────────────────────────────────

const STAGE_LABELS = [
  "Your Town",
  "Governing Board",
  "Meeting Roles",
  "Boards & Committees",
  "Meeting Style",
] as const;

const STAGE_LABELS_SHORT = [
  "Town",
  "Board",
  "Roles",
  "Boards",
  "Style",
] as const;

// ─── Progress indicator ──────────────────────────────────────────────

function ProgressIndicator() {
  const { state } = useWizard();
  const { currentStage, completedStages } = state;

  return (
    <nav aria-label="Setup progress" className="w-full">
      <ol className="flex items-center justify-between">
        {STAGE_LABELS.map((label, index) => {
          const stageNum = index + 1;
          const isCurrent = currentStage === stageNum;
          const isComplete = completedStages.has(stageNum);
          const isFuture = !isCurrent && !isComplete;

          return (
            <li key={label} className="flex flex-1 items-center">
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`
                    flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium
                    transition-colors duration-200
                    ${
                      isComplete
                        ? "bg-green-600 text-white"
                        : isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                    }
                  `}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    stageNum
                  )}
                </div>
                {/* Full label on md+, short label on mobile */}
                <span
                  className={`
                    hidden text-xs font-medium sm:block
                    ${isCurrent ? "text-primary" : isFuture ? "text-muted-foreground" : "text-foreground"}
                  `}
                >
                  {label}
                </span>
                <span
                  className={`
                    block text-xs font-medium sm:hidden
                    ${isCurrent ? "text-primary" : isFuture ? "text-muted-foreground" : "text-foreground"}
                  `}
                >
                  {STAGE_LABELS_SHORT[index]}
                </span>
              </div>

              {/* Connecting line (not after the last step) */}
              {index < STAGE_LABELS.length - 1 && (
                <div
                  className={`
                    mx-2 h-px flex-1
                    ${completedStages.has(stageNum) ? "bg-green-600" : "bg-border"}
                  `}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Layout component ────────────────────────────────────────────────

interface WizardLayoutProps {
  children: ReactNode;
  /** Whether the current stage's form is valid (controls Next button) */
  isStageValid: boolean;
  /** Called when the user clicks Next — stage should validate and save */
  onNext: () => void;
  /** Called when the user clicks "Complete Setup" on stage 5 */
  onComplete?: () => void;
}

export function WizardLayout({
  children,
  isStageValid,
  onNext,
  onComplete,
}: WizardLayoutProps) {
  const { state, goBack } = useWizard();
  const { currentStage } = state;
  const isFirstStage = currentStage === 1;
  const isLastStage = currentStage === 5;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight">{APP_NAME}</h1>
            <p className="text-xs text-muted-foreground">
              Civic software for New England town government
            </p>
          </div>
          <span className="text-sm text-muted-foreground">
            Step {currentStage} of 5
          </span>
        </div>
      </header>

      {/* Main content area */}
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Progress indicator */}
          <ProgressIndicator />

          {/* Stage content */}
          <div>{children}</div>
        </div>
      </main>

      {/* Navigation bar */}
      <footer className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            {!isFirstStage && (
              <Button variant="outline" onClick={goBack}>
                Back
              </Button>
            )}
          </div>

          <div>
            {isLastStage ? (
              <Button
                onClick={onComplete ?? onNext}
                disabled={!isStageValid}
              >
                Complete Setup
              </Button>
            ) : (
              <Button
                onClick={onNext}
                disabled={!isStageValid}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
