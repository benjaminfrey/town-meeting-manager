/**
 * PWA Integration Tests
 *
 * Verifies the service worker configuration, manifest structure,
 * offline fallback, and push notification subscription flow.
 *
 * These are unit/integration tests — no browser or Playwright required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Paths ────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const WEB_PKG = path.join(PROJECT_ROOT, "packages/web");
const PUBLIC_DIR = path.join(WEB_PKG, "public");
const SRC_DIR = path.join(WEB_PKG, "src");

// ─── Manifest Tests ───────────────────────────────────────────────────

describe("Web App Manifest (public/manifest.json)", () => {
  let manifest: Record<string, unknown>;

  beforeEach(() => {
    const manifestPath = path.join(PUBLIC_DIR, "manifest.json");
    expect(fs.existsSync(manifestPath), "manifest.json must exist in public/").toBe(true);
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  });

  it("has required PWA fields: name, short_name, start_url, display", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
  });

  it("has correct theme_color matching brand color #1e3a5f", () => {
    expect(manifest.theme_color).toBe("#1e3a5f");
  });

  it("has background_color defined", () => {
    expect(manifest.background_color).toBeTruthy();
  });

  it("has at least two icons (192px and 512px)", () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; type: string }>;
    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThanOrEqual(2);

    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("all icons have src, sizes, and type fields", () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; type: string }>;
    for (const icon of icons) {
      expect(icon.src, `icon missing src`).toBeTruthy();
      expect(icon.sizes, `icon ${icon.src} missing sizes`).toBeTruthy();
      expect(icon.type, `icon ${icon.src} missing type`).toBeTruthy();
    }
  });

  it("has a maskable icon variant", () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    const hasMaskable = icons.some((i) => i.purpose?.includes("maskable"));
    expect(hasMaskable).toBe(true);
  });
});

// ─── Offline Fallback Tests ───────────────────────────────────────────

describe("Offline fallback page (public/offline.html)", () => {
  let offlineHtml: string;

  beforeEach(() => {
    const offlinePath = path.join(PUBLIC_DIR, "offline.html");
    expect(fs.existsSync(offlinePath), "offline.html must exist in public/").toBe(true);
    offlineHtml = fs.readFileSync(offlinePath, "utf8");
  });

  it("is valid HTML with a title", () => {
    expect(offlineHtml).toContain("<html");
    expect(offlineHtml).toContain("<title");
  });

  it("contains user-facing offline message", () => {
    // Should mention being offline or connection
    const lowerHtml = offlineHtml.toLowerCase();
    const hasOfflineText =
      lowerHtml.includes("offline") ||
      lowerHtml.includes("connection") ||
      lowerHtml.includes("internet");
    expect(hasOfflineText).toBe(true);
  });

  it("contains a link back to the app (dashboard or home)", () => {
    // Should have a link or button to go back
    const hasLink = offlineHtml.includes("<a ") || offlineHtml.includes("<button");
    expect(hasLink).toBe(true);
  });

  it("has inline styles (no external CSS dependencies when offline)", () => {
    // Should not rely on external stylesheets
    const hasExternalCss = offlineHtml.includes('<link rel="stylesheet"');
    expect(hasExternalCss).toBe(false);
  });
});

// ─── Service Worker Source Tests ─────────────────────────────────────

describe("Service Worker source (src/sw.ts)", () => {
  let swSource: string;

  beforeEach(() => {
    const swPath = path.join(SRC_DIR, "sw.ts");
    expect(fs.existsSync(swPath), "sw.ts must exist in src/").toBe(true);
    swSource = fs.readFileSync(swPath, "utf8");
  });

  it("imports workbox precaching and routing", () => {
    expect(swSource).toContain("workbox-precaching");
    expect(swSource).toContain("workbox-routing");
  });

  it("calls precacheAndRoute with injection manifest", () => {
    expect(swSource).toContain("precacheAndRoute");
    // The injection point for the build manifest
    expect(swSource).toContain("self.__WB_MANIFEST");
  });

  it("includes cache strategies from workbox-strategies", () => {
    expect(swSource).toContain("workbox-strategies");
  });

  it("registers a push event listener", () => {
    // Match either single- or double-quoted "push" in addEventListener call
    expect(swSource).toMatch(/addEventListener\(["']push["']/);
    expect(swSource).toContain("showNotification");
  });

  it("registers a notificationclick event listener", () => {
    expect(swSource).toContain("notificationclick");
    expect(swSource).toContain("clients");
  });

  it("cleans up outdated caches on activation", () => {
    expect(swSource).toContain("cleanupOutdatedCaches");
  });
});

// ─── Vite PWA Config Tests ────────────────────────────────────────────

describe("Vite config (vite.config.ts)", () => {
  let viteConfig: string;

  beforeEach(() => {
    const configPath = path.join(WEB_PKG, "vite.config.ts");
    expect(fs.existsSync(configPath), "vite.config.ts must exist").toBe(true);
    viteConfig = fs.readFileSync(configPath, "utf8");
  });

  it("imports and uses VitePWA plugin", () => {
    expect(viteConfig).toContain("VitePWA");
    expect(viteConfig).toContain("vite-plugin-pwa");
  });

  it("uses injectManifest strategy (not generateSW)", () => {
    expect(viteConfig).toContain("injectManifest");
    expect(viteConfig).toContain(`strategies: "injectManifest"`);
  });

  it("points to sw.ts as the custom service worker source", () => {
    expect(viteConfig).toContain(`filename: "sw.ts"`);
    expect(viteConfig).toContain(`srcDir: "src"`);
  });

  it("disables PWA in dev mode to avoid HMR conflicts", () => {
    expect(viteConfig).toContain("devOptions");
    expect(viteConfig).toContain("enabled: false");
  });

  it("sets manifest:false to use manual manifest.json", () => {
    expect(viteConfig).toContain("manifest: false");
  });
});

// ─── usePushNotifications Hook Tests ─────────────────────────────────

describe("usePushNotifications source (src/hooks/usePushNotifications.ts)", () => {
  let hookSource: string;

  beforeEach(() => {
    const hookPath = path.join(SRC_DIR, "hooks/usePushNotifications.ts");
    expect(fs.existsSync(hookPath), "usePushNotifications.ts must exist").toBe(true);
    hookSource = fs.readFileSync(hookPath, "utf8");
  });

  it("detects PushManager support", () => {
    expect(hookSource).toContain("PushManager");
    expect(hookSource).toContain("serviceWorker");
  });

  it("requests notification permission before subscribing", () => {
    expect(hookSource).toContain("Notification.requestPermission");
  });

  it("converts VAPID key from base64 to Uint8Array", () => {
    // VAPID key conversion is required for pushManager.subscribe
    const hasConversion =
      hookSource.includes("urlBase64ToUint8Array") ||
      hookSource.includes("atob") ||
      hookSource.includes("Uint8Array");
    expect(hasConversion).toBe(true);
  });

  it("POSTs subscription to /api/notifications/push/subscribe", () => {
    expect(hookSource).toContain("/api/notifications/push/subscribe");
  });

  it("DELETEs subscription at /api/notifications/push/unsubscribe on unsubscribe", () => {
    expect(hookSource).toContain("/api/notifications/push/unsubscribe");
  });

  it("handles the case where push is not supported", () => {
    const handlesUnsupported =
      hookSource.includes("isSupported") ||
      hookSource.includes("'PushManager' in window") ||
      hookSource.includes("\"PushManager\" in window");
    expect(handlesUnsupported).toBe(true);
  });
});

// ─── UpdateNotification Component Tests ──────────────────────────────

describe("UpdateNotification component (src/components/pwa/UpdateNotification.tsx)", () => {
  let source: string;

  beforeEach(() => {
    const componentPath = path.join(SRC_DIR, "components/pwa/UpdateNotification.tsx");
    expect(fs.existsSync(componentPath), "UpdateNotification.tsx must exist").toBe(true);
    source = fs.readFileSync(componentPath, "utf8");
  });

  it("dynamically imports virtual:pwa-register (not static import)", () => {
    // Should use dynamic import to handle dev mode gracefully
    expect(source).toContain('import("virtual:pwa-register")');
    expect(source).not.toContain('from "virtual:pwa-register"');
  });

  it("handles import failure gracefully (catch block for dev mode)", () => {
    expect(source).toContain(".catch(");
  });

  it("shows a toast notification for update", () => {
    expect(source).toContain("toast");
    expect(source).toContain("Update");
  });

  it("polls for updates via registration.update()", () => {
    expect(source).toContain("registration.update");
    expect(source).toContain("setInterval");
  });
});

// ─── InstallBanner Component Tests ───────────────────────────────────

describe("InstallBanner component (src/components/pwa/InstallBanner.tsx)", () => {
  let source: string;

  beforeEach(() => {
    const componentPath = path.join(SRC_DIR, "components/pwa/InstallBanner.tsx");
    expect(fs.existsSync(componentPath), "InstallBanner.tsx must exist").toBe(true);
    source = fs.readFileSync(componentPath, "utf8");
  });

  it("listens for beforeinstallprompt event", () => {
    expect(source).toContain("beforeinstallprompt");
  });

  it("detects iOS for Safari-specific instructions", () => {
    expect(source).toContain("iPhone");
    expect(source).toContain("iPad");
  });

  it("persists 'don't show again' preference to localStorage", () => {
    expect(source).toContain("localStorage");
    expect(source).toContain("DISMISS_KEY");
  });

  it("shows after a delay (SHOW_DELAY_MS)", () => {
    expect(source).toContain("SHOW_DELAY_MS");
    expect(source).toContain("setTimeout");
  });

  it("listens for appinstalled to auto-hide after successful install", () => {
    expect(source).toContain("appinstalled");
  });
});

// ─── API Push Routes Tests ────────────────────────────────────────────

describe("Push notification API routes (packages/api/src/routes/notifications.ts)", () => {
  let routeSource: string;

  beforeEach(() => {
    const routePath = path.join(PROJECT_ROOT, "packages/api/src/routes/notifications.ts");
    expect(fs.existsSync(routePath), "notifications.ts route must exist").toBe(true);
    routeSource = fs.readFileSync(routePath, "utf8");
  });

  it("defines POST /api/notifications/push/subscribe endpoint", () => {
    expect(routeSource).toContain("push/subscribe");
    expect(routeSource).toContain("post");
  });

  it("defines DELETE /api/notifications/push/unsubscribe endpoint", () => {
    expect(routeSource).toContain("push/unsubscribe");
    expect(routeSource).toContain("delete");
  });

  it("validates subscription endpoint field with Zod", () => {
    expect(routeSource).toContain("endpoint");
    expect(routeSource).toContain("z.");
  });

  it("has a test push endpoint (dev-only)", () => {
    expect(routeSource).toContain("test/push");
  });
});

// ─── push_subscription Migration Tests ───────────────────────────────

describe("push_subscription database migration", () => {
  it("migration file exists", () => {
    const migrationsDir = path.join(PROJECT_ROOT, "supabase/migrations");
    const migrations = fs.readdirSync(migrationsDir);
    const pushMigration = migrations.find((f) => f.includes("push_subscription"));
    expect(pushMigration, "No push_subscription migration found").toBeTruthy();
  });

  it("migration defines push_subscription table with required columns", () => {
    const migrationsDir = path.join(PROJECT_ROOT, "supabase/migrations");
    const migrations = fs.readdirSync(migrationsDir);
    const pushMigration = migrations.find((f) => f.includes("push_subscription"))!;
    const sql = fs.readFileSync(path.join(migrationsDir, pushMigration), "utf8");

    expect(sql).toContain("push_subscription");
    expect(sql).toContain("endpoint");
    expect(sql).toContain("p256dh");
    expect(sql).toContain("auth");
    expect(sql).toContain("user_account_id");
  });
});
