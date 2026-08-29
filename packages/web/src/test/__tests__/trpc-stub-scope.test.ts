/**
 * The test harness's own scope contract.
 *
 * `installTRPCFetchStub` and `setupAppQueryClient` both register
 * `beforeEach`/`afterEach`, and vitest silently ignores a lifecycle hook
 * registered while a test is running. The first version of the stub called
 * `afterEach` from inside whichever test happened to install it: the hook
 * never ran, `globalThis.fetch` stayed stubbed past the end of the file, and
 * the doc comment's promise that it "cannot leak into the next one" was
 * simply false — undetectably so, because nothing asserted on it.
 *
 * The other scope was worse. Installed at module scope, the old helper's
 * `afterEach` DID run and unstubbed `fetch` after the first test, so every
 * later test in the file failed with a DOM error
 * (`Unable to find an element with the text: ...`) that pointed nowhere near
 * the transport.
 *
 * So the contract is now one scope, enforced. This file is the proof of both
 * directions: the supported form works across more than one test, and the
 * unsupported form fails at the call with an actionable message instead of
 * failing later somewhere else.
 */

import { describe, it, expect, afterAll } from "vitest";
import { installTRPCFetchStub } from "@/test/trpc";
import { setupAppQueryClient } from "@/test/render";
import { trpcClient } from "@/lib/trpc";

/** Captured before the helper installs anything. */
const originalFetch = globalThis.fetch;

const stub = installTRPCFetchStub({
  "town.portalAddress": () => ({ subdomain: "alna" }),
});

afterAll(() => {
  // The teardown half: the last `afterEach` has run by now, so a stub that
  // failed to restore would still be installed here.
  expect(globalThis.fetch).toBe(originalFetch);
});

describe("installTRPCFetchStub at collection scope", () => {
  it("answers the first test in the file", async () => {
    await expect(trpcClient.town.portalAddress.query()).resolves.toEqual({ subdomain: "alna" });
    expect(stub.countFor("town.portalAddress")).toBe(1);
  });

  it("answers the second test too, with its call log reset between them", async () => {
    // Both halves matter: a stub installed once and never re-installed would
    // still answer here, but its call log would read 2 and every `countFor`
    // baseline in a migrated screen test would be off by the previous test.
    await expect(trpcClient.town.portalAddress.query()).resolves.toEqual({ subdomain: "alna" });
    expect(stub.countFor("town.portalAddress")).toBe(1);
  });
});

describe("the unsupported scope fails loudly", () => {
  it("refuses installTRPCFetchStub called from inside a test body", () => {
    expect(() => installTRPCFetchStub({})).toThrowError(
      /installTRPCFetchStub\(\) was called inside a test body/,
    );
  });

  it("refuses setupAppQueryClient called from inside a test body", () => {
    expect(() => setupAppQueryClient()).toThrowError(
      /setupAppQueryClient\(\) was called inside a test body/,
    );
  });
});
