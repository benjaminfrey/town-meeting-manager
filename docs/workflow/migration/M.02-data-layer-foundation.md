# Session M.02 — Data Layer Foundation: QueryClient, QueryProvider, ConnectionStatusBar

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.01
**Estimated tasks:** 10

---

## Description

Create all new infrastructure files that replace PowerSync's data layer: a QueryClient singleton, QueryProvider component, typed query key factory, Supabase Realtime subscription hook, and ConnectionStatusBar. Update `root.tsx` and `RootLayout.tsx` to use the new stack. Add a temporary SyncStatusBar shim so files that still import the old name compile during migration.

## Tasks

1. Create `packages/web/src/lib/queryClient.ts` — QueryClient singleton with standard defaults (staleTime 60s, gcTime 5min, retry 2, refetchOnWindowFocus, refetchOnReconnect)
2. Create `packages/web/src/providers/QueryProvider.tsx` — QueryClientProvider wrapper with ReactQueryDevtools in development only
3. Create `packages/web/src/lib/queryKeys.ts` — typed query key factory for all entities (towns, boards, meetings, agendaItems, motions, attendance, minutes, members, persons, agendaTemplates, exhibits, executiveSessions, guestSpeakers, voteRecords, pushSubscriptions, currentUser)
4. Create `packages/web/src/hooks/useRealtimeSubscription.ts` — Supabase Realtime hook that wraps `channel().on('postgres_changes', ...)`, handles subscribe/cleanup lifecycle, tracks connection status
5. Create `packages/web/src/components/ConnectionStatusBar.tsx` — connection indicator: silent when connected (green dot only), amber pill with text when reconnecting, red pill when disconnected
6. Update `packages/web/src/root.tsx` — replace `PowerSyncProvider` with `QueryProvider`; remove VITE_POWERSYNC_URL reference; wrap structure as `<ThemeProvider><AuthProvider><QueryProvider><AppLayout /></QueryProvider></AuthProvider></ThemeProvider>`
7. Update `packages/web/src/layouts/RootLayout.tsx` — replace `SyncStatusBar` import and usage with `ConnectionStatusBar`
8. Create `packages/web/src/components/SyncStatusBar.tsx` temporary shim that re-exports ConnectionStatusBar — this allows the ~30 other files that import SyncStatusBar to compile during migration; it will be deleted in M.11
9. Verify `packages/web/src/hooks/useSupabase.ts` exists and exports a stable `useSupabase()` hook returning the Supabase client; create or update it if needed so all query functions can call `useSupabase()` to get the client
10. Verify TypeScript compiles for the 6 new/updated files only: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "src/lib/query\|src/providers/Query\|src/hooks/useRealtime\|src/components/ConnectionStatus"` — these specific files should show no errors

## Prompt

```
You are building the data layer foundation for the Town Meeting Manager migration from PowerSync to TanStack Query + Supabase Realtime. This session creates the infrastructure files that all other migration sessions will depend on. After this session, root.tsx and RootLayout.tsx use the new stack, and 6 new infrastructure files exist.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Web package: packages/web/
- Framework: React 19 + React Router v7 Framework Mode
- Supabase client: accessible via useSupabase() hook or supabase singleton — check packages/web/src/lib/supabase.ts and packages/web/src/hooks/useSupabase.ts for the existing pattern
- Tailwind CSS v4 + shadcn/ui (Radix UI) for components
- TanStack Query v5 (just installed in M.01)

Before writing any files, read these existing files to understand the current structure:
- packages/web/src/root.tsx
- packages/web/src/layouts/RootLayout.tsx
- packages/web/src/lib/supabase.ts (if it exists) or packages/web/src/providers/SupabaseProvider.tsx

TASK 1: Create packages/web/src/lib/queryClient.ts

Create this file with exactly this content:

```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,        // 60 seconds
      gcTime: 1000 * 60 * 5,       // 5 minutes
      retry: 2,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

export function resetQueryCache() {
  queryClient.clear();
}
```

TASK 2: Create packages/web/src/providers/QueryProvider.tsx

```typescript
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { ReactNode } from 'react';
import { queryClient } from '@/lib/queryClient';

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {import.meta.env.DEV && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  );
}
```

TASK 3: Create packages/web/src/lib/queryKeys.ts

Create a typed query key factory covering every entity in the database. The factory pattern uses const objects with functions so query keys are type-safe and easy to invalidate by prefix:

