/**
 * Kysely database wrapper for PowerSync.
 *
 * Creates a type-safe Kysely query builder wrapping the PowerSync database.
 * Usage:
 *   const db = getDb(powerSyncDb);
 *   const towns = await db.selectFrom('towns').selectAll().execute();
 *
 * The Kysely wrapper provides:
 * - Full TypeScript autocompletion for table and column names
 * - Type-safe where clauses, joins, inserts, updates
 * - The additional watch() method for reactive queries
 */

import { wrapPowerSyncWithKysely } from "@powersync/kysely-driver";
import type { AbstractPowerSyncDatabase } from "@powersync/web";
import type { Database } from "./types";

/**
 * Create a Kysely-wrapped PowerSync database instance.
 *
 * @param powerSyncDb - The initialized PowerSync database
 * @returns A Kysely database instance with typed tables
 */
export function getDb(powerSyncDb: AbstractPowerSyncDatabase) {
  return wrapPowerSyncWithKysely<Database>(powerSyncDb);
}

export type { Database };
