import type { FallbackProps } from "react-error-boundary";

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex min-h-[200px] items-center justify-center p-6">
      <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          An error occurred while rendering this section. Other parts of the
          application should continue to work.
        </p>

        {import.meta.env.DEV && error instanceof Error && (
          <div className="mt-4">
            <p className="text-sm font-medium text-destructive">
              {error.message}
            </p>
            {error.stack && (
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-3 text-xs">
                <code>{error.stack}</code>
              </pre>
            )}
          </div>
        )}

        <button
          onClick={resetErrorBoundary}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
