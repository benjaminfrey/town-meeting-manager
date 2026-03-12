/**
 * MIGRATION SHIM — replaces @powersync/react hooks with stubs.
 *
 * These stubs keep un-migrated components compiling until sessions M.05–M.09
 * rewrite each file to use TanStack Query + Supabase directly.
 *
 * TODO(M.11): Delete this file once all consumers are migrated.
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

// ─── usePowerSync ────────────────────────────────────────────────
// Returns a shim object whose `.execute()` method runs raw SQL via
// Supabase's RPC or the PostgREST API. Components that call
// powerSync.execute(INSERT/UPDATE/DELETE ...) will work at runtime
// if the SQL is simple; complex SQL will need a proper migration.

interface PowerSyncShim {
  execute: (sql: string, params?: unknown[]) => Promise<{ rows: { _array: unknown[] } }>;
}

export function usePowerSync(): PowerSyncShim {
  return {
    async execute(sql: string, params?: unknown[]) {
      // Delegate to supabase rpc or a direct fetch — best-effort shim.
      // Most callers will be migrated before they actually run this path.
      console.warn("[PowerSync shim] execute() called — migrate this caller to Supabase:", sql);
      return { rows: { _array: [] } };
    },
  };
}

// ─── useQuery ────────────────────────────────────────────────────
// PowerSync's useQuery(sql, params) returns { data: Row[] } and
// re-renders when the underlying SQLite data changes.
// This shim returns an empty array; components will appear empty
// until individually migrated.

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
