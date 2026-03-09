/**
 * Hook to get a type-safe Kysely database instance.
 *
 * Wraps the PowerSync database with Kysely for type-safe SQL queries.
 * The Kysely instance is memoized per PowerSync database reference.
 *
 * Usage:
 *   const db = useDb();
 *   const towns = await db.selectFrom('towns').selectAll().execute();
 */

import { useMemo } from "react";
import { usePowerSync } from "@powersync/react";
import { getDb } from "@/lib/powersync/db";

export function useDb() {
  const powerSync = usePowerSync();

  return useMemo(() => getDb(powerSync), [powerSync]);
}
