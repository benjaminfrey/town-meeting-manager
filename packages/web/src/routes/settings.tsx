import type { Route } from "./+types/settings";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader() {
  // Will be connected to PowerSync in session 02.02
  return {};
}

export default function SettingsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your town's configuration
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-lg font-semibold">Town Settings</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Settings management will be implemented in later sessions.
        </p>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
