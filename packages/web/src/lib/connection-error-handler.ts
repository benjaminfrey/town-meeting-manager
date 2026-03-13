/**
 * Connection Error Handler
 *
 * Manages Supabase Realtime connection state and coordinates recovery:
 * - Tracks connection status (connected / connecting / disconnected)
 * - On reconnect: invalidates all TanStack Query caches so stale data is
 *   refetched automatically, ensuring the UI reflects the latest server state
 * - Categorizes mutation errors as retriable (network) vs. permanent (auth/validation)
 *
 * Usage: call `initConnectionErrorHandler(supabase, queryClient)` once at app
 * startup (inside a useEffect in the root provider, for example).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type ConnectionState = "connected" | "connecting" | "disconnected";

/** Supabase Realtime CHANNEL_ERROR code shape */
interface RealtimeCloseEvent {
  code?: number;
  reason?: string;
}

let currentState: ConnectionState = "connecting";

/**
 * Initialize the global connection error handler.
 * Call this once — typically in a top-level provider or useEffect.
 *
 * @returns cleanup function that unsubscribes from Realtime events
 */
export function initConnectionErrorHandler(
  supabase: SupabaseClient,
  queryClient: QueryClient,
): () => void {
  // Use a dedicated heartbeat channel to track global Realtime health.
  // This channel does NOT subscribe to any table changes — it purely monitors
  // the WebSocket connection state.
  const heartbeat = supabase
    .channel("__global-connection-heartbeat__", {
      config: { broadcast: { ack: false } },
    })
    .subscribe((status, err) => {
      const previous = currentState;

      if (status === "SUBSCRIBED") {
        currentState = "connected";

        if (previous === "disconnected" || previous === "connecting") {
          // Reconnected after a drop — invalidate all queries so stale data
          // is refetched silently in the background.
          void queryClient.invalidateQueries();

          if (previous === "disconnected") {
            toast.info("Connection restored. Data refreshed.", {
              id: "realtime-reconnected",
              duration: 3000,
            });
          }
        }
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        currentState = "disconnected";

        const closeEvent = err as RealtimeCloseEvent | undefined;
        const code = closeEvent?.code;

        // 4001 / 4004 = auth failure (JWT expired and could not refresh)
        if (code === 4001 || code === 4004) {
          toast.error(
            "Session expired. Please refresh the page to sign back in.",
            { id: "realtime-auth-error", duration: Infinity },
          );
        }
        // 1000 / 1001 = normal close (e.g. user navigated away) — don't toast
      } else {
        // JOINING, etc.
        currentState = "connecting";
      }
    });

  return () => {
    void supabase.removeChannel(heartbeat);
  };
}

/**
 * Categorize a mutation error so callers can decide whether to show
 * a "try again" toast (retriable) or a specific denial message (permanent).
 */
export type MutationErrorKind =
  | "network"      // Offline or timeout — user can retry
  | "permission"   // RLS denied or 403 — user action required
  | "validation"   // 400 / constraint violation — fix the data
  | "conflict"     // 409 — concurrent edit
  | "unknown";

export function categorizeMutationError(error: unknown): MutationErrorKind {
  if (!error) return "unknown";

  // Supabase PostgREST error shape: { code, message, details, hint }
  const pgError = error as { code?: string; message?: string; status?: number };

  // Network error (fetch failed, no response)
  if (
    error instanceof TypeError &&
    error.message.toLowerCase().includes("fetch")
  ) {
    return "network";
  }

  // Supabase HTTP status codes
  if (pgError.status === 403 || pgError.code === "PGRST301") return "permission";
  if (pgError.status === 409) return "conflict";
  if (pgError.status === 400 || pgError.code?.startsWith("23")) return "validation";

  // PostgreSQL RLS violation
  if (pgError.message?.includes("row-level security")) return "permission";
  if (pgError.message?.includes("permission denied")) return "permission";

  return "unknown";
}

/**
 * Returns a user-friendly toast message for a mutation error.
 * Use in `useMutation`'s `onError` callback.
 */
export function getMutationErrorMessage(error: unknown): string {
  const kind = categorizeMutationError(error);

  switch (kind) {
    case "network":
      return "Connection lost. Please check your network and try again.";
    case "permission":
      return "You don't have permission to make this change.";
    case "validation":
      return "The data could not be saved. Please check the form and try again.";
    case "conflict":
      return "This record was updated by someone else. Please refresh and retry.";
    default:
      return "Could not save your changes. Please try again.";
  }
}
