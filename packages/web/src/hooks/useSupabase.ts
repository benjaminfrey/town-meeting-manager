/**
 * Hook to access the Supabase client from context.
 *
 * Re-exports useSupabaseClient from the PowerSyncProvider for convenience.
 * Usage:
 *   const supabase = useSupabase();
 *   const { data } = await supabase.auth.getUser();
 */

export { useSupabaseClient as useSupabase } from "@/providers/PowerSyncProvider";
