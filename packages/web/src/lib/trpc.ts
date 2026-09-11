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
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  isTRPCClientError,
  splitLink,
} from "@trpc/client";
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

/**
 * `splitLink`, added in Phase E wave 5, Task 4, and it corrects the ADR.
 *
 * `docs/advisory-resolutions/5.1-realtime-transport.md` says "no
 * `wsLink`/`splitLink` client wiring is needed" — true of the WebSocket
 * fallback it was contrasting against, and false of the SSE path it chose.
 * `httpBatchLink` refuses a subscription outright ("Subscriptions are
 * unsupported by `httpLink` - use `httpSubscriptionLink` or `wsLink`"), so a
 * single-link client cannot carry both. The split is by operation TYPE, which
 * is the only thing that distinguishes them: everything else still batches
 * over POST exactly as before.
 *
 * `credentials: "include"` has no counterpart on the subscription branch and
 * needs none. `EventSource`'s `withCredentials` governs CORS requests only,
 * and this url is same-origin (`/api/trpc`, relative — the Vite proxy in dev,
 * nginx in production), so the session cookie is sent either way. It is passed
 * anyway, so that the two branches state the same intent rather than leaving a
 * reader to reconstruct why only one of them mentions credentials.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: "/api/trpc",
        eventSourceOptions: () => ({ withCredentials: true }),
      }),
      false: httpBatchLink({
        url: "/api/trpc",
        fetch(url, options) {
          return fetch(url, { ...options, credentials: "include" });
        },
      }),
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

/**
 * The message for a write that can answer FORBIDDEN — "You don't have
 * permission to <action>." — falling back to "Couldn't <action>. Try again."
 *
 * `errorMessage` above is the CONFLICT half of this and does not fit: it
 * returns the generic fallback for a refusal, and "something went wrong" for
 * a permission problem sends a clerk hunting a bug that is not there.
 *
 * Extracted in Phase E wave 4, Task 3 rather than copied a sixth time.
 * `CancelMeetingDialog.tsx`, `CreateMeetingDialog.tsx` and
 * `boards.$boardId.templates.tsx` each grew their own inline version of this
 * branch as wave 3 closed the holes that made FORBIDDEN reachable, and this
 * task closes two more holes across five files — the same four-copies-of-
 * three-lines shape `errorMessage`'s own doc comment describes, caught one
 * wave earlier this time. `action` is a bare verb phrase ("remove this
 * section"), so it reads correctly in both sentences.
 */
export function refusalMessage(err: unknown, action: string): string {
  if (isTRPCClientError(err) && err.data?.code === "FORBIDDEN") {
    return `You don't have permission to ${action}.`;
  }
  return `Couldn't ${action}. Try again.`;
}
