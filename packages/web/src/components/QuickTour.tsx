/**
 * QuickTour — post-wizard onboarding overlay.
 *
 * A 4-step tour that highlights key areas of the app immediately
 * after the wizard completes. Shown once per user (tracked via
 * localStorage). Skippable at any time.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Quick Tour
 */

import { useCallback, useState } from "react";
import {
  LayoutDashboard,
  CheckSquare,
  List,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Tour steps ─────────────────────────────────────────────────────

interface TourStep {
  icon: React.ElementType;
  title: string;
  message: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    icon: LayoutDashboard,
    title: "Your Navigation",
    message:
      "The sidebar has everything you need: your dashboard, boards, meetings, and settings.",
  },
  {
    icon: CheckSquare,
    title: "Progress Checklist",
    message:
      "This checklist shows what's left to set up. Start with adding your board members.",
  },
  {
    icon: List,
    title: "Your Boards",
    message:
      "Each board has its own area for meetings, agendas, and minutes.",
  },
  {
    icon: Globe,
    title: "Public Portal",
    message:
      "When you're ready, your town's public portal will be live for residents to view agendas and minutes.",
  },
];

const TOUR_STORAGE_KEY = "tmm_tour_completed";

// ─── Hook ───────────────────────────────────────────────────────────

export function useShouldShowTour(welcome: boolean): boolean {
  if (!welcome) return false;
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) !== "true";
  } catch {
    return false;
  }
}

// ─── Component ──────────────────────────────────────────────────────

interface QuickTourProps {
  onComplete: () => void;
}

export function QuickTour({ onComplete }: QuickTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const step = TOUR_STEPS[currentStep]!;
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    } catch {
      // Ignore storage errors
    }
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      dismiss();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [isLastStep, dismiss]);

  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl bg-card p-6 shadow-2xl">
        {/* Step indicator dots */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-200 ${
                i === currentStep
                  ? "w-6 bg-primary"
                  : i < currentStep
                    ? "w-2 bg-primary/40"
                    : "w-2 bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-7 w-7 text-primary" />
          </div>

          <h2 className="mb-2 text-lg font-semibold">{step.title}</h2>
          <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
            {step.message}
          </p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={dismiss}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {currentStep + 1} of {TOUR_STEPS.length}
            </span>
            <Button onClick={handleNext} size="sm">
              {isLastStep ? "Get Started" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
