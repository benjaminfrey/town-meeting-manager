import { Link } from "react-router";
import { Bell, ChevronRight, ClipboardCheck, FileText } from "lucide-react";
import type { Route } from "./+types/settings";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader() {
  return {};
}

const LINK_CLASS =
  "flex items-center justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm hover:bg-accent transition-colors";

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your account and preferences
        </p>
      </div>

      <div className="space-y-2">
        <Link to="/settings/meeting-notices" className={LINK_CLASS}>
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Meeting Notice Templates</p>
              <p className="text-xs text-muted-foreground">
                Configure notice templates for each board
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link to="/settings/minutes-workflow" className={LINK_CLASS}>
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Minutes Approval Workflow</p>
              <p className="text-xs text-muted-foreground">
                Configure how minutes are reviewed and approved
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link to="/settings/notifications" className={LINK_CLASS}>
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Notification Preferences</p>
              <p className="text-xs text-muted-foreground">Choose which emails you receive</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
