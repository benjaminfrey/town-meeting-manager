/**
 * AgendaStatusBar — fixed bottom bar showing agenda stats.
 */

import { AGENDA_STATUS_LABELS } from "./meeting-labels";

interface AgendaStatusBarProps {
  itemCount: number;
  totalDuration: number;
  exhibitCount: number;
  agendaStatus: string;
}

export function AgendaStatusBar({
  itemCount,
  totalDuration,
  exhibitCount,
  agendaStatus,
}: AgendaStatusBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-10 border-t bg-background/95 backdrop-blur px-6 py-2">
      <div className="mx-auto flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          {itemCount} item{itemCount !== 1 ? "s" : ""}
        </span>
        <span className="text-border">|</span>
        <span>
          {totalDuration > 0
            ? `${totalDuration} min estimated`
            : "No duration estimates"}
        </span>
        <span className="text-border">|</span>
        <span>
          {exhibitCount} exhibit{exhibitCount !== 1 ? "s" : ""}
        </span>
        <span className="text-border">|</span>
        <span className="font-medium">
          {AGENDA_STATUS_LABELS[agendaStatus] ?? agendaStatus}
        </span>
      </div>
    </div>
  );
}
