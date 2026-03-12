/**
 * Hook to access the Supabase client singleton.
 *
 * Usage:
 *   const supabase = useSupabase();
 *   const { data } = await supabase.from('meeting').select('*');
 */

import { supabase } from '@/lib/supabase';

export function useSupabase() {
  return supabase;
}
