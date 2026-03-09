/**
 * Sync status indicator for the app header.
 *
 * Shows the current PowerSync sync status with appropriate icons:
 * - Connected & synced (green wifi)
 * - Downloading data (blue cloud download, animated)
 * - Uploading local changes (blue cloud upload, animated)
 * - Disconnected / offline (red wifi off)
 *
 * Uses the useStatus() hook from @powersync/react for real-time status.
 */

import { useStatus } from "@powersync/react";
import {
  Wifi,
  WifiOff,
  CloudDownload,
  CloudUpload,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function SyncStatusBar() {
  const status = useStatus();

  // Determine display state from PowerSync status
  const isConnected = status.connected;
  const isUploading = status.dataFlowStatus?.uploading ?? false;
  const isDownloading = status.dataFlowStatus?.downloading ?? false;
  const hasSynced = status.hasSynced ?? false;

  // Pick icon and label based on current state
  let icon: React.ReactNode;
  let label: string;
  let colorClass: string;

  if (!isConnected) {
    icon = <WifiOff className="h-4 w-4" />;
    label = "Offline";
    colorClass = "text-muted-foreground";
  } else if (isDownloading) {
    icon = <CloudDownload className="h-4 w-4 animate-pulse" />;
    label = "Syncing...";
    colorClass = "text-blue-500";
  } else if (isUploading) {
    icon = <CloudUpload className="h-4 w-4 animate-pulse" />;
    label = "Uploading...";
    colorClass = "text-blue-500";
  } else if (isConnected && hasSynced) {
    icon = <Wifi className="h-4 w-4" />;
    label = "Synced";
    colorClass = "text-green-500";
  } else if (isConnected && !hasSynced) {
    icon = <Loader2 className="h-4 w-4 animate-spin" />;
    label = "Connecting...";
    colorClass = "text-yellow-500";
  } else {
    icon = <WifiOff className="h-4 w-4" />;
    label = "Offline";
    colorClass = "text-muted-foreground";
  }

  return (
    <div
      className={cn("flex items-center gap-1.5 text-sm", colorClass)}
      title={`Sync status: ${label}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
