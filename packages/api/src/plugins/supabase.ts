/**
 * Supabase client plugin.
 *
 * Creates a service-role Supabase client (bypasses RLS) and
 * decorates the Fastify instance with `supabase`.
 */

import fp from "fastify-plugin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare module "fastify" {
  interface FastifyInstance {
    supabase: SupabaseClient;
  }
}

export const supabasePlugin = fp(async (fastify) => {
  const url = process.env.SUPABASE_URL ?? "http://localhost:54321";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  fastify.decorate("supabase", client);
});
