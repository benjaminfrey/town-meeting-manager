/**
 * PowerSync provider that initializes the local database and manages sync.
 *
 * This provider:
 * 1. Creates a PowerSyncDatabase instance (local SQLite via WASM)
 * 2. Connects/disconnects sync based on the `authenticated` prop from AuthProvider
 * 3. Provides the PowerSync database and Supabase client to child components via context
 *
 * The database is always available for local reads/writes, even when
 * not authenticated. Sync only occurs when the user has a valid session.
 *
 * Auth lifecycle is managed by AuthProvider. This provider reacts to
 * authentication state changes and connects/disconnects PowerSync accordingly.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PowerSyncDatabase } from "@powersync/web";
import { PowerSyncContext } from "@powersync/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppSchema } from "@/lib/powersync/schema";
import { SupabaseConnector } from "@/lib/powersync/SupabaseConnector";

// ─── Supabase context ────────────────────────────────────────────────

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function useSupabaseClient(): SupabaseClient {
  const client = useContext(SupabaseContext);
  if (!client) {
    throw new Error("useSupabaseClient must be used within PowerSyncProvider");
  }
  return client;
}

// ─── PowerSync database ref context (for logout disconnect) ──────────

const PowerSyncDbRefContext = createContext<PowerSyncDatabase | null>(null);

export function usePowerSyncDb(): PowerSyncDatabase | null {
  return useContext(PowerSyncDbRefContext);
}

// ─── Provider ────────────────────────────────────────────────────────

interface PowerSyncProviderProps {
  supabaseClient: SupabaseClient;
  powersyncUrl: string;
  authenticated: boolean;
  children: ReactNode;
}

export function PowerSyncProvider({
  supabaseClient,
  powersyncUrl,
  authenticated,
  children,
}: PowerSyncProviderProps) {
  const [initialized, setInitialized] = useState(false);

  // Create PowerSync database instance — singleton for app lifetime
  const powerSync = useMemo(
    () =>
      new PowerSyncDatabase({
        schema: AppSchema,
        database: {
          dbFilename: "town-meeting-manager.db",
        },
      }),
    []
  );

  // Create the connector — bridges PowerSync ↔ Supabase
  const connector = useMemo(
    () => new SupabaseConnector(supabaseClient, powersyncUrl),
    [supabaseClient, powersyncUrl]
  );

  // Track connection state to avoid duplicate connects
  const connectedRef = useRef(false);

  // Initialize the WASM database on mount
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        await powerSync.init();
        if (mounted) {
          setInitialized(true);
        }
      } catch (error) {
        console.error("Failed to initialize PowerSync:", error);
        // Still mark as initialized so the app can render (offline mode)
        if (mounted) {
          setInitialized(true);
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
    };
  }, [powerSync]);

  // Connect/disconnect based on authentication state
  useEffect(() => {
    if (!initialized) return;

    async function connectSync() {
      if (authenticated && !connectedRef.current) {
        try {
          await powerSync.connect(connector);
          connectedRef.current = true;
        } catch (error) {
          console.error("Failed to connect PowerSync:", error);
        }
      } else if (!authenticated && connectedRef.current) {
        try {
          await powerSync.disconnectAndClear();
          connectedRef.current = false;
        } catch (error) {
          console.error("Failed to disconnect PowerSync:", error);
        }
      }
    }

    connectSync();
  }, [authenticated, initialized, powerSync, connector]);

  // Show a loading indicator while PowerSync initializes WASM
  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Initializing database...
          </p>
        </div>
      </div>
    );
  }

  return (
    <SupabaseContext.Provider value={supabaseClient}>
      <PowerSyncDbRefContext.Provider value={powerSync}>
        <PowerSyncContext.Provider value={powerSync}>
          {children}
        </PowerSyncContext.Provider>
      </PowerSyncDbRefContext.Provider>
    </SupabaseContext.Provider>
  );
}
