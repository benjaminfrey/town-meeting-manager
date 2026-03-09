/**
 * PowerSync backend connector that bridges PowerSync ↔ Supabase.
 *
 * Implements the PowerSyncBackendConnector interface:
 * - fetchCredentials(): Returns the PowerSync endpoint URL and Supabase JWT token
 * - uploadData(): Processes the local write queue by applying CRUDs to Supabase via REST
 */

import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";

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
   * PowerSync accumulates local writes in a queue (CRUDs).
   * This method processes each entry and applies it to the
   * corresponding Supabase table via REST API.
   */
  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();

    if (!transaction) {
      return;
    }

    let lastOp: CrudEntry | null = null;

    try {
      for (const op of transaction.crud) {
        lastOp = op;
        const table = this.supabase.from(op.table);

        switch (op.op) {
          case "PUT": {
            // Upsert: insert or update (PowerSync uses PUT for both create and update)
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
            throw new Error(`Unknown CRUD operation: ${op.op}`);
        }
      }

      // All operations succeeded — mark the transaction as complete
      await transaction.complete();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `Failed to upload CRUD operation on ${lastOp?.table}:`,
        message
      );
      throw error;
    }
  }
}
