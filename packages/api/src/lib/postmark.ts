/**
 * Postmark client factory.
 *
 * Returns a ServerClient configured with the appropriate API token.
 * Each town can have its own server token stored in town_notification_config,
 * or fall back to the global POSTMARK_SERVER_TOKEN environment variable.
 */

import * as postmark from "postmark";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * Returns a Postmark ServerClient for the given town.
 *
 * Lookup order:
 *  1. town_notification_config.postmark_server_token (town-specific)
 *  2. POSTMARK_SERVER_TOKEN env var (global default)
 *
 * Throws if no token is available.
 */
export async function getPostmarkClient(
  townId: string,
  supabase: SupabaseClient,
): Promise<postmark.ServerClient> {
  // Try town-specific token first
  const { data } = await supabase
    .from("town_notification_config")
    .select("postmark_server_token")
    .eq("town_id", townId)
    .single();

  const token =
    (data?.postmark_server_token as string | null) ??
    process.env.POSTMARK_SERVER_TOKEN;

  if (!token) {
    throw new Error(
      `No Postmark server token configured for town ${townId} and POSTMARK_SERVER_TOKEN env var is not set`,
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
