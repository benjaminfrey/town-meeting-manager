import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { queryClient } from "../queryClient";
import { trpc, trpcClient } from "../trpc";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
