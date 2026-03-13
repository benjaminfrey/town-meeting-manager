import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { initConnectionErrorHandler } from "@/lib/connection-error-handler";

interface QueryProviderProps {
  children: ReactNode;
}

function ConnectionErrorHandlerInit() {
  useEffect(() => {
    const cleanup = initConnectionErrorHandler(supabase, queryClient);
    return cleanup;
  }, []);
  return null;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Initialise global Realtime connection monitoring + query invalidation on reconnect */}
      <ConnectionErrorHandlerInit />
      {children}
      {import.meta.env.DEV && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  );
}
