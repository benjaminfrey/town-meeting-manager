import { useEffect, useRef, useState } from 'react';
import { useSupabase } from '@/hooks/useSupabase';

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export function useRealtimeSubscription(
  channelName: string,
  table: string,
  filter: string | undefined,
  callback: (payload: unknown) => void,
  deps: unknown[] = []
) {
  const supabase = useSupabase();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as const,
        { event: '*', schema: 'public', table, filter },
        (payload) => callbackRef.current(payload)
      )
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          setStatus('connected');
        } else if (s === 'CLOSED' || s === 'CHANNEL_ERROR') {
          setStatus('disconnected');
        } else {
          setStatus('connecting');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, table, filter, ...deps]);

  return { status };
}
