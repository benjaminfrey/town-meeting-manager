/**
 * ProgressChecklist — post-wizard setup completion tracker.
 *
 * Shows a card on the dashboard with checklist items for completing
 * town setup. Items are checked off as completed via TanStack Query.
 * Required items are tagged. Hides when all items are complete.
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Progress Checklist
 *
 * Stage 1, Phase E, wave 1, Task 5 — two of this component's three own reads
 * (`totalSeats`, the board/template counts) moved onto `board.list`, which
 * already scans every board in the town for `settings.meeting-notices.tsx`;
 * extending its SELECT by one column (`member_count`) was the whole change —
 * see that procedure's own doc comment. `memberCount` (actual filled seats,
 * from `board_member`) stays on Supabase — see the TODO marker below,
 * conventions item 11 — that table is board-membership territory this wave
 * deliberately leaves alone (the four board-member dialogs are wave 2's,
 * per the task brief's own self-review notes).
 *
 * The "Set public portal subdomain" item is wired for the first time in this
 * same task: `town.setPortalAddress` existed since Phase D with no caller
 * anywhere in the product. `onSetPortalAddressClick` opens
 * `SetPortalAddressModal` (mounted by whichever screen renders this
 * component — `settings.town.tsx` today), the same delegation shape
 * `onRetentionPolicyClick` already used for the retention-policy row.
 */

import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import { Check, Circle, ArrowRight, PartyPopper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Checklist item component ───────────────────────────────────────

interface ChecklistItemProps {
  label: string;
  description?: string;
  completed: boolean;
  required?: boolean;
  linkTo?: string;
  onClick?: () => void;
}

function ChecklistItem({
  label,
  description,
  completed,
  required,
  linkTo,
  onClick,
}: ChecklistItemProps) {
  const content = (
    <div className="group flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50">
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
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
            >
              Required
            </Badge>
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
    </div>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full text-left">
        {content}
      </button>
    );
  }

  if (linkTo) {
    return <Link to={linkTo}>{content}</Link>;
  }

  return content;
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

interface ProgressChecklistProps {
  townId: string;
  sealUrl: string | null;
  subdomain: string | null;
  retentionAcknowledgedAt: string | null;
  minutesWorkflowConfiguredAt: string | null;
  onRetentionPolicyClick: () => void;
  onSetPortalAddressClick: () => void;
}

export function ProgressChecklist({
  townId,
  sealUrl,
  subdomain,
  retentionAcknowledgedAt,
  minutesWorkflowConfiguredAt,
  onRetentionPolicyClick,
  onSetPortalAddressClick,
}: ProgressChecklistProps) {
  const supabase = useSupabase();

  // TODO(phase-e-wave-2): boardMember.countByTown (or equivalent) — no
  // procedure reads `board_member` for this yet; that table is board-
  // membership territory this wave (Task 5's own self-review notes: the
  // four board-member dialogs are wave 2's). `board.list` (below) already
  // covers the town's CONFIGURED seat total; this is the count of seats
  // actually FILLED, a different table this wave does not touch.
  const { data: memberCount = 0 } = useQuery({
    queryKey: [...queryKeys.members.all, "count", townId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("board_member")
        .select("*", { count: "exact", head: true })
        .eq("town_id", townId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!townId,
  });

  // `board.list`'s one read replaces two Supabase queries at once (total
  // configured seats, and how many boards have a notice template) — both
  // are aggregates over the same town-wide board scan `board.list` already
  // runs for `settings.meeting-notices.tsx`. No `WHERE town_id = ...` here:
  // `board.list` is already tenant-scoped by RLS (conventions item 2), and
  // it deliberately does not filter archived boards — see its own doc
  // comment — matching what these two Supabase queries did before this
  // migration (neither filtered `archived_at` either).
  const { data: boardRows = [] } = useQuery(trpc.board.list.queryOptions());

  const totalSeats = boardRows.reduce((sum, b) => sum + (b.member_count ?? 0), 0);
  const totalBoardCount = boardRows.length;
  const configuredTemplateCount = boardRows.filter((b) => b.notice_template_blocks !== null).length;
  const hasAllNoticeTemplates = totalBoardCount > 0 && configuredTemplateCount === totalBoardCount;

  const hasBoardMembers = memberCount > 0;
  const hasSeal = !!sealUrl;
  const hasSubdomain = !!subdomain;
  const hasMinutesWorkflow = !!minutesWorkflowConfiguredAt;
  const hasRetentionPolicy = !!retentionAcknowledgedAt;

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
      linkTo: "/boards",
    },
    {
      key: "meeting-notice",
      label: hasAllNoticeTemplates
        ? "Meeting notice templates configured"
        : `Set meeting notice templates (${configuredTemplateCount} of ${totalBoardCount} boards configured)`,
      description: "Customize how meeting notices are formatted",
      completed: hasAllNoticeTemplates,
      linkTo: "/settings/meeting-notices",
    },
    {
      key: "minutes-workflow",
      label: hasMinutesWorkflow
        ? "Minutes approval workflow configured"
        : "Configure minutes approval workflow",
      description: "Set up how draft minutes are reviewed and approved",
      completed: hasMinutesWorkflow,
      linkTo: "/settings/minutes-workflow",
    },
    {
      key: "town-seal",
      label: "Upload town seal",
      description: "Add your town seal for official documents",
      completed: hasSeal,
      linkTo: "/settings",
    },
    {
      key: "portal-subdomain",
      label: hasSubdomain
        ? `Public portal subdomain set (${subdomain})`
        : "Set public portal subdomain",
      description: "Choose your town's public URL",
      completed: hasSubdomain,
      // Always clickable, completed or not — a set subdomain can still be
      // changed (`town.setPortalAddress` accepts a new value at any time),
      // unlike the one-time retention-policy acknowledgment below.
      onClick: onSetPortalAddressClick,
    },
    {
      key: "retention-policy",
      label: "Acknowledge retention policy",
      description: "Required before your first meeting",
      completed: hasRetentionPolicy,
      required: true,
      onClick: hasRetentionPolicy ? undefined : onRetentionPolicyClick,
    },
  ];

  const completedCount = items.filter((i) => i.completed).length;
  const allComplete = completedCount === items.length;

  // Show success message when all items are complete
  if (allComplete) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <PartyPopper className="h-5 w-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">Setup complete!</p>
            <p className="text-xs text-muted-foreground">
              All setup items have been completed. Your town is ready.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Complete Your Setup</CardTitle>
        <CardDescription>
          Finish these items to get the most out of your town's workspace
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
                onClick={item.onClick}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
