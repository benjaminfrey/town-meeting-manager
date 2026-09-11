/**
 * The app's two honest connection signals — and there are exactly two,
 * because the SSE world has two things that can be disconnected.
 *
 * Phase E, wave 5, Task 6. What this file replaces was ONE component with a
 * `prominent` prop, mounted twice (a compact pill in `layouts/AppShell.tsx`,
 * a full-width banner in `routes/meetings.$meetingId.live.tsx`), both reading
 * one Supabase Realtime heartbeat channel (`"connection-heartbeat"`). That
 * worked only because the old transport was a single app-global WebSocket:
 * one socket, therefore one state, therefore one component could stand in for
 * both places.
 *
 * ─── How many connection states the SSE world needs ───────────────────────
 *
 * Three Supabase heartbeats existed whenever the live screen was open: the
 * eight `useRealtimeSubscription` channels (deleted in Task 4), this
 * component's own, and `lib/connection-error-handler.ts`'s
 * `"__global-connection-heartbeat__"` (deleted in this task). Zero survive.
 * "One shared connection state" is the obvious replacement and it is the
 * WRONG one, for a reason worth stating rather than assuming past:
 *
 *   1. **The live meeting's SSE stream.** One per open live meeting, opened by
 *      `hooks/useLiveMeetingEvents.ts`, and it exists on exactly one screen.
 *      It carries other devices' writes. Its health is meaningful on
 *      `live.tsx` and meaningless everywhere else — there is no stream to
 *      report on when you are looking at the board roster.
 *   2. **The browser's own reachability.** App-global, and it governs whether
 *      ANYTHING the user does reaches the server. TanStack Query already
 *      tracks it (`onlineManager`) and already acts on it: while offline,
 *      queries do not fire and mutations are PAUSED rather than failed
 *      (`networkMode: "online"`, the v5 default). So a user going offline sees
 *      a Save button that appears to do nothing, with no error, forever —
 *      exactly the silent-failure shape this phase exists to end.
 *
 * A single state cannot carry both: on `/boards` there is no stream, and on
 * `live.tsx` a healthy browser connection says nothing about whether the
 * stream is alive. Collapsing them is what made the old bar dishonest in the
 * first place — Task 4 moved the live screen to SSE and this component went on
 * reporting a Supabase socket that screen no longer used, i.e. showing green
 * while the transport that mattered was dead.
 *
 * So: two states, two components, one file — kept together so the next reader
 * comparing "which bar do I want" reads both in one place.
 */

import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import type { LiveStreamStatus } from "@/hooks/useLiveMeetingEvents";
import { cn } from "@/lib/utils";

/**
 * Whether the browser believes it can reach the network.
 *
 * `onlineManager` rather than `navigator.onLine` directly, deliberately: it is
 * the SAME object TanStack Query consults before running a query or pausing a
 * mutation, so the pill below cannot disagree with what the cache is actually
 * doing. A second `window.addEventListener("online", …)` of our own could.
 *
 * `useSyncExternalStore`'s third argument is the server snapshot. This app is
 * SPA-only (`packages/web` builds to `build/client/`), so it is unreachable
 * today; `true` is the right answer anyway — an SSR pass has no browser to be
 * offline, and rendering a persistent "Offline" pill into static HTML would be
 * wrong on every page load.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(() => onStoreChange()),
    () => onlineManager.isOnline(),
    () => true,
  );
}

interface ConnectionStatusBarProps {
  className?: string;
}

/**
 * The app shell's compact pill — mounted on every authenticated screen by
 * `layouts/AppShell.tsx`, and silent unless the browser is offline.
 *
 * **Behaviour preserved, source changed.** The old pill appeared when the
 * Supabase WebSocket dropped, which in practice meant "this device cannot
 * reach the server"; it now says that directly. What is DROPPED is the
 * intermediate `"connecting"` amber state, and that is deliberate rather than
 * an omission: `navigator.onLine` is a two-valued fact with no handshake to be
 * partway through, and there is no app-global socket left whose re-subscribe
 * could be in flight. Inventing a third state here would mean inventing a
 * timer with nothing to measure.
 */
export function ConnectionStatusBar({ className }: ConnectionStatusBarProps) {
  const online = useIsOnline();

  // Silent when there is nothing wrong — don't spend header space on "fine".
  if (online) {
    return null;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
        className,
      )}
      role="status"
      aria-live="polite"
      title="This device is offline. Anything you save now is held until the connection comes back."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Offline
    </div>
  );
}

interface LiveStreamStatusBarProps {
  /** From `useLiveMeetingEvents(meetingId)` — never derived a second time. */
  status: LiveStreamStatus;
  className?: string;
}

/**
 * The live meeting's full-width banner, driven by the one thing that actually
 * carries other devices' changes to this screen.
 *
 * Takes the status as a PROP rather than subscribing itself. The stream is
 * `useLiveMeetingEvents`'s, there is exactly one of it per meeting, and a
 * component that opened a second subscription just to render a colour would
 * cost a second SSE connection against the browser's six-per-origin HTTP/1.1
 * budget — the exact limit `packages/api/src/trpc/routers/realtime.ts`'s
 * header explains the one-stream design to stay inside.
 *
 * Two visible states, not three, and the split is the transport's own:
 * `reconnecting` is amber and `role="status"` because the client is still
 * trying and usually wins; `stopped` is red and `role="alert"` because a
 * `TRPCError` makes `httpSubscriptionLink` STOP, so nothing further will
 * happen without a reload. See `useLiveMeetingEvents` for why a routine
 * five-minute reconnect reaches neither.
 */
export function LiveStreamStatusBar({ status, className }: LiveStreamStatusBarProps) {
  if (status === "healthy") {
    return null;
  }

  const reconnecting = status === "reconnecting";

  return (
    <div
      className={cn(
        "w-full px-4 py-2 text-center text-sm font-medium",
        reconnecting
          ? "border-b border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          : "border-b border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
        className,
      )}
      role={reconnecting ? "status" : "alert"}
      aria-live={reconnecting ? "polite" : "assertive"}
    >
      {reconnecting
        ? "Live sync interrupted — reconnecting. Changes made on other devices may not appear yet."
        : "Live updates have stopped. Reload this page to see changes made on other devices."}
    </div>
  );
}
