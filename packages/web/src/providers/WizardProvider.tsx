/**
 * WizardProvider — client-side state management for the onboarding wizard.
 *
 * Holds the complete wizard state for all 5 stages in React state.
 * No database writes occur until the final completion action.
 * If the user leaves the wizard, all state is lost (by design).
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  WizardStage1Data,
  WizardStage2Data,
  WizardStage3Data,
  WizardStage4Data,
  WizardStage5Data,
  WizardBoardEntry,
} from "@town-meeting/shared";

// ─── State shape ─────────────────────────────────────────────────────

export interface WizardState {
  stage1: WizardStage1Data;
  stage2: WizardStage2Data;
  stage3: WizardStage3Data;
  stage4: WizardStage4Data;
  stage5: WizardStage5Data;
  currentStage: number;
  completedStages: Set<number>;
}

// ─── Defaults from advisory 2.1 ─────────────────────────────────────

const DEFAULT_STAGE1: WizardStage1Data = {
  townName: "",
  state: "ME",
  municipalityType: "town",
  populationRange: "under_1000",
  contactName: "",
  contactRole: "",
};

const DEFAULT_STAGE2: WizardStage2Data = {
  boardName: "",
  memberCount: 3,
  electionMethod: "at_large",
  seatTitles: [],
  officerElectionMethod: "vote_of_board",
  districtBased: false,
  staggeredTerms: false,
};

const DEFAULT_STAGE3: WizardStage3Data = {
  presidingOfficer: "chair_of_board",
  minutesRecorder: "town_clerk",
  staffRolesPresent: [],
};

const DEFAULT_STAGE4: WizardStage4Data = {
  boards: [] as WizardBoardEntry[],
};

const DEFAULT_STAGE5: WizardStage5Data = {
  meetingFormality: "informal",
  minutesStyle: "summary",
};

function createInitialState(): WizardState {
  return {
    stage1: { ...DEFAULT_STAGE1 },
    stage2: { ...DEFAULT_STAGE2 },
    stage3: { ...DEFAULT_STAGE3 },
    stage4: { boards: [] },
    stage5: { ...DEFAULT_STAGE5 },
    currentStage: 1,
    completedStages: new Set(),
  };
}

// ─── Context ─────────────────────────────────────────────────────────

interface WizardContextValue {
  state: WizardState;
  /** Merge partial data into a stage's state */
  updateStage: <S extends 1 | 2 | 3 | 4 | 5>(
    stage: S,
    data: Partial<WizardState[`stage${S}`]>
  ) => void;
  /** Navigate to a specific stage */
  goToStage: (stage: number) => void;
  /** Advance to the next stage */
  goNext: () => void;
  /** Go to the previous stage */
  goBack: () => void;
  /** Mark a stage as validated and complete */
  markStageComplete: (stage: number) => void;
  /** Return the complete wizard state for submission */
  getWizardData: () => Omit<WizardState, "currentStage" | "completedStages">;
  /** Reset all wizard state (start over) */
  resetWizard: () => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WizardState>(createInitialState);

  const updateStage = useCallback(
    <S extends 1 | 2 | 3 | 4 | 5>(
      stage: S,
      data: Partial<WizardState[`stage${S}`]>
    ) => {
      setState((prev) => ({
        ...prev,
        [`stage${stage}`]: { ...prev[`stage${stage}`], ...data },
      }));
    },
    []
  );

  const goToStage = useCallback((stage: number) => {
    if (stage >= 1 && stage <= 5) {
      setState((prev) => ({ ...prev, currentStage: stage }));
    }
  }, []);

  const goNext = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStage: Math.min(prev.currentStage + 1, 5),
    }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStage: Math.max(prev.currentStage - 1, 1),
    }));
  }, []);

  const markStageComplete = useCallback((stage: number) => {
    setState((prev) => ({
      ...prev,
      completedStages: new Set([...prev.completedStages, stage]),
    }));
  }, []);

  const getWizardData = useCallback(() => {
    return {
      stage1: state.stage1,
      stage2: state.stage2,
      stage3: state.stage3,
      stage4: state.stage4,
      stage5: state.stage5,
    };
  }, [state.stage1, state.stage2, state.stage3, state.stage4, state.stage5]);

  const resetWizard = useCallback(() => {
    setState(createInitialState());
  }, []);

  const value = useMemo<WizardContextValue>(
    () => ({
      state,
      updateStage,
      goToStage,
      goNext,
      goBack,
      markStageComplete,
      getWizardData,
      resetWizard,
    }),
    [state, updateStage, goToStage, goNext, goBack, markStageComplete, getWizardData, resetWizard]
  );

  return (
    <WizardContext.Provider value={value}>{children}</WizardContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return ctx;
}
