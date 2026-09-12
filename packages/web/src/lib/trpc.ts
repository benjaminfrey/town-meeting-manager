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
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@town-meeting/api/trpc/router";
import { TRPC_BATCH_URL_LIMIT } from "@town-meeting/shared";
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
 * The server's real INPUT shapes, for the handful of places a component holds
 * a value in local state that a procedure's schema constrains.
 *
 * Added in Phase E wave 5, Task 5 for exactly one case worth the export:
 * `MotionCaptureDialog` keeps the chosen motion type in `useState`, and
 * `motion.insert`'s schema is `z.enum(MOTION_TYPES)` — eight literals. Typed
 * `string`, the component compiles against a `<select>` whose options could
 * drift from that enum and the disagreement surfaces as a BAD_REQUEST in a
 * live meeting. `RouterInputs["motion"]["insert"]["motionType"]` makes it a
 * compile error, and is the input-side twin of what `RouterOutputs` does for
 * a payload's columns (conventions item 10).
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

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
 *
 * `maxURLLength: TRPC_BATCH_URL_LIMIT` — Phase E, wave 5, Task 7. Without a
 * cap, `httpBatchLink` coalesces every query fired in one tick into a single
 * request no matter how long the resulting URL gets; the live meeting screen
 * already composes a six-procedure batch whose path alone runs ~151
 * characters, and Fastify's router bounds that segment
 * (`server.ts`'s `maxParamLength`, also `TRPC_BATCH_PATH_LENGTH_LIMIT`). A cap
 * sized to fit only today's longest batch would fail silently the next time a
 * loader or a procedure name grows; this one instead makes `@trpc/client`
 * split an over-limit tick into more than one HTTP request automatically —
 * seeing the shared constant's doc comment for why it is set well below the
 * server's own bound, and everywhere else in this file's own
 * `refusalMessage`, an extra round trip is the honest cost, not a 404.
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
        maxURLLength: TRPC_BATCH_URL_LIMIT,
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
  const kind = categorizeMutationError(err);
  if (kind === "permission") {
    return `You don't have permission to ${action}.`;
  }
  // ADDED in wave 5, Task 6, and stated because conventions item 1 asks for an
  // added clause to be stated: a transport failure used to answer
  // "Couldn't <action>. Try again." — advice that is wrong in the one case the
  // user can actually act on. Everything else still falls through unchanged.
  if (kind === "network") {
    return `Couldn't ${action} — this device can't reach the server. Check your connection and try again.`;
  }
  return `Couldn't ${action}. Try again.`;
}

