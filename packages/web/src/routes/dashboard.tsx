/**
 * Dashboard — /dashboard route
 *
 * The main home screen after onboarding. Shows:
 * - Welcome banner (on first visit after wizard completion)
 * - Progress checklist (until all items are completed)
 * - Stat cards for meetings, boards, and pending minutes
 * - Recent activity feed (placeholder)
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Dashboard
 */

import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@powersync/react";
import { PartyPopper } from "lucide-react";
import type { Route } from "./+types/dashboard";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { ProgressChecklist } from "@/components/dashboard/ProgressChecklist";
import { QuickTour, useShouldShowTour } from "@/components/QuickTour";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export async function clientLoader() {
  // Data is provided reactively by useQuery hooks in the component.
  // clientLoader returns minimal static data for initial render.
  return {};
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isWelcome = searchParams.get("welcome") === "true";
  const showTour = useShouldShowTour(isWelcome);
  const [tourActive, setTourActive] = useState(showTour);
  const currentUser = useCurrentUser();

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

  const handleTourComplete = useCallback(() => {
    setTourActive(false);
    // Remove ?welcome=true from the URL without a page reload
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const dismissWelcome = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="p-6">
      {/* Quick tour overlay */}
      {tourActive && <QuickTour onComplete={handleTourComplete} />}

      {/* Welcome banner — shown once after wizard completion */}
      {isWelcome && !tourActive && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
          <div className="flex items-start gap-3">
            <PartyPopper className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
            <div className="flex-1">
              <h2 className="font-semibold text-green-900 dark:text-green-100">
                Your town is set up!
              </h2>
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                Everything is configured and ready to go. Complete the checklist
                below to get the most out of your workspace.
              </p>
            </div>
            <button
              onClick={dismissWelcome}
              className="text-sm text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Overview of your town's meeting activity
        </p>
      </div>

      {/* Progress checklist */}
      <div className="mb-6">
        <ProgressChecklist />
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
