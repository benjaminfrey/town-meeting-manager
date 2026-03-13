/**
 * Notification Permission Prompt
 *
 * Non-blocking banner shown after first login on a new device.
 * Prompts users to enable push notifications.
 *
 * Handles iOS specifically: push is only available on iOS 16.4+
 * when the PWA is installed to the home screen.
 */

import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { ErrorBoundary } from "react-error-boundary";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { cn } from "@/lib/utils";

const PERMANENT_DISMISS_KEY = "tmm-notification-prompt-dismissed";
const SESSION_DISMISS_KEY = "tmm-notification-prompt-session-dismissed";

function NotificationPromptInner() {
  const {
    isSupported,
    permission,
    isSubscribed,
    subscribe,
    isLoading,
  } = usePushNotifications();

  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Don't show if already subscribed, denied, or dismissed
    if (isSubscribed) return;
    if (permission === "denied") return;
    if (localStorage.getItem(PERMANENT_DISMISS_KEY) === "true") return;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY) === "true") return;

    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia(
      "(display-mode: standalone)",
    ).matches;
    setIsIOS(ios);
    setIsStandalone(standalone);

    // Show after a short delay so it doesn't compete with page load
    const timer = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(timer);
  }, [isSubscribed, permission]);

  const handleSubscribe = async () => {
    await subscribe();
    setVisible(false);
    toast.success("Notifications enabled");
  };

  const handleDismissSession = () => {
    sessionStorage.setItem(SESSION_DISMISS_KEY, "true");
    setVisible(false);
  };

  const handleDismissPermanent = () => {
    localStorage.setItem(PERMANENT_DISMISS_KEY, "true");
    setVisible(false);
  };

  if (!visible || !isSupported) return null;

  // iOS: must be installed as PWA first
  if (isIOS && !isStandalone) {
    return (
      <div
        className={cn(
          "fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-lg",
          "rounded-lg border bg-card p-4 shadow-lg",
          "animate-in slide-in-from-bottom-4 duration-300",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <Bell className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">
              Install the app first to enable notifications
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add Town Meeting Manager to your home screen, then you can enable push notifications.
            </p>
            <button
              onClick={handleDismissSession}
              className="mt-2 text-xs text-muted-foreground hover:underline"
            >
              Dismiss
            </button>
          </div>
          <button onClick={handleDismissSession} className="shrink-0 p-1 text-muted-foreground hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-lg",
        "rounded-lg border bg-card p-4 shadow-lg",
        "animate-in slide-in-from-bottom-4 duration-300",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <Bell className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Stay updated</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Get notified about upcoming meetings and published minutes
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleSubscribe}
              disabled={isLoading}
              className="rounded-md bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2b4f7a] disabled:opacity-50"
            >
              {isLoading ? "Enabling…" : "Enable notifications"}
            </button>
            <button
              onClick={handleDismissSession}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Not now
            </button>
            <button
              onClick={handleDismissPermanent}
              className="text-xs text-muted-foreground/60 underline-offset-2 hover:underline"
            >
              Don&apos;t ask again
            </button>
          </div>
        </div>
        <button onClick={handleDismissSession} className="shrink-0 p-1 text-muted-foreground hover:bg-muted rounded">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function NotificationPermissionPrompt() {
  return (
    <ErrorBoundary fallback={null}>
      <NotificationPermptInner />
    </ErrorBoundary>
  );
}

// Re-export with typo-free name (ErrorBoundary requires stable component reference)
const NotificationPermptInner = NotificationPromptInner;
