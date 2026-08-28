/**
 * Normalising a driver result into rows.
 *
 * `drizzle-orm/postgres-js` returns an array-like `RowList`; `node-postgres`
 * returns `{ rows: [...] }`. Two places in the authentication path read rows
 * this way — `auth/tenant-context.ts` and `plugins/auth.ts` — and both have
 * the same sharp edge: a result of an unexpected SHAPE must never be mistaken
 * for "no rows". "No rows" means "this session has no account", which means
 * refuse; so a driver swap that changed the result shape would silently turn
 * into a total authentication outage, or — reading it the other way, if the
 * check were written to be permissive — into an authorisation bypass.
 *
 * That invariant lives here, once, rather than being copied into each caller
 * and drifting.
 */

/**
 * @param result the raw value a driver returned.
 * @param onBadShape builds the error to throw when `result` is neither known
 * shape. Callers pass their own error type so the failure keeps their
 * vocabulary — `TenantResolutionError` for tenant resolution, a plain `Error`
 * for the identity read.
 */
export function toRows<T>(result: unknown, onBadShape: (message: string) => Error): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  throw onBadShape(
    `query returned an unrecognised result of type ${typeof result}. ` +
      "Expected an array (postgres.js) or { rows: [...] } (node-postgres). " +
      "Treating this as 'no rows' would silently deny every session.",
  );
}
