/**
 * MIGRATION SHIM — replaces @powersync/react hooks with stubs.
 *
 * The Vite alias "@powersync/react" resolves to this file (see vite.config.ts).
 * These stubs keep un-migrated components compiling until sessions M.06–M.09
 * rewrite each file to use TanStack Query + Supabase directly.
 *
 * TODO(M.11): Delete this file and remove the Vite alias.
 */

import { useState, useEffect } from "react";

// ─── usePowerSync ────────────────────────────────────────────────

interface PowerSyncShim {
  execute: (sql: string, params?: unknown[]) => Promise<{ rows: { _array: unknown[] } }>;
}

export function usePowerSync(): PowerSyncShim {
  return {
    async execute(sql: string, params?: unknown[]) {
      console.warn("[PowerSync shim] execute() called — migrate this caller to Supabase:", sql);
      return { rows: { _array: [] } };
    },
  };
}

// ─── useQuery ────────────────────────────────────────────────────

export function useQuery(sql: string, params?: unknown[]): { data: Record<string, unknown>[] } {
  const [data] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    console.warn("[PowerSync shim] useQuery() called — migrate this caller:", sql);
  }, [sql]);

  return { data };
}

// ─── useStatus ───────────────────────────────────────────────────

interface SyncStatus {
  connected: boolean;
  lastSyncedAt: Date | undefined;
  hasSynced: boolean;
  dataFlowStatus: {
    uploading: boolean;
    downloading: boolean;
  };
}

export function useStatus(): SyncStatus {
  return {
    connected: true,
    lastSyncedAt: new Date(),
    hasSynced: true,
    dataFlowStatus: {
      uploading: false,
      downloading: false,
    },
  };
}

// ─── useSuspenseQuery ────────────────────────────────────────────

export function useSuspenseQuery(sql: string, params?: unknown[]): { data: Record<string, unknown>[] } {
  return useQuery(sql, params);
}
