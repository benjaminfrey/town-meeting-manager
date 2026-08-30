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
import { createTRPCClient, httpBatchLink, isTRPCClientError } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@town-meeting/api/trpc/router";
import { queryClient } from "./queryClient";

/**
 * The server's real output shapes, for props and locals that used to be
 * `Record<string, unknown>` because they came from `select("*")`.
 *
 * That escape hatch is what let Task 4's `ArchiveBoardDialog` regression
 * through: `board.town_id` compiled fine against `Record<string, unknown>`
 * even after `board.detail`'s explicit column list stopped selecting
 * `town_id`, so the bug only showed up at runtime (an empty-string town id
 * silently invalidating the wrong cache entry). `RouterOutputs["board"]["detail"]`
 * has no `town_id` key at all — the same mistake is a compile error now.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

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

/**
 * The message a CONFLICT carries (a role/name/uniqueness collision a caller
 * should see verbatim — "This person already has a login account", "A
 * template named ... already exists"); a generic fallback for anything else.
 *
 * Extracted here in this wave's whole-branch review: `AddPersonDialog.tsx`,
 * `MemberArchiveDialog.tsx`, `MemberTransitionDialog.tsx` and
 * `RoleConflictDialog.tsx` each carried this exact function, verbatim, as a
 * private local helper — four copies of the same three lines, which is
 * exactly the "the same logic in three [or four] places instead of one"
 * shape this file's own `RouterOutputs` doc comment and conventions item 1
 * both warn against for the identical reason: nothing keeps four
 * independent copies in sync if the rule (which code is CONFLICT, what
 * counts as "generic") ever needs to change.
 */
export function errorMessage(err: unknown, fallback: string): string {
  return isTRPCClientError(err) && err.data?.code === "CONFLICT" ? err.message : fallback;
}
