import { describe, it, expect } from "vitest";
import { trpc, trpcClient } from "../trpc";

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
});
