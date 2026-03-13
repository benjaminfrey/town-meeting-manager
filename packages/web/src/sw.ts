/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

// ─── Precache ────────────────────────────────────────────────────────

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── Lifecycle ───────────────────────────────────────────────────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Runtime cache strategies ────────────────────────────────────────

// Static assets (content-hashed) — CacheFirst
registerRoute(
  ({ request }) =>
    ["style", "script", "worker"].includes(request.destination),
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 365 * 24 * 60 * 60,
      }),
    ],
  }),
);

// HTML pages — NetworkFirst
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "html-pages",
      plugins: [
        new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 24 * 60 * 60 }),
      ],
    }),
    { denylist: [/^\/api\//] },
  ),
);

// Fastify API calls — NetworkFirst with timeout
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "api-responses",
    networkTimeoutSeconds: 3,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 }),
    ],
  }),
);

// Supabase REST and Auth APIs — NetworkFirst (React Query handles in-memory caching)
registerRoute(
  ({ url }) =>
    url.pathname.startsWith("/rest/v1/") ||
    url.pathname.startsWith("/auth/v1/"),
  new NetworkFirst({ networkTimeoutSeconds: 5 }),
);

// Images — StaleWhileRevalidate
registerRoute(
  ({ request }) => request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: "images",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  }),
);

// ─── Push notification handler ───────────────────────────────────────

interface PushData {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
}

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  const data = event.data.json() as PushData;

  const notificationPromise = self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon ?? "/icons/icon-192.png",
    badge: data.badge ?? "/icons/icon-maskable-192.png",
    tag: data.tag,
    data: { url: data.url ?? "/dashboard" },
  });

  event.waitUntil(notificationPromise);
});

// ─── Notification click handler ──────────────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data?.url as string) ?? "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // If the app is already open, focus it and navigate
        for (const client of clients) {
          if ("focus" in client && "navigate" in client) {
            return (client as WindowClient)
              .focus()
              .then((c) => c.navigate(url));
          }
        }
        // Otherwise, open a new window
        return self.clients.openWindow(url);
      }),
  );
});
