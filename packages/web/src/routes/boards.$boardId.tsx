import type { Route } from "./+types/boards.$boardId";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // Will be connected to PowerSync in session 02.02
  return {
    boardId: params.boardId,
    board: null,
    members: [],
  };
}

export default function BoardDetail({ loaderData }: Route.ComponentProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Board Details</h1>
        <p className="mt-1 text-muted-foreground">
          Board ID: {loaderData.boardId}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="text-lg font-semibold">Board Information</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Board details and member management will be implemented in session
          04.02. Data will load from PowerSync (session 02.02).
        </p>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
