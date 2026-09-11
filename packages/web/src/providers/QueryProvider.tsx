/**
 * The query client provider — and, since Phase E wave 5 Task 6, nothing else.
 *
 * It used to mount `ConnectionErrorHandlerInit`, a null-rendering component
 * whose `useEffect` opened `lib/connection-error-handler.ts`'s
 * `"__global-connection-heartbeat__"` Supabase Realtime channel for the life
 * of the app and, on every re-SUBSCRIBE, called `queryClient.invalidateQueries()`
 * with no arguments — the whole cache. Both halves are gone, and the second is
 * a decision rather than a consequence of the first:
 *
 * **The trigger no longer exists.** There is no app-global socket in the SSE
 * world. The only long-lived connection left is the live meeting's one SSE
 * stream, it exists on one screen, and nothing outside that screen has a
 * "you were disconnected" moment to react to.
 *
 * **And where a reconnect DOES happen, "everything" is now the wrong answer,
 * not merely a blunt one.** `packages/api/src/trpc/routers/realtime.ts` treats
 * a resumed stream as "you may have missed something" and re-yields every
 * topic, so `useLiveMeetingEvents` invalidates the nine live-meeting routers
 * BY NAME on exactly the reconnects that matter. That is strictly narrower and
 * strictly more correct than invalidating the cache, and it costs nothing here
 * to stop doing the blunt version as well — while a bare
 * `invalidateQueries()` fired every five minutes, for every clerk in the room,
 * would refetch every cached read in the app twelve times an hour.
 *
 * Coming back from a real network outage is covered too, and was already:
 * `lib/queryClient.ts` sets `refetchOnReconnect: true`, so TanStack Query
 * refetches active queries off `onlineManager` — the same object
 * `ConnectionStatusBar`'s offline pill reads.
 *
 * This removes conventions item 7's ONE carve-out from its ban on bare
 * `invalidateQueries()`. The ban is now absolute; there is no sanctioned
 * caller left in the tree.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";

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
