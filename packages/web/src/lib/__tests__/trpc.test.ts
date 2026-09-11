import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { queryClient } from "../queryClient";
import { trpc, trpcClient } from "../trpc";

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
