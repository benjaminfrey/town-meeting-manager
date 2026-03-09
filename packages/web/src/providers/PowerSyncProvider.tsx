/**
 * PowerSync provider that initializes the local database and manages sync.
 *
 * This provider:
 * 1. Creates a PowerSyncDatabase instance (local SQLite via WASM)
 * 2. Listens for Supabase auth state changes
 * 3. Connects/disconnects PowerSync sync based on authentication
 * 4. Provides the PowerSync database to child components via context
 *
 * The database is always available for local reads/writes, even when
 * not authenticated. Sync only occurs when the user has a valid session.
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

// ─── Provider ────────────────────────────────────────────────────────

interface PowerSyncProviderProps {
  supabaseClient: SupabaseClient;
  powersyncUrl: string;
  children: ReactNode;
}

export function PowerSyncProvider({
  supabaseClient,
  powersyncUrl,
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

  // Track whether we've already connected to avoid duplicate connections
  const connectedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        // Initialize the local database (creates WASM SQLite)
        await powerSync.init();

        if (!mounted) return;

        // Check if user already has a session
        const {
          data: { session },
        } = await supabaseClient.auth.getSession();

        if (session && !connectedRef.current) {
          // User is authenticated — start syncing
          await powerSync.connect(connector);
          connectedRef.current = true;
        }

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

    // Listen for auth state changes to connect/disconnect sync
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session && !connectedRef.current) {
        try {
          await powerSync.connect(connector);
          connectedRef.current = true;
        } catch (error) {
          console.error("Failed to connect PowerSync after sign-in:", error);
        }
      } else if (event === "SIGNED_OUT") {
        try {
          await powerSync.disconnect();
          connectedRef.current = false;
          // Clear local data on sign-out for security
          await powerSync.disconnectAndClear();
        } catch (error) {
          console.error(
            "Failed to disconnect PowerSync after sign-out:",
            error
          );
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [powerSync, connector, supabaseClient]);

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
      <PowerSyncContext.Provider value={powerSync}>
        {children}
      </PowerSyncContext.Provider>
    </SupabaseContext.Provider>
  );
}
