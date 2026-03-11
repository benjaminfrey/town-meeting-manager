/**
 * PowerSync backend connector that bridges PowerSync ↔ Supabase.
 *
 * Implements the PowerSyncBackendConnector interface:
 * - fetchCredentials(): Returns the PowerSync endpoint URL and Supabase JWT token
 * - uploadData(): Processes the local write queue by applying CRUDs to Supabase via REST
 */

import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Known PowerSync/Postgres table names.
 *
 * Our AppSchema uses SINGULAR keys (matching Postgres table names) with
 * viewName aliases for plural SQL queries. CRUD ops arrive with the
 * singular schema key, so names pass through unchanged.
 *
 * We keep this as an explicit allow-list so unknown tables are
 * logged rather than silently forwarded to PostgREST.
 */
const KNOWN_TABLES = new Set([
  "town",
  "person",
  "user_account",
  "board",
  "board_member",
  "resident_account",
  "invitation",
  "meeting",
  "agenda_item",
  "agenda_template",
  "motion",
  "vote_record",
  "meeting_attendance",
  "minutes_document",
  "minutes_section",
  "exhibit",
  "guest_speaker",
  "agenda_item_transition",
  "executive_session",
  "future_item_queue",
  "notification_event",
  "notification_delivery",
]);

export class SupabaseConnector implements PowerSyncBackendConnector {
  private supabase: SupabaseClient;
  private powersyncUrl: string;

  constructor(supabase: SupabaseClient, powersyncUrl: string) {
    this.supabase = supabase;
    this.powersyncUrl = powersyncUrl;
  }

  /**
   * Fetch credentials for PowerSync to authenticate with the sync service.
   * Returns the PowerSync endpoint and the current Supabase JWT token.
   */
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const {
      data: { session },
      error,
    } = await this.supabase.auth.getSession();

    if (error) {
      console.error("Failed to get Supabase session:", error.message);
      return null;
    }

    if (!session) {
      // No authenticated session — PowerSync will pause sync
      return null;
    }

    return {
      endpoint: this.powersyncUrl,
      token: session.access_token,
      // Let PowerSync handle token refresh via re-calling fetchCredentials
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    };
  }

  /**
   * Upload local changes to Supabase.
   *
   * PowerSync accumulates local writes in a CRUD queue. This method
   * processes each entry one at a time using `getCrudBatch()` so that
   * a single failing operation does NOT block the entire queue.
   *
   * For each batch (we use size=1), we attempt the upload. On success
   * the batch is marked complete and removed from the queue. On failure
   * the error is logged and we still mark the batch complete to prevent
   * it from blocking subsequent operations indefinitely.
   */
  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    // Process one CRUD entry at a time
    const batch = await database.getCrudBatch(1);

    if (!batch) {
      return;
    }

    for (const op of batch.crud) {
      const tableName = op.table;

      if (!KNOWN_TABLES.has(tableName)) {
        console.warn(
          `[SupabaseConnector] Skipping unknown table "${tableName}" (op: ${op.op}, id: ${op.id})`,
        );
        continue;
      }

      try {
        const table = this.supabase.from(tableName);

        switch (op.op) {
          case "PUT": {
            // Upsert: insert or update (PowerSync uses PUT for both)
            const { error } = await table.upsert({
              id: op.id,
              ...op.opData,
            });
            if (error) throw error;
            break;
          }
          case "PATCH": {
            // Partial update
            const { error } = await table
              .update(op.opData!)
              .eq("id", op.id);
            if (error) throw error;
            break;
          }
          case "DELETE": {
            const { error } = await table.delete().eq("id", op.id);
            if (error) throw error;
            break;
          }
          default:
            console.warn(
              `[SupabaseConnector] Unknown CRUD op "${op.op}" on ${tableName}`,
            );
        }
      } catch (error: unknown) {
        // Log but do NOT re-throw. Marking the batch complete below
        // prevents this operation from blocking the queue forever.
        // The server's sync-rules will push the authoritative state
        // back down, so the local record will self-correct.
        const msg =
          error instanceof Error
            ? error.message
            : JSON.stringify(error);
        console.error(
          `[SupabaseConnector] Failed ${op.op} on ${tableName} (id: ${op.id}): ${msg}`,
        );
      }
    }

    // Always mark the batch as complete so the queue advances.
    // Failed operations are logged above; the server's state will
    // be synced back down to correct any local-only records.
    await batch.complete();
  }
}