/**
 * What went wrong with a write, in the five categories a caller can act on
 * differently.
 *
 * ─── Wave 5, Task 6: this was Supabase-shaped, and had no callers ─────────
 *
 * It lived in `lib/connection-error-handler.ts` (deleted in the same commit)
 * and matched `PGRST301`, the PostgREST `{code, message, details, hint}`
 * envelope, PG SQLSTATE class `23*`, and the strings `"row-level security"`
 * and `"permission denied"`. None of that shape survives the move to tRPC:
 * every refusal now arrives as a `TRPCClientError` whose `data.code` is one of
 * tRPC's own keys. As written it would have answered `"unknown"` for every
 * error this application can now produce.
 *
 * **The brief for this task said its categories were "consumed elsewhere —
 * check who before changing the shape". They were not, and the check is the
 * reason this now lives here.** `grep -rn "categorizeMutationError\|
 * getMutationErrorMessage\|MutationErrorKind" packages` at `a357d59` returned
 * hits in that one file and nowhere else — zero call sites, which
 * `docs/audit/2026-08-25-revival-audit.md`'s finding C4 had already recorded
 * ("defines `categorizeMutationError` and `getMutationErrorMessage` with
 * exactly the right taxonomy ... and has **zero call sites**"). So there was
 * no shape to preserve, and rewriting it in place would have produced a
 * correct, current-looking, still-dead second vocabulary sitting beside the
 * live one — `errorMessage` and `refusalMessage` above, which together have
 * call sites in 24 files. That is the "four copies of three lines" hazard
 * `errorMessage`'s own doc comment warns about, one level up: two taxonomies
 * for one question, with nothing keeping them in agreement. It is here, in the
 * module that already owns how this client reads a tRPC error, and
 * `refusalMessage` is its first real consumer.
 *
 * ─── The mapping, and why the uncoded branch is `network` ─────────────────
 *
 * `TRPCClientError.data` is populated only from a real RPC error envelope
 * (`TRPCClientError.from` fills it from `result.error.data`). A link that
 * could not complete the request at all — DNS, a dropped connection, nginx
 * refusing, `fetch` rejecting — produces a `TRPCClientError` with `data`
 * UNDEFINED and the original `TypeError` as its `cause`. So "a tRPC error
 * carrying no code" is not a degenerate case to lump into `unknown`; it is
 * precisely the transport-failure signal, and it is the only one this client
 * gets.
 *
 * `UNAUTHORIZED` joins `FORBIDDEN` under `permission` rather than getting its
 * own category: both mean "not you", the difference is whether the session
 * expired, and an expired session is already handled structurally —
 * `AuthProvider`'s Better Auth session goes null and `ProtectedRoute` sends
 * the user to `/login`. A category here would duplicate that.
 *
 * `NOT_FOUND` is deliberately NOT `permission`, even though conventions item 3
 * means a row in another town answers `NOT_FOUND` precisely so a caller cannot
 * tell the two apart. Mapping it back to "you don't have permission" would
 * undo that at the last hop and tell the caller exactly what the code was
 * chosen to hide.
 */
export type MutationErrorKind =
  | "network" // Could not reach the server — retrying may work
  | "permission" // FORBIDDEN / UNAUTHORIZED — user action required
  | "validation" // The request was malformed — fix the data
  | "conflict" // Someone else got there first, or a uniqueness collision
  | "unknown";

export function categorizeMutationError(error: unknown): MutationErrorKind {
  if (!error) return "unknown";

  if (isTRPCClientError(error)) {
    const code = error.data?.code;
    // No envelope at all: the request never reached a resolver. See above.
    if (code === undefined) return "network";

    switch (code) {
      case "FORBIDDEN":
      case "UNAUTHORIZED":
        return "permission";
      case "CONFLICT":
        return "conflict";
      case "BAD_REQUEST":
      case "PARSE_ERROR":
      case "UNPROCESSABLE_CONTENT":
        return "validation";
      case "TIMEOUT":
      case "CLIENT_CLOSED_REQUEST":
        return "network";
      default:
        return "unknown";
    }
  }

  // Not every write in this app goes through tRPC. The exhibit upload and
  // delete endpoints are multipart Fastify routes called with a bare `fetch`
  // (`storage/documents.ts`'s pair — see conventions item 2's "where a table
  // has TWO creation paths"), so a raw `TypeError: Failed to fetch` is a shape
  // this function still has to recognise.
  if (error instanceof TypeError && error.message.toLowerCase().includes("fetch")) {
    return "network";
  }

  return "unknown";
}

/**
 * A user-facing sentence for a write that has no action-specific copy.
 *
 * Prefer `refusalMessage(err, action)` above, which names what failed. This is
 * the shape for a caller that has no verb phrase to offer.
 */
export function getMutationErrorMessage(error: unknown): string {
  switch (categorizeMutationError(error)) {
    case "network":
      return "This device can't reach the server. Check your connection and try again.";
    case "permission":
      return "You don't have permission to make this change.";
    case "validation":
      return "The data could not be saved. Please check the form and try again.";
    case "conflict":
      return "This record was changed by someone else. Reload and try again.";
    default:
      return "Could not save your changes. Please try again.";
  }
}
