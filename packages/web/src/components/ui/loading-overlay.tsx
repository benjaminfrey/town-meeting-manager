import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingOverlayProps {
  /** Message to display beneath the spinner */
  message?: string;
  className?: string;
}

/**
 * Full-page semi-transparent overlay with centered spinner.
 * Use for long-running operations that block the entire UI (e.g. PDF generation).
 */
export function LoadingOverlay({ message = "Loading…", className }: LoadingOverlayProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm",
        className,
      )}
      role="status"
      aria-label={message}
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-8 shadow-lg">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">{message}</p>
      </div>
    </div>
  );
}
