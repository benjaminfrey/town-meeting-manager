/**
 * MeetingLifecycle — the product's spine, made visible.
 *
 * Every meeting moves Draft → Noticed → In meeting → Minutes → Published.
 * Showing this (with live counts) is the clearest signal of what the app does.
 * Reused on Home (counts) and on the meeting sub-nav header (current stage).
 *
 * ─── The last stage says what it shows (backlog 9, closed) ───────────────
 *
 * Two strings used to sit in the stage definitions below that are not
 * `meeting_status` values at all: `"in_progress"` on the `meeting` stage and
 * `"published"` on the last one. The enum is
 * `draft, noticed, open, adjourned, minutes_draft, approved, cancelled`
 * (`0000_baseline.sql`), and `SELECT 'in_progress'::meeting_status` raises
 * "invalid input value for enum meeting_status" against a live database;
 * `"published"` was a `minutes_document_status` borrowed by mistake. Both
 * matched nothing, so removing them changed no behaviour.
 *
 * The label did change, and deliberately (owner decision 2026-09-20). The last
 * stage matches `approved` — a meeting whose minutes were adopted — and
 * calling it "Published" promised a state the `meeting` table cannot
 * represent: publication is a property of the minutes DOCUMENT, and this rail
 * reads meetings. It now reads "Approved", which is what it has always shown.
 * Whether a genuine published-to-portal stage should exist is a separate
 * product question, not a mislabel.
 */

import { cn } from "@/lib/utils";

export const LIFECYCLE_STAGES = [
  { key: "draft", label: "Draft", statuses: ["draft"] },
  { key: "noticed", label: "Noticed", statuses: ["noticed"] },
  { key: "meeting", label: "In meeting", statuses: ["open"] },
  { key: "minutes", label: "Minutes", statuses: ["adjourned", "minutes_draft"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
] as const;

export type LifecycleStageKey = (typeof LIFECYCLE_STAGES)[number]["key"];

/** Map a raw meeting status to its lifecycle stage key (or null). */
export function lifecycleStageForStatus(status: string): LifecycleStageKey | null {
  const stage = LIFECYCLE_STAGES.find((s) => (s.statuses as readonly string[]).includes(status));
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
    approved: 0,
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
      className={cn("flex overflow-hidden rounded-lg border bg-card", className)}
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
                isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
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
