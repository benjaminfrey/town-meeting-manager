/**
 * Re-export PowerSync React hooks for convenient access.
 *
 * Available hooks:
 * - usePowerSync(): Access the raw PowerSync database instance
 * - useQuery(sql, params): Execute a watched SQL query (re-renders on data change)
 * - useStatus(): Get the current sync status (connected, uploading, downloading)
 * - useSuspenseQuery(sql, params): Suspense-compatible watched query
 */

export {
  usePowerSync,
  useQuery,
  useStatus,
  useSuspenseQuery,
} from "@powersync/react";
