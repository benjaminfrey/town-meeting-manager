/**
 * The typed tRPC client for the web application.
 *
 * Phase E, unit 0. This is the ONLY way the web package should reach the API's
 * data layer. `lib/supabase.ts` is being removed; when it is gone, an import of
 * it is a build error rather than a silent zero-row read, which is the point.
 *
 * `credentials: "include"` is load-bearing. Sessions are Better Auth cookies
 * that the API reads itself; without this every procedure answers UNAUTHORIZED,
 * and the symptom reads as an authorization bug rather than a transport one.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@town-meeting/api/trpc/router";
import { queryClient } from "./queryClient";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
