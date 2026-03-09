import { isRouteErrorResponse, useNavigate } from "react-router";

export function RouteErrorBoundary({ error }: { error: unknown }) {
  const navigate = useNavigate();

  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this page.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page not found";
      message = "The page you're looking for doesn't exist.";
    } else {
      title = `Error ${error.status}`;
      message = error.statusText || message;
    }
  }

  const isDev = import.meta.env.DEV;

  return (
    <div className="flex min-h-[400px] items-center justify-center p-6">
      <div className="mx-auto max-w-md rounded-lg border bg-card p-8 text-card-foreground shadow-sm">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>

        {isDev && error instanceof Error && (
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

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Reload page
          </button>
          <button
            onClick={() => navigate("/dashboard")}
            className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Go to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
