/**
 * usePushNotifications hook
 *
 * Manages Web Push subscription lifecycle:
 * - Checks browser support and current permission state
 * - Subscribes to push via PushManager + sends subscription to API
 * - Unsubscribes and removes subscription from API
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export type PushPermissionState = "default" | "granted" | "denied";

export interface UsePushNotificationsReturn {
  isSupported: boolean;
  permission: PushPermissionState;
  isSubscribed: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  isLoading: boolean;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const isSupported =
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "serviceWorker" in navigator;

  const [permission, setPermission] = useState<PushPermissionState>(
    isSupported ? (Notification.permission as PushPermissionState) : "denied",
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as
    | string
    | undefined;

  // Check existing subscription on mount
  useEffect(() => {
    if (!isSupported) return;
    void navigator.serviceWorker.ready.then((registration) => {
      void registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      });
    });
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !vapidPublicKey) return;
    setIsLoading(true);
    try {
      // Request permission if not granted
      if (Notification.permission !== "granted") {
        const result = await Notification.requestPermission();
        setPermission(result as PushPermissionState);
        if (result !== "granted") return;
      }

      // Subscribe to push
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // Send to API
      const keys = subscription.toJSON().keys!;
      const token = await getToken();
      await fetch("/api/notifications/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          userAgent: navigator.userAgent,
        }),
      });

      setIsSubscribed(true);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, vapidPublicKey]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        const token = await getToken();
        await fetch("/api/notifications/push/unsubscribe", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        setIsSubscribed(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  return { isSupported, permission, isSubscribed, subscribe, unsubscribe, isLoading };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

async function getToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}
