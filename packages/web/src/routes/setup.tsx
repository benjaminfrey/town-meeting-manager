import type { Route } from "./+types/setup";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader() {
  // Will be connected to setup wizard in session 03.01
  return {};
}

export default function Setup() {
  return (
    <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-lg font-semibold">Town Setup Wizard</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The setup wizard will guide you through configuring your town's
        meeting management. This will be implemented in session 03.01.
      </p>

      {/* Placeholder steps */}
      <div className="mt-6 space-y-3">
        {[
          "Town Information",
          "Board Setup",
          "Meeting Defaults",
          "User Roles",
          "Confirmation",
        ].map((step, i) => (
          <div
            key={step}
            className="flex items-center gap-3 rounded-md border p-3"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
              {i + 1}
            </div>
            <span className="text-sm">{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
