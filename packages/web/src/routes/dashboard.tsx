import { useQuery } from "@powersync/react";
import type { Route } from "./+types/dashboard";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader() {
  // Data is provided reactively by useQuery hooks in the component.
  // clientLoader returns minimal static data for initial render.
  return {};
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  // Reactive queries — these auto-update when local data changes
  const { data: boards } = useQuery("SELECT COUNT(*) as count FROM boards");
  const { data: meetings } = useQuery(
    "SELECT COUNT(*) as count FROM meetings WHERE status IN ('scheduled', 'in_progress')"
  );
  const { data: pendingMinutes } = useQuery(
    "SELECT COUNT(*) as count FROM minutes_documents WHERE status = 'draft'"
  );

  const boardCount = boards?.[0]?.count ?? 0;
  const meetingCount = meetings?.[0]?.count ?? 0;
  const pendingMinutesCount = pendingMinutes?.[0]?.count ?? 0;

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
          <p className="mt-2 text-3xl font-bold">{meetingCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {meetingCount === 0
              ? "No meetings scheduled"
              : `${meetingCount} meeting${meetingCount === 1 ? "" : "s"} scheduled`}
          </p>
        </div>

        {/* Active boards card */}
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Active Boards
          </h3>
          <p className="mt-2 text-3xl font-bold">{boardCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {boardCount === 0
              ? "No boards configured"
              : `${boardCount} board${boardCount === 1 ? "" : "s"} active`}
          </p>
        </div>

        {/* Pending minutes card */}
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Pending Minutes
          </h3>
          <p className="mt-2 text-3xl font-bold">{pendingMinutesCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendingMinutesCount === 0
              ? "All minutes approved"
              : `${pendingMinutesCount} draft${pendingMinutesCount === 1 ? "" : "s"} pending`}
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
