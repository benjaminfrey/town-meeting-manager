/**
 * MeetingLifecycle — the product's spine, made visible.
 *
 * Every meeting moves Draft → Noticed → In meeting → Minutes → Published.
 * Showing this (with live counts) is the clearest signal of what the app does.
 * Reused on Home (counts) and on the meeting sub-nav header (current stage).
 *
 * ─── A dead status vocabulary, audited rather than missed ────────────────
 *
 * `"in_progress"` (the `meeting` stage) and `"published"` (the `published`
 * stage) below are not `meeting_status` values: the enum is
 * `draft, noticed, open, adjourned, minutes_draft, approved, cancelled`
 * (`0000_baseline.sql`), and `SELECT 'in_progress'::meeting_status` raises
 * "invalid input value for enum meeting_status" against a live database.
 * `"published"` is a `minutes_document_status`, borrowed by mistake. Both are
 * inert — no row has ever matched either — but this is the one file of the
 * three that carry them where the dead values are user-visible, not merely
 * unreachable: the `published` stage below renders a "Published" pill no
 * meeting can ever reach, and `components/meetings/meeting-labels.ts`'s
 * `MEETING_STATUS_LABELS` has no entry for `in_progress` or for the
 * `approved`+`published` pair this stage's `statuses` matches on, so a row
 * that somehow got there would render with no label. `home.tsx` and
 * `meetings.tsx` both carry the identical two values and both NAME them in a
 * header comment (wave 6, Task 5) rather than delete them, because the real
 * fix is a product decision (what should this stage actually show) shared
 * across all three files, not something to smuggle into a transport task —
 * see `docs/backlog.md` entry 9 for the retirement condition.
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
