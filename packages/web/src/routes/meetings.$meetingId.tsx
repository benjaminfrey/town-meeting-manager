import type { Route } from "./+types/meetings.$meetingId";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // Will be connected to PowerSync in session 02.02
  return {
    meetingId: params.meetingId,
    meeting: null,
    agendaItems: [],
  };
}

export default function MeetingDetail({ loaderData }: Route.ComponentProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Meeting Details</h1>
        <p className="mt-1 text-muted-foreground">
          Meeting ID: {loaderData.meetingId}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-lg font-semibold">Meeting Information</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Meeting management and live meeting features will be implemented in
          sessions 06-07. Data will load from PowerSync (session 02.02).
        </p>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