```typescript
export const queryKeys = {
  // Current authenticated user
  currentUser: ['currentUser'] as const,

  // Towns
  towns: {
    all: ['towns'] as const,
    detail: (townId: string) => ['towns', townId] as const,
  },

  // Boards
  boards: {
    all: ['boards'] as const,
    byTown: (townId: string) => ['boards', 'byTown', townId] as const,
    detail: (boardId: string) => ['boards', boardId] as const,
  },

  // Board members
  members: {
    all: ['members'] as const,
    byBoard: (boardId: string) => ['members', 'byBoard', boardId] as const,
    detail: (memberId: string) => ['members', memberId] as const,
    byPerson: (personId: string) => ['members', 'byPerson', personId] as const,
  },

  // Persons
  persons: {
    all: ['persons'] as const,
    byTown: (townId: string) => ['persons', 'byTown', townId] as const,
    detail: (personId: string) => ['persons', personId] as const,
  },

  // Meetings
  meetings: {
    all: ['meetings'] as const,
    byBoard: (boardId: string) => ['meetings', 'byBoard', boardId] as const,
    byTown: (townId: string) => ['meetings', 'byTown', townId] as const,
    detail: (meetingId: string) => ['meetings', meetingId] as const,
    recent: (townId: string) => ['meetings', 'recent', townId] as const,
  },

  // Agenda items
  agendaItems: {
    byMeeting: (meetingId: string) => ['agendaItems', 'byMeeting', meetingId] as const,
    detail: (itemId: string) => ['agendaItems', itemId] as const,
  },

  // Agenda templates
  agendaTemplates: {
    byBoard: (boardId: string) => ['agendaTemplates', 'byBoard', boardId] as const,
    detail: (templateId: string) => ['agendaTemplates', templateId] as const,
  },

  // Motions
  motions: {
    byMeeting: (meetingId: string) => ['motions', 'byMeeting', meetingId] as const,
    byItem: (agendaItemId: string) => ['motions', 'byItem', agendaItemId] as const,
    detail: (motionId: string) => ['motions', motionId] as const,
  },

  // Vote records
  voteRecords: {
    byMotion: (motionId: string) => ['voteRecords', 'byMotion', motionId] as const,
    byMeeting: (meetingId: string) => ['voteRecords', 'byMeeting', meetingId] as const,
  },

  // Attendance
  attendance: {
    byMeeting: (meetingId: string) => ['attendance', 'byMeeting', meetingId] as const,
    detail: (attendanceId: string) => ['attendance', attendanceId] as const,
  },

  // Minutes
  minutes: {
    byMeeting: (meetingId: string) => ['minutes', 'byMeeting', meetingId] as const,
    detail: (minutesId: string) => ['minutes', minutesId] as const,
  },

  // Exhibits
  exhibits: {
    byMeeting: (meetingId: string) => ['exhibits', 'byMeeting', meetingId] as const,
    byItem: (agendaItemId: string) => ['exhibits', 'byItem', agendaItemId] as const,
  },

  // Executive sessions
  executiveSessions: {
    byMeeting: (meetingId: string) => ['executiveSessions', 'byMeeting', meetingId] as const,
    detail: (sessionId: string) => ['executiveSessions', sessionId] as const,
  },

  // Guest speakers
  guestSpeakers: {
    byMeeting: (meetingId: string) => ['guestSpeakers', 'byMeeting', meetingId] as const,
    byItem: (agendaItemId: string) => ['guestSpeakers', 'byItem', agendaItemId] as const,
  },

  // Push subscriptions
  pushSubscriptions: {
    byUser: (userId: string) => ['pushSubscriptions', 'byUser', userId] as const,
  },
} as const;
```

TASK 4: Create packages/web/src/hooks/useRealtimeSubscription.ts

```typescript
import { useEffect, useRef, useState } from 'react';
import { useSupabase } from '@/hooks/useSupabase';

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export interface UseRealtimeSubscriptionOptions {
  channelName: string;
  table: string;
  filter?: string;
  onEvent: (payload: unknown) => void;
  enabled?: boolean;
}

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
```

TASK 5: Create packages/web/src/components/ConnectionStatusBar.tsx

The ConnectionStatusBar replaces SyncStatusBar. It should be visually minimal when connected (just a small green dot, or nothing at all), and expand to a visible pill/banner when the connection is degraded:

```typescript
import { useEffect, useState } from 'react';
import { useSupabase } from '@/hooks/useSupabase';
import { cn } from '@/lib/utils';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';

interface ConnectionStatusBarProps {
  /** When true, show a more prominent banner (used in live meeting context) */
  prominent?: boolean;
  className?: string;
}

export function ConnectionStatusBar({ prominent = false, className }: ConnectionStatusBarProps) {
  const supabase = useSupabase();
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    // Monitor the Supabase Realtime connection state
    // Supabase fires 'SUBSCRIBED', 'CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT' etc.
    // We use a heartbeat channel to track the global connection health
    const heartbeat = supabase
      .channel('connection-heartbeat')
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setState('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
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
    // Full-width amber banner for live meeting context
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

  // Compact pill for regular layout
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
```

