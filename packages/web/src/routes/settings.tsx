import { Link } from "react-router";
import {
  Bell,
  Building2,
  ChevronRight,
  ClipboardCheck,
  FileText,
} from "lucide-react";
import type { Route } from "./+types/settings";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader() {
  return {};
}

const LINK_CLASS =
  "flex items-center justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent";

function SettingLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: typeof Bell;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to} className={LINK_CLASS}>
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

const SECTION_HEADING =
  "mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Town configuration and your preferences
        </p>
      </div>

      <h2 className={SECTION_HEADING}>Town configuration</h2>
      <div className="space-y-2">
        <SettingLink
          to="/settings/town"
          icon={Building2}
          title="Town Profile"
          desc="Name, boards, meeting defaults, roles, town seal, retention policy"
        />
        <SettingLink
          to="/settings/meeting-notices"
          icon={FileText}
          title="Meeting Notice Templates"
          desc="Configure notice templates for each board"
        />
        <SettingLink
          to="/settings/minutes-workflow"
          icon={ClipboardCheck}
          title="Minutes Approval Workflow"
          desc="How minutes are reviewed and approved"
        />
      </div>

      <h2 className={`${SECTION_HEADING} mt-6`}>Your account</h2>
      <div className="space-y-2">
        <SettingLink
          to="/settings/notifications"
          icon={Bell}
          title="Notification Preferences"
          desc="Choose which emails you receive"
        />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Looking for board-specific settings (quorum, agenda templates, workflow
        overrides)? Open a{" "}
        <Link to="/boards" className="underline hover:text-foreground">
          board
        </Link>{" "}
        and use its Settings tab.
      </p>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
