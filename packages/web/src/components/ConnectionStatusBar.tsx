import { useEffect, useState } from 'react';
import { useSupabase } from '@/hooks/useSupabase';
import { cn } from '@/lib/utils';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';

interface ConnectionStatusBarProps {
  /** When true, show a full-width banner (used in live meeting context) */
  prominent?: boolean;
  className?: string;
}

export function ConnectionStatusBar({ prominent = false, className }: ConnectionStatusBarProps) {
  const supabase = useSupabase();
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    // Use a heartbeat channel to track the global Realtime connection health
    const heartbeat = supabase
      .channel('connection-heartbeat')
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setState('connected');
        } else if (
          status === 'CLOSED' ||
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT'
        ) {
          setState('disconnected');
        } else {
          setState('connecting');
        }
      });

    return () => {
      supabase.removeChannel(heartbeat);
    };
  }, [supabase]);

  // Silent when connected — don't distract the operator
  if (state === 'connected') {
    return null;
  }

  if (prominent) {
    // Full-width amber/red banner for live meeting context
    return (
      <div
        className={cn(
          'w-full px-4 py-2 text-sm font-medium text-center',
          state === 'connecting'
            ? 'bg-amber-50 text-amber-800 border-b border-amber-200'
            : 'bg-red-50 text-red-800 border-b border-red-200',
          className
        )}
        role="status"
        aria-live="polite"
      >
        {state === 'connecting'
          ? 'Reconnecting… live sync temporarily paused'
          : 'Connection lost — changes may not be syncing to other devices'}
      </div>
    );
  }

  // Compact pill for the app header
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        state === 'connecting'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-red-100 text-red-800',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
        )}
      />
      {state === 'connecting' ? 'Reconnecting…' : 'Connection lost'}
    </div>
  );
}
