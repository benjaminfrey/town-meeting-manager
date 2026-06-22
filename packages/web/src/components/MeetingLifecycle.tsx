/**
 * MeetingLifecycle — the product's spine, made visible.
 *
 * Every meeting moves Draft → Noticed → In meeting → Minutes → Published.
 * Showing this (with live counts) is the clearest signal of what the app does.
 * Reused on Home (counts) and on the meeting sub-nav header (current stage).
 */

import { cn } from "@/lib/utils";

export const LIFECYCLE_STAGES = [
  { key: "draft", label: "Draft", statuses: ["draft"] },
  { key: "noticed", label: "Noticed", statuses: ["noticed"] },
  { key: "meeting", label: "In meeting", statuses: ["open", "in_progress"] },
  { key: "minutes", label: "Minutes", statuses: ["adjourned", "minutes_draft"] },
  { key: "published", label: "Published", statuses: ["approved", "published"] },
] as const;

export type LifecycleStageKey = (typeof LIFECYCLE_STAGES)[number]["key"];

/** Map a raw meeting status to its lifecycle stage key (or null). */
export function lifecycleStageForStatus(status: string): LifecycleStageKey | null {
  const stage = LIFECYCLE_STAGES.find((s) =>
    (s.statuses as readonly string[]).includes(status),
  );
  return stage ? stage.key : null;
}

/** Tally meetings into lifecycle-stage counts. */
export function computeLifecycleCounts(
  meetings: Array<{ status?: string | null }>,
): Record<LifecycleStageKey, number> {
  const counts: Record<LifecycleStageKey, number> = {
    draft: 0,
    noticed: 0,
    meeting: 0,
    minutes: 0,
    published: 0,
  };
  for (const m of meetings) {
    const key = lifecycleStageForStatus(m.status ?? "");
    if (key) counts[key]++;
  }
  return counts;
}

/**
 * The lifecycle bar. Pass `counts` to show tallies (Home), or `current` to
 * highlight the active stage (meeting header).
 */
export function MeetingLifecycle({
  counts,
  current,
  className,
}: {
  counts?: Record<LifecycleStageKey, number>;
  current?: LifecycleStageKey | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-lg border bg-card",
        className,
      )}
      role="group"
      aria-label="Meeting lifecycle"
    >
      {LIFECYCLE_STAGES.map((stage, i) => {
        const isCurrent = current === stage.key;
        return (
          <div
            key={stage.key}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex-1 px-2 py-3 text-center",
              i > 0 && "border-l",
              isCurrent && "bg-primary/5",
            )}
          >
            {counts && (
              <div
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  (counts[stage.key] ?? 0) === 0 && "text-muted-foreground/50",
                )}
              >
                {counts[stage.key] ?? 0}
              </div>
            )}
            <div
              className={cn(
                "text-xs",
                isCurrent
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {stage.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
