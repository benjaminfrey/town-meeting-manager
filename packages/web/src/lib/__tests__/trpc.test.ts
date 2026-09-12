import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { queryClient } from "../queryClient";
import { TRPCClientError } from "@trpc/client";
import { TRPC_BATCH_URL_LIMIT } from "@town-meeting/shared";
import {
  categorizeMutationError,
  getMutationErrorMessage,
  refusalMessage,
  trpc,
  trpcClient,
} from "../trpc";

const originalFetch = globalThis.fetch;
const originalEventSource = (globalThis as { EventSource?: unknown }).EventSource;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
  vi.restoreAllMocks();
});

describe("the tRPC client", () => {
  it("exposes an options proxy and a raw client", () => {
    expect(trpc).toBeDefined();
    expect(trpcClient).toBeDefined();
  });

  it("targets the API's mounted prefix, and sends cookies", async () => {
    // The API mounts fastifyTRPCPlugin at prefix "/api/trpc" (server.ts), and
    // Better Auth sessions are cookies, so the link MUST send credentials.
    // Without them every procedure answers UNAUTHORIZED and the failure looks
    // like an authorization bug rather than a transport one.
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify([{ result: { data: null } }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await trpcClient.whoami.query().catch(() => undefined);

    expect(calls[0]?.url).toContain("/api/trpc/");
    expect(calls[0]?.init?.credentials).toBe("include");
  });

  it("is typed against the server's router, not any", () => {
    // If AppRouter resolved to `any`, this would compile. It must not.
    // @ts-expect-error — there is no procedure called `definitelyNotAProcedure`
    void trpcClient.definitelyNotAProcedure;
  });

  it("shares the provider's cache, not a second one", async () => {
    // `trpc.<proc>.queryOptions()` is client-agnostic — it returns a plain
    // {queryKey, queryFn} object that works against whatever QueryClient the
    // caller hands it, so it can't prove which instance is wired inside
    // `trpc` itself. `mutationOptions()` is the one place the internal
    // client is actually read at call time: it looks up mutation defaults
    // via `queryClient.getMutationDefaults(mutationKey)` and falls back to
    // them inside `onSuccess` when the caller supplies none. If `trpc` was
    // built against a second, unshared QueryClient, defaults set on THIS
    // (the provider's real) queryClient are invisible to it, the fallback
    // never fires, and this test times out instead of passing — which is
    // exactly the silent no-op the brief warns about, made loud.
    //
    // Verified as a real guard, not a vacuous one: swapping trpc.ts's
    // `queryClient` import for a local `new QueryClient()` makes this test
    // fail (times out waiting for `onDefaultSuccess`) while every other
    // test in this file keeps passing.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ result: { data: { subdomain: "acme" } } }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const onDefaultSuccess = vi.fn();
    queryClient.setMutationDefaults(trpc.town.setPortalAddress.mutationKey(), {
      onSuccess: onDefaultSuccess,
    });

    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    const { result } = renderHook(() => useMutation(trpc.town.setPortalAddress.mutationOptions()), {
      wrapper,
    });

    act(() => {
      result.current.mutate({ subdomain: "acme" });
    });

    await waitFor(() => expect(onDefaultSuccess).toHaveBeenCalledTimes(1));
  });
});

/**
 * The `splitLink` routing seam.
 *
 * Phase E, wave 5, Task 4's fix round. Task 4's own report called this
 * "unautomatable in jsdom" and deferred it to a manual check against a dev
 * server; that was wrong, and the way it was wrong is worth naming, because a
 * reviewer wrote these two tests in about forty lines with no new dependency.
 * The reasoning that produced the wrong answer was "jsdom has no
 * `EventSource`, therefore a subscription cannot be exercised here" — true of
 * a REAL stream and irrelevant to the question actually being asked, which is
 * only WHICH LINK an operation takes. `httpSubscriptionLink` resolves
 * `globalThis.EventSource` LAZILY, at subscribe time, inside its
 * `observable((observer) => …)` body (`@trpc/client/dist/index.mjs`, the
 * `EventSource: opts.EventSource ?? globalThis.EventSource` line) — so a fake
 * constructor assigned to the global is a complete answer to "did this
 * operation go down the subscription branch?", and no transport has to work.
 *
 * It is worth the forty lines because the regression is 100% SILENT.
 * Measured: flipping `trpc.ts`'s `condition` to `() => false` — routing every
 * subscription into `httpBatchLink`, which refuses one outright — leaves the
 * whole web suite green and typecheck and lint blind. It would present in a
 * browser as "the live meeting never updates", with nothing red anywhere.
 *
 * Both directions are pinned, so the predicate cannot be inverted either:
 * a subscription MUST open an `EventSource`, and a query MUST NOT.
 */

/** A stand-in for the transport. It never connects; it only records. */
class FakeEventSource {
  static urls: string[] = [];
  constructor(url: string) {
    FakeEventSource.urls.push(String(url));
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

describe("the link split", () => {
  it("sends a SUBSCRIPTION down httpSubscriptionLink, not the batch link", async () => {
    // If the split ever routes this to `httpBatchLink`, that link throws at
    // subscribe — "Subscriptions are unsupported by `httpLink` - use
    // `httpSubscriptionLink` or `wsLink`" — and opens no `EventSource`. The
    // throw is what fails this test (measured: it propagates out of
    // `.subscribe()` rather than reaching `onError`); `errors` is asserted
    // empty as well, so a future client version that routes the refusal
    // through `onError` instead is caught by the same test.
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
    FakeEventSource.urls = [];
    const errors: unknown[] = [];

    const sub = trpcClient.realtime.onMeetingChange.subscribe(
      { meetingId: "11111111-1111-1111-1111-111111111111" },
      { onError: (error) => errors.push(error) },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    sub.unsubscribe();

    expect(errors.map(String)).toEqual([]);
    expect(FakeEventSource.urls.length).toBe(1);
    expect(FakeEventSource.urls[0]).toContain("realtime.onMeetingChange");
  });

  it("sends a QUERY down httpBatchLink — no EventSource at all", async () => {
    // The other direction. A predicate inverted to `op.type !== "subscription"`
    // would satisfy the test above's shape for the wrong operations, so the
    // ordinary path is pinned too: a query goes over `fetch` and opens no
    // stream.
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
    FakeEventSource.urls = [];
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify([{ result: { data: null } }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await trpcClient.whoami.query().catch(() => undefined);

    expect(calls.length).toBe(1);
    expect(FakeEventSource.urls).toEqual([]);
  });
});

/**
 * The client half of the batch-path fix — Phase E, wave 5, Task 7's fix
 * round, hardened in the single fix wave that followed.
 *
 * `packages/shared/src/constants/trpc-batch.ts` exports two constants that
 * only mean anything together: `TRPC_BATCH_PATH_LENGTH_LIMIT` raises
 * `server.ts`'s Fastify `maxParamLength` so a batched request's comma-joined
 * path segment is no longer refused at 100 characters (pinned server-side by
 * `packages/api/src/trpc/__tests__/http-batch.test.ts`), and
 * `TRPC_BATCH_URL_LIMIT` is `httpBatchLink`'s `maxURLLength` — the half that
 * makes a GROWING batch on the client SPLIT into more than one HTTP request
 * once the resulting URL is long enough, rather than depending on the server
 * ceiling never being reached. Before this test, `trpc.ts:95`'s
 * `maxURLLength: TRPC_BATCH_URL_LIMIT` could be deleted (import included)
 * with web green, typecheck green, and lint clean — the wave-5 whole-branch
 * review's finding M1.
 *
 * Removing it is not cosmetic: it is the recurrence guard for the defect that
 * 404'd every load of the live meeting screen three commits before this one
 * (the six-procedure, ~151-character batch in `http-batch.test.ts`'s own
 * header). Without a client-side cap, the next screen whose loader composes a
 * seventh or eighth query grows the batch past whatever the server allows
 * with nothing on this side to notice.
 */
describe("the batch URL cap (Phase E, wave 5, Task 7)", () => {
  it("splits a growing batch into more than one request once the URL would exceed TRPC_BATCH_URL_LIMIT", async () => {
    // Every call below is `whoami` with no input, so `getInput`'s dict of all
    // `undefined` values serializes to `{}` — a fixed-size `input=%7B%7D` no
    // matter how many calls are in the group. Only the comma-joined PATH
    // segment ("whoami,whoami,...") grows with the call count, and it is what
    // `httpBatchLink`'s `validate()` measures against `maxURLLength`. 300
    // calls comfortably clears `TRPC_BATCH_URL_LIMIT` (2048) — ~7 chars per
    // "whoami," puts the unsplit path alone past 2000 characters — so a
    // single group can no longer hold them all.
    const CALL_COUNT = 300;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      // The stub only has to answer with as many envelopes as procedures are
      // in THIS request's own path segment, not the grand total.
      const procCount = (String(url).match(/whoami/g) ?? []).length;
      return new Response(
        JSON.stringify(Array.from({ length: procCount }, () => ({ result: { data: null } }))),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    await Promise.all(
      Array.from({ length: CALL_COUNT }, () => trpcClient.whoami.query().catch(() => undefined)),
    );

    // The load-bearing assertion. Deleting `maxURLLength` from `trpc.ts`
    // collapses this to a single request (`calls.length === 1`) — verified by
    // mutation, restored afterward.
    expect(calls.length).toBeGreaterThan(1);

    // And the cap is actually being obeyed, not just triggering a split at
    // some other threshold: no request this client built exceeds the limit
    // it was configured with.
    for (const url of calls) {
      expect(url.length).toBeLessThanOrEqual(TRPC_BATCH_URL_LIMIT);
    }
  });
});

/**
 * The mutation-error taxonomy, against the errors this client actually
 * produces.
 *
 * Phase E, wave 5, Task 6. The function this replaces lived in
 * `lib/connection-error-handler.ts` and was PostgREST-shaped: `PGRST301`, a
 * `{code, message, details, hint}` envelope, SQLSTATE class `23*`, and the
 * substrings "row-level security" and "permission denied". None of that shape
 * reaches a browser any more, so as written it answered `"unknown"` for every
 * error this application can now produce — including every refusal.
 *
 * Every error below is built the way the real client builds it, not by hand:
 * `TRPCClientError.from({ error: shape })` is literally what `httpBatchLink`
 * calls on an RPC error response, and `TRPCClientError.from(cause)` is what it
 * calls when `fetch` rejects. A test that constructed `{ data: { code } }`
 * object literals would pin this function against a shape nobody produces.
 */
describe("categorizeMutationError", () => {
  /** An RPC error response, exactly as the API's default formatter shapes it. */
  function rpcError(code: string, httpStatus: number, message = "nope") {
    return TRPCClientError.from({
      error: {
        code: -32600,
        message,
        data: { code, httpStatus, stack: undefined, path: "x.y" },
      },
    } as never);
  }

  it("reads a refusal as a permission problem", () => {
    expect(categorizeMutationError(rpcError("FORBIDDEN", 403))).toBe("permission");
    // UNAUTHORIZED joins it: both mean "not you", and the session-expiry half
    // is already handled structurally by AuthProvider / ProtectedRoute.
    expect(categorizeMutationError(rpcError("UNAUTHORIZED", 401))).toBe("permission");
  });

  it("reads a collision as a conflict and a bad request as validation", () => {
    expect(categorizeMutationError(rpcError("CONFLICT", 409))).toBe("conflict");
    expect(categorizeMutationError(rpcError("BAD_REQUEST", 400))).toBe("validation");
    // A zod failure on the server arrives as BAD_REQUEST; a malformed body
    // never reaches the parser and arrives as PARSE_ERROR. Both are "fix the
    // data", and neither is a server fault to apologise for.
    expect(categorizeMutationError(rpcError("PARSE_ERROR", 400))).toBe("validation");
    expect(categorizeMutationError(rpcError("UNPROCESSABLE_CONTENT", 422))).toBe("validation");
  });

  it("reads the server's own give-up codes as network failures", () => {
    // Neither is a fault the user can fix by changing their input, and both
    // mean "try that again" rather than "something is broken".
    expect(categorizeMutationError(rpcError("TIMEOUT", 408))).toBe("network");
    expect(categorizeMutationError(rpcError("CLIENT_CLOSED_REQUEST", 499))).toBe("network");
  });

  it("does NOT dress a NOT_FOUND up as a refusal", () => {
    // Conventions item 3: a row in another town answers NOT_FOUND precisely so
    // a caller cannot tell "does not exist" from "not yours". Mapping it to
    // `permission` here would undo that at the last hop and tell the caller
    // exactly what the code was chosen to hide.
    expect(categorizeMutationError(rpcError("NOT_FOUND", 404))).toBe("unknown");
  });

  it("reads a request that never reached a resolver as a network failure", () => {
    // THE case the old implementation could not express, and the one the new
    // offline pill is about. `TRPCClientError.data` is populated only from an
    // RPC error envelope, so a link that could not complete the request at all
    // produces a tRPC error with NO code — not a degenerate `unknown`, but the
    // only transport-failure signal this client gets.
    const transportFailure = TRPCClientError.from(new TypeError("Failed to fetch"));
    expect(transportFailure.data, "the premise of this test").toBeUndefined();
    expect(categorizeMutationError(transportFailure)).toBe("network");
  });

  it("still recognises a raw fetch failure, for the writes that are not tRPC", () => {
    // The exhibit upload and delete endpoints are multipart Fastify routes
    // called with a bare `fetch` (conventions item 2, "where a table has TWO
    // creation paths"), so this shape has not gone away.
    expect(categorizeMutationError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("admits it does not know, rather than guessing", () => {
    expect(categorizeMutationError(rpcError("INTERNAL_SERVER_ERROR", 500))).toBe("unknown");
    expect(categorizeMutationError(new Error("boom"))).toBe("unknown");
    expect(categorizeMutationError(null)).toBe("unknown");
  });

  it("is what refusalMessage's copy branches on — it is not dead code", () => {
    // The function had ZERO call sites from the day it was written until this
    // task (audit finding C4, 2026-08-25). `refusalMessage` is its first real
    // consumer, at 19 files' worth of call sites, and these two assertions are
    // what would go red if it were quietly bypassed again.
    expect(refusalMessage(rpcError("FORBIDDEN", 403), "cancel this meeting")).toBe(
      "You don't have permission to cancel this meeting.",
    );
    expect(
      refusalMessage(TRPCClientError.from(new TypeError("Failed to fetch")), "save this motion"),
    ).toContain("can't reach the server");
    // Unchanged for everything else — the network branch is additive.
    expect(refusalMessage(new Error("boom"), "save this motion")).toBe(
      "Couldn't save this motion. Try again.",
    );
  });

  it("gives a caller with no verb phrase a sentence anyway — one per category", () => {
    expect(getMutationErrorMessage(rpcError("CONFLICT", 409))).toContain("someone else");
    expect(getMutationErrorMessage(rpcError("FORBIDDEN", 403))).toContain("permission");
    expect(getMutationErrorMessage(rpcError("BAD_REQUEST", 400))).toContain("check the form");
    expect(getMutationErrorMessage(new TypeError("Failed to fetch"))).toContain(
      "can't reach the server",
    );
    // The `unknown` arm is the one worth pinning explicitly: it is what an
    // unmapped code falls through to, and "could not save" must not quietly
    // become a more confident claim than the categoriser can support.
    expect(getMutationErrorMessage(rpcError("INTERNAL_SERVER_ERROR", 500))).toBe(
      "Could not save your changes. Please try again.",
    );
  });
});
