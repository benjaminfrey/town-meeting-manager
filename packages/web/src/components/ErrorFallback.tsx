import { useState } from "react";
import { Link } from "react-router";
import type { FallbackProps } from "react-error-boundary";
import { AlertTriangle, ChevronDown, ChevronUp, Home, RefreshCw } from "lucide-react";

/**
 * Section-level error fallback (used inside feature-area ErrorBoundary wrappers).
 *
 * Shows a compact, non-disruptive error card so that when one panel crashes
 * during a live meeting, the rest of the page continues to work.
 */
export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const [showDetails, setShowDetails] = useState(false);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  return (
    <div
      className="flex min-h-[200px] items-center justify-center p-6"
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto w-full max-w-md rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        {/* Header */}
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold">Something went wrong</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              An error occurred in this section. Other parts of the application
              should continue to work.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={resetErrorBoundary}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </button>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
            Go to dashboard
          </Link>
        </div>

        {/* Collapsible technical details */}
        <div className="mt-4 border-t pt-3">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showDetails}
            aria-controls="error-details"
          >
            {showDetails ? (
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            )}
            Technical details
          </button>
          {showDetails && (
            <div id="error-details" className="mt-2">
              <p className="text-xs font-medium text-destructive break-words">
                {errorMessage}
              </p>
              {errorStack && (
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-3 text-xs leading-relaxed">
                  <code>{errorStack}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact inline error fallback for tight spaces (e.g. panels in the live
 * meeting view).  Shows a minimal error message + retry button without the
 * surrounding card chrome.
 */
export function CompactErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const [showDetails, setShowDetails] = useState(false);
  const errorMessage = error instanceof Error ? error.message : String(error);

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 p-4 text-center"
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">This panel encountered an error.</p>
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={showDetails}
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
        {showDetails && (
          <p className="mt-1 text-xs text-muted-foreground break-words">{errorMessage}</p>
        )}
      </div>
      <button
        onClick={resetErrorBoundary}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}
