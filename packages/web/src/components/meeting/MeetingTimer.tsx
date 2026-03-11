/**
 * Timer display for live meetings.
 *
 * Shows elapsed time from a stored timestamp, with optional
 * estimated duration for progress tracking. Colors shift from
 * green → amber → red when over the estimated time.
 */

import { useMeetingTimer } from "@/hooks/useMeetingTimer";
import { cn } from "@/lib/utils";

interface MeetingTimerProps {
  startedAt: string | null;
  estimatedDuration?: number | null; // minutes
  label?: string;
  className?: string;
}

export function MeetingTimer({
  startedAt,
  estimatedDuration,
  label,
  className,
}: MeetingTimerProps) {
  const { elapsedSeconds, formatted } = useMeetingTimer(startedAt);

  if (!startedAt) return null;

  const elapsedMinutes = elapsedSeconds / 60;
  let colorClass = "text-foreground";

  if (estimatedDuration && estimatedDuration > 0) {
    const ratio = elapsedMinutes / estimatedDuration;
    if (ratio > 1.5) {
      colorClass = "text-red-500";
    } else if (ratio > 1) {
      colorClass = "text-amber-500";
    } else {
      colorClass = "text-green-600";
    }
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <span className={cn("font-mono text-sm font-medium tabular-nums", colorClass)}>
        {formatted}
      </span>
      {estimatedDuration && estimatedDuration > 0 && (
        <span className="text-xs text-muted-foreground">
          / {estimatedDuration}m
        </span>
      )}
    </div>
  );
}
