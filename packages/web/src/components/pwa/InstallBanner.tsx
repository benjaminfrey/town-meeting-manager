/**
 * PWA Install Banner
 *
 * Shows a non-blocking install prompt at the bottom of the screen.
 * - Listens for `beforeinstallprompt` (Chrome/Edge/Samsung)
 * - Shows iOS-specific instructions when on Safari
 * - Respects "Don't show again" preference in localStorage
 * - Auto-shows after 30 seconds in the app
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Download, Share } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "tmm-install-banner-dismissed";
const SHOW_DELAY_MS = 30_000;

export function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Already installed as standalone?
    const standalone = window.matchMedia(
      "(display-mode: standalone)",
    ).matches;
    setIsStandalone(standalone);
    if (standalone) return;

    // User dismissed permanently?
    if (localStorage.getItem(DISMISS_KEY) === "true") return;

    // Detect iOS
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsIOS(ios);

    if (ios) {
      // iOS: show after delay (no beforeinstallprompt event)
      timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      return () => clearTimeout(timerRef.current);
    }

    // Standard platforms: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      // Show after delay
      timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Listen for successful install
    const installed = () => {
      setVisible(false);
      toast.success("Town Meeting Manager installed successfully!");
    };
    window.addEventListener("appinstalled", installed);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
      clearTimeout(timerRef.current);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPromptRef.current) {
      await deferredPromptRef.current.prompt();
      const { outcome } = await deferredPromptRef.current.userChoice;
      if (outcome === "accepted") {
        setVisible(false);
      }
      deferredPromptRef.current = null;
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const handleDismissPermanently = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, "true");
    setVisible(false);
  }, []);

  if (!visible || isStandalone) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg",
        "rounded-lg border bg-card p-4 shadow-lg",
        "animate-in slide-in-from-bottom-4 duration-300",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1e3a5f] text-white">
          {isIOS ? (
            <Share className="h-5 w-5" />
          ) : (
            <Download className="h-5 w-5" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            Install Town Meeting Manager
          </p>
          {isIOS ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tap the{" "}
              <Share className="inline h-3 w-3 -mt-0.5" /> Share button, then
              &ldquo;Add to Home Screen&rdquo;
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Get quick access from your home screen
            </p>
          )}

          {/* Actions */}
          <div className="mt-2 flex items-center gap-2">
            {!isIOS && (
              <button
                onClick={handleInstall}
                className="rounded-md bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2b4f7a]"
              >
                Install
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Not now
            </button>
            <button
              onClick={handleDismissPermanently}
              className="text-xs text-muted-foreground/60 underline-offset-2 hover:underline"
            >
              Don&apos;t show again
            </button>
          </div>
        </div>

        {/* Close */}
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