TASK 6: Update packages/web/src/root.tsx

Read the current root.tsx first to understand the existing provider structure. Then:
- Remove the `PowerSyncProvider` import
- Remove any `VITE_POWERSYNC_URL` references (e.g., `import.meta.env.VITE_POWERSYNC_URL`)
- Add `import { QueryProvider } from '@/providers/QueryProvider'`
- Replace `<PowerSyncProvider ...>` with `<QueryProvider>`
- The final structure should wrap the app as: `<ThemeProvider> → <AuthProvider> → <QueryProvider> → <AppLayout /> (or Router/Outlet)`
- Preserve all other providers (ThemeProvider, AuthProvider, etc.) unchanged

TASK 7: Update packages/web/src/layouts/RootLayout.tsx

Read the current RootLayout.tsx first. Then:
- Remove the `SyncStatusBar` import
- Add `import { ConnectionStatusBar } from '@/components/ConnectionStatusBar'`
- Replace `<SyncStatusBar />` with `<ConnectionStatusBar />`
- Preserve all other layout structure unchanged

TASK 8: Create packages/web/src/components/SyncStatusBar.tsx (temporary shim)

This shim prevents compile errors in the ~30 files that still import SyncStatusBar. It will be deleted in session M.11.

```typescript
// TEMPORARY MIGRATION SHIM — DELETE IN SESSION M.11
// This file exists to prevent import errors during migration.
// All files that import SyncStatusBar will be updated to import ConnectionStatusBar.
export { ConnectionStatusBar as SyncStatusBar } from './ConnectionStatusBar';
export { ConnectionStatusBar } from './ConnectionStatusBar';
export default function SyncStatusBar() {
  // Re-exported via named export above
  return null;
}
```

TASK 9: Verify/create packages/web/src/hooks/useSupabase.ts

Read the file if it exists. The hook must:
- Return the Supabase client instance (the typed client created with `createClient<Database>`)
- Be callable from any React component
- Return the same singleton instance every time (no new client on every render)

If the hook doesn't exist or doesn't follow this pattern, create/update it:

```typescript
import { useContext } from 'react';
// Import from wherever the Supabase client is provided — check the existing auth setup
// It may be from a SupabaseContext, or it may just re-export the singleton
import { supabase } from '@/lib/supabase';

export function useSupabase() {
  return supabase;
}
```

Adapt this to match however the project currently exposes the Supabase client. Check packages/web/src/lib/supabase.ts and the existing auth provider to find the correct import path.

TASK 10: Verify new files compile

Run this command to check only the new infrastructure files for TypeScript errors:
```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | head -50
```

Errors in files other than the 6 new/updated files are expected and acceptable. Fix any errors in the new files only (queryClient.ts, queryKeys.ts, QueryProvider.tsx, useRealtimeSubscription.ts, ConnectionStatusBar.tsx, root.tsx, RootLayout.tsx).

IMPORTANT NOTES:
- Do NOT import from @powersync in any new file
- Do NOT try to fix errors in components or routes that still use @powersync — leave those for M.04–M.09
- The queryKeys factory uses `as const` for type safety — this is intentional
- The useRealtimeSubscription hook uses a callbackRef to avoid stale closure issues in the useEffect
- The ConnectionStatusBar is silent when connected (returns null) — this is intentional per the design requirement

VERIFICATION CHECKLIST:
1. packages/web/src/lib/queryClient.ts exists with QueryClient singleton exported as `queryClient`
2. packages/web/src/providers/QueryProvider.tsx wraps children in QueryClientProvider and conditionally renders ReactQueryDevtools in dev
3. packages/web/src/lib/queryKeys.ts exports `queryKeys` with entries for all 16 entities listed
4. packages/web/src/hooks/useRealtimeSubscription.ts exports `useRealtimeSubscription` and `RealtimeStatus` type
5. packages/web/src/components/ConnectionStatusBar.tsx renders nothing when connected, shows pill/banner when connecting or disconnected
6. packages/web/src/root.tsx imports QueryProvider and wraps app in it; no PowerSyncProvider reference remains
7. packages/web/src/layouts/RootLayout.tsx imports ConnectionStatusBar; no SyncStatusBar import remains
8. packages/web/src/components/SyncStatusBar.tsx exists as a shim re-exporting ConnectionStatusBar
9. packages/web/src/hooks/useSupabase.ts returns the Supabase client
10. TypeScript shows no errors in the 7 new/updated files (errors in other files with @powersync imports are acceptable)
```

## Commit Message

```
M.02: Add QueryClient, QueryProvider, queryKeys, ConnectionStatusBar, and Realtime hook
```
