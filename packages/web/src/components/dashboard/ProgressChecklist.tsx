/**
 * ProgressChecklist — post-wizard setup completion tracker.
 *
 * Shows a card on the dashboard with checklist items for completing
 * town setup. Items are checked off as completed. Required items
 * are marked as such.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Progress Checklist
 */

import { Link } from "react-router";
import { useQuery } from "@powersync/react";
import { Check, Circle, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ─── Checklist item component ───────────────────────────────────────

interface ChecklistItemProps {
  label: string;
  description?: string;
  completed: boolean;
  required?: boolean;
  linkTo: string;
}

function ChecklistItem({
  label,
  description,
  completed,
  required,
  linkTo,
}: ChecklistItemProps) {
  return (
    <Link
      to={linkTo}
      className="group flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50"
    >
      {/* Status icon */}
      <div className="mt-0.5 flex-shrink-0">
        {completed ? (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white">
            <Check className="h-3 w-3" />
          </div>
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      {/* Label and description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              completed ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {label}
          </span>
          {required && !completed && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              Required
            </span>
          )}
        </div>
        {description && !completed && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Arrow */}
      {!completed && (
        <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </Link>
  );
}

// ─── Progress bar ───────────────────────────────────────────────────

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {completed} of {total} complete
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-green-600 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function ProgressChecklist() {
  // Query board members across all boards to check if any have been added
  const { data: boardMembers } = useQuery(
    "SELECT COUNT(*) as count FROM board_members"
  );
  const { data: boards } = useQuery(
    "SELECT SUM(member_count) as total_seats FROM boards"
  );

  const memberCount = boardMembers?.[0]?.count ?? 0;
  const totalSeats = boards?.[0]?.total_seats ?? 0;
  const hasBoardMembers = memberCount > 0;

  // Define checklist items
  const items: (ChecklistItemProps & { key: string })[] = [
    {
      key: "board-members",
      label: hasBoardMembers
        ? `Board members added (${memberCount} of ${totalSeats})`
        : `Add board members (0 of ${totalSeats || "N"} seats)`,
      description: "Add members to your boards so they can hold meetings",
      completed: hasBoardMembers,
      required: true,
      linkTo: "/boards/overview",
    },
    {
      key: "meeting-notice",
      label: "Set meeting notice template",
      description: "Customize how meeting notices are formatted",
      completed: false,
      required: false,
      linkTo: "/settings",
    },
    {
      key: "minutes-workflow",
      label: "Configure minutes approval workflow",
      description: "Set up how draft minutes are reviewed and approved",
      completed: false,
      required: false,
      linkTo: "/settings",
    },
    {
      key: "town-seal",
      label: "Upload town seal",
      description: "Add your town seal for official documents",
      completed: false,
      required: false,
      linkTo: "/settings",
    },
    {
      key: "portal-subdomain",
      label: "Set public portal subdomain",
      description: "Choose your town's public URL",
      completed: false,
      required: false,
      linkTo: "/settings",
    },
    {
      key: "retention-policy",
      label: "Acknowledge retention policy",
      description: "Required before your first meeting",
      completed: false,
      required: true,
      linkTo: "/settings",
    },
  ];

  const completedCount = items.filter((i) => i.completed).length;

  // Don't show checklist if everything is done
  if (completedCount === items.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Finish Setting Up</CardTitle>
        <CardDescription>
          Complete these items to get the most out of your town's workspace
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <ProgressBar completed={completedCount} total={items.length} />

          <div className="divide-y">
            {items.map((item) => (
              <ChecklistItem
                key={item.key}
                label={item.label}
                description={item.description}
                completed={item.completed}
                required={item.required}
                linkTo={item.linkTo}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
