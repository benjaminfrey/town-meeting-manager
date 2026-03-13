/**
 * Feature-area error boundaries for the live meeting view.
 *
 * Per Advisory 1.3a: place boundaries around feature areas, NOT the entire
 * app. If the agenda panel crashes, voting and minutes should still work.
 *
 * Each boundary wraps a single panel in the 3-panel live meeting interface.
 * They use CompactErrorFallback to avoid disrupting adjacent panels.
 */

import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { CompactErrorFallback } from "@/components/ErrorFallback";

// ─── Agenda panel ─────────────────────────────────────────────────────

interface AgendaPanelErrorBoundaryProps {
  children: ReactNode;
}

export function AgendaPanelErrorBoundary({ children }: AgendaPanelErrorBoundaryProps) {
  return (
    <ErrorBoundary FallbackComponent={CompactErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}

// ─── Voting / motion panel ────────────────────────────────────────────

interface VotingPanelErrorBoundaryProps {
  children: ReactNode;
}

export function VotingPanelErrorBoundary({ children }: VotingPanelErrorBoundaryProps) {
  return (
    <ErrorBoundary FallbackComponent={CompactErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}

// ─── Minutes panel ────────────────────────────────────────────────────

interface MinutesPanelErrorBoundaryProps {
  children: ReactNode;
}

export function MinutesPanelErrorBoundary({ children }: MinutesPanelErrorBoundaryProps) {
  return (
    <ErrorBoundary FallbackComponent={CompactErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}

// ─── Connection status bar ────────────────────────────────────────────
// The status bar MUST never crash and take the meeting view with it.

function ConnectionStatusSilentFallback() {
  // If the ConnectionStatusBar itself crashes, render nothing — don't disrupt
  // the operator. An absence of status information is better than a crash.
  return null;
}

interface ConnectionStatusBarErrorBoundaryProps {
  children: ReactNode;
}

export function ConnectionStatusBarErrorBoundary({
  children,
}: ConnectionStatusBarErrorBoundaryProps) {
  return (
    <ErrorBoundary FallbackComponent={ConnectionStatusSilentFallback}>
      {children}
    </ErrorBoundary>
  );
}
