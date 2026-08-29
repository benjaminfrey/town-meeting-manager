/**
 * Postmark client factory.
 *
 * Returns a ServerClient configured with the appropriate API token.
 * Each town can have its own server token stored in town_notification_config,
 * or fall back to the global POSTMARK_SERVER_TOKEN environment variable.
 *
 * ─── Task D1c: the town-specific lookup is tenant-bound ───────────────────
 *
 * This used to take `(townId, supabase)` and filter by `town_id` itself,
 * through the service-role client. Two things were wrong with that. The
 * obvious one is that the filter was the only thing keeping one town's
 * sending token out of another town's email. The less obvious one is that it
 * queried `postmark_server_token` — a column that DOES NOT EXIST; the schema
 * has `postmark_server_token_encrypted` (`0000_baseline.sql`, `town_notification_config`).
 * PostgREST answered that with an error, the error was discarded, `data` came
 * back null, and every town silently fell through to the global environment
 * token. The per-town sender has therefore never worked.
 *
 * It now takes the transaction instead of a town id, so the town is whatever
 * `app.town_id` says and cannot disagree with the caller's intention — there
 * is no second place to state it and therefore no way for the two to differ.
 */

import * as postmark from "postmark";
import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/with-tenant.js";
import { toRows } from "../db/rows.js";

// Cache clients by token to avoid re-instantiating on every send
const clientCache = new Map<string, postmark.ServerClient>();

function makeClient(token: string): postmark.ServerClient {
  const cached = clientCache.get(token);
  if (cached) return cached;
  const client = new postmark.ServerClient(token);
  clientCache.set(token, client);
  return client;
}

/**
 * Returns a Postmark ServerClient for the town `tx` is scoped to.
 *
 * Lookup order:
 *  1. town_notification_config.postmark_server_token_encrypted (town-specific)
 *  2. POSTMARK_SERVER_TOKEN env var (global default)
 *
 * Throws if no token is available.
 *
 * On the column name: it is `..._encrypted` because the schema was designed
 * for an encrypted-at-rest token, and its COMMENT says so. Nothing in this
 * repository encrypts or decrypts it, and nothing writes it — so what is read
 * here is whatever an operator put in the column, used verbatim. That is
 * recorded rather than papered over: reading a column named `_encrypted` as
 * plaintext is a thing a reviewer should see stated, not discover.
 */
export async function getPostmarkClient(tx: TenantTx): Promise<postmark.ServerClient> {
  const rows = toRows<{ postmark_server_token_encrypted: string | null }>(
    await tx.execute(
      sql`SELECT postmark_server_token_encrypted FROM town_notification_config LIMIT 1`,
    ),
    (message) => new Error(`getPostmarkClient: ${message}`),
  );

  const token = rows[0]?.postmark_server_token_encrypted ?? process.env.POSTMARK_SERVER_TOKEN;

  if (!token) {
    throw new Error(
      "No Postmark server token configured for this town (town_notification_config." +
        "postmark_server_token_encrypted is unset) and POSTMARK_SERVER_TOKEN is not set either",
    );
  }

  return makeClient(token);
}

/**
 * Returns a ServerClient using only the env-var token.
 * Useful for tasks that do not have a town context (e.g. password reset).
 */
export function getDefaultPostmarkClient(): postmark.ServerClient {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    throw new Error("POSTMARK_SERVER_TOKEN environment variable is not set");
  }
  return makeClient(token);
}
