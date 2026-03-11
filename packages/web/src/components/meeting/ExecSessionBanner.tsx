/**
 * Executive Session Banner — displayed at the top of the live meeting
 * interface while the board is in executive session.
 *
 * Shows the statutory citation, elapsed timer, and a button to return
 * to public session. No content capture occurs during executive session.
 */

import { Lock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MeetingTimer } from "./MeetingTimer";

interface ExecSessionBannerProps {
  citation: string;
  enteredAt: string;
  onReturnToPublic: () => void;
}

export function ExecSessionBanner({
  citation,
  enteredAt,
  onReturnToPublic,
}: ExecSessionBannerProps) {
  return (
    <div className="border-b border-red-300 bg-red-50 px-6 py-3 dark:border-red-900 dark:bg-red-950/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lock className="h-5 w-5 text-red-600 dark:text-red-400" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">
              EXECUTIVE SESSION IN PROGRESS
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">
              {citation} — Public recording paused
            </p>
          </div>
          <div className="ml-4 rounded bg-red-100 px-2 py-0.5 text-xs font-mono text-red-700 dark:bg-red-900/50 dark:text-red-300">
            <MeetingTimer startedAt={enteredAt} />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/50"
          onClick={onReturnToPublic}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Return to Public Session
        </Button>
      </div>
    </div>
  );
}
