/**
 * PWA Update Notification
 *
 * When vite-plugin-pwa detects a new service worker waiting to activate,
 * shows a toast prompting the user to reload for the latest version.
 *
 * In dev mode, vite-plugin-pwa is disabled so this component renders nothing.
 * The virtual:pwa-register module is only available in production builds.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

export function UpdateNotification() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateFn, setUpdateFn] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    // Dynamic import — virtual:pwa-register is only available in production builds
    // when vite-plugin-pwa is enabled. In dev it will fail silently.
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        const updateSW = registerSW({
          onNeedRefresh() {
            setNeedRefresh(true);
            setUpdateFn(() => updateSW);
          },
          onRegistered(registration) {
            if (registration) {
              // Check for updates every 60 minutes
              setInterval(() => {
                void registration.update();
              }, 60 * 60 * 1000);
            }
          },
          onRegisterError(error) {
            console.error("Service worker registration error:", error);
          },
        });
      })
      .catch(() => {
        // Expected in dev mode — virtual module not available
      });
  }, []);

  useEffect(() => {
    if (needRefresh && updateFn) {
      toast(
        <div className="flex items-center gap-3">
          <RefreshCw className="h-4 w-4 shrink-0 text-blue-600" />
          <div className="flex-1">
            <p className="text-sm font-medium">Update available</p>
            <p className="text-xs text-muted-foreground">
              A new version of Town Meeting Manager is ready.
            </p>
          </div>
          <button
            onClick={() => void updateFn(true)}
            className="shrink-0 rounded-md bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2b4f7a]"
          >
            Update now
          </button>
        </div>,
        {
          duration: Infinity,
          dismissible: true,
          id: "pwa-update",
        },
      );
    }
  }, [needRefresh, updateFn]);

  return null;
}
