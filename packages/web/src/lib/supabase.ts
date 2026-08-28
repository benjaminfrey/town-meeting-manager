/**
 * Supabase client singleton for the web application.
 *
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 *
 * ─── Stage 1, Task C2: this client no longer authenticates anything ───────
 *
 * Every `supabase.auth.*` call is gone. Sessions are Better Auth cookies
 * (`lib/auth-client.ts`) and the API reads them itself; this client is now
 * PostgREST data access only, and Task D1 removes that too when the typed
 * query layer lands.
 *
 * `persistSession` and `autoRefreshToken` are therefore OFF, and that is not
 * tidying. Left on, the client would keep reading and refreshing a GoTrue
 * session out of `localStorage` — including one left behind on a developer's
 * machine from before this migration — and attaching it as a bearer token to
 * every PostgREST request. A dead credential being sent on every request is
 * worse than no credential, because it is invisible: it neither works nor
 * announces itself.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.",
  );
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
