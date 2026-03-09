/**
 * UUID v7 generation utilities.
 *
 * UUID v7 provides time-ordered UUIDs which are optimal for database
 * primary keys (better index locality than random UUID v4).
 *
 * Uses the uuidv7 package for spec-compliant generation.
 */

import { uuidv7 } from "uuidv7";

/**
 * Generate a new UUID v7 (time-ordered).
 */
export function generateId(): string {
  return uuidv7();
}

/**
 * Validate that a string is a valid UUID format (v4 or v7).
 */
export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Extract the timestamp from a UUID v7 (milliseconds since epoch).
 * Returns null if the UUID is not v7.
 */
export function extractTimestamp(uuid: string): number | null {
  if (!isValidUuid(uuid)) return null;

  const hex = uuid.replace(/-/g, "");
  // UUID v7: first 48 bits are unix timestamp in ms
  // Check version nibble (bits 48-51) is 0x7
  const versionChar = hex[12];
  if (!versionChar) return null;
  const versionNibble = parseInt(versionChar, 16);
  if (versionNibble !== 7) return null;

  const timestampHex = hex.substring(0, 12);
  return parseInt(timestampHex, 16);
}
