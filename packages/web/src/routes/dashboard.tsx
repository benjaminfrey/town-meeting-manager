import type { Route } from "./+types/dashboard";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader() {
  // Will be connected to PowerSync in session 02.02
  return {
    upcomingMeetings: [],
    recentActivity: [],
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Overview of your town's meeting activity
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Upcoming meetings card */}
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Upcoming Meetings
          </h3>
          <p className="mt-2 text-3xl font-bold">0</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No meetings scheduled
          </p>
        </div>

        {/* Active boards card */}
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Active Boards
          </h3>
          <p className="mt-2 text-3xl font-bold">0</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No boards configured
          </p>
        </div>

        {/* Pending minutes card */}
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Pending Minutes
          </h3>
          <p className="mt-2 text-3xl font-bold">0</p>
          <p className="mt-1 text-xs text-muted-foreground">
            All minutes approved
          </p>
        </div>
      </div>

      {/* Placeholder content */}
      <div className="mt-8 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-lg font-semibold">Recent Activity</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Activity will appear here once meetings are created and data is
          synced via PowerSync.
        </p>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
